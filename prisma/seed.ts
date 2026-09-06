/**
 * LOCAL DEVELOPMENT SEED — never runs in production (§47).
 *
 * The old behaviour was dangerous for a multi-tenant app: the application
 * itself called seedDemo() when it found an empty database, so a fresh
 * production deploy would fill itself with fake transactions, and a real user
 * could open the app and see money that was not theirs.
 *
 * Now:
 *   - nothing in src/ imports this file; the app never seeds itself;
 *   - the data is owned by one explicitly-created demo user, so it is
 *     tenant-scoped like any other account and cannot leak into a real one;
 *   - the script refuses to run against a production database.
 *
 * Run with: npm run seed
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma";
import { CATEGORIES } from "../src/lib/categories";
import { dollarsToCents } from "../src/lib/money";

/** The demo account. Fixed id so re-seeding replaces rather than accumulates. */
const DEMO_USER_ID = "u_demo_local_development";
const DEMO_EMAIL = "demo@localhost.invalid";

/**
 * Refuse to run anywhere that could be real. A seed script that can be
 * pointed at production by a stray environment variable is a data-loss
 * incident waiting to happen (§46).
 */
function assertLocalOnly(): void {
  const url = process.env.DATABASE_URL ?? "";
  const problems: string[] = [];
  if (process.env.NODE_ENV === "production") problems.push("NODE_ENV=production");
  if (process.env.VERCEL) problems.push("running on Vercel");
  if (url.startsWith("postgres")) problems.push("DATABASE_URL points at Postgres");
  if (process.env.PLAID_SECRET) problems.push("PLAID_SECRET is set (real-money mode)");
  if (problems.length > 0) {
    throw new Error(
      `Refusing to seed demo data: ${problems.join(", ")}. ` +
        "This script is for local SQLite development only.",
    );
  }
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// merchant -> category name. amounts positive = spending.
const SPEND: Record<string, { merchants: string[]; min: number; max: number }> = {
  Groceries: { merchants: ["Whole Foods", "Trader Joe's", "Safeway", "Costco"], min: 22, max: 180 },
  "Food & Dining": { merchants: ["Starbucks", "Chipotle", "DoorDash", "Blue Bottle", "Sushi Ren", "Shake Shack"], min: 6, max: 65 },
  Transportation: { merchants: ["Shell", "Chevron", "Uber", "Lyft", "BART"], min: 3, max: 70 },
  Shopping: { merchants: ["Amazon", "Target", "Best Buy", "Nike", "Uniqlo"], min: 12, max: 220 },
  Entertainment: { merchants: ["AMC Theatres", "Steam", "Ticketmaster"], min: 9, max: 90 },
  Health: { merchants: ["CVS Pharmacy", "Walgreens", "One Medical"], min: 10, max: 140 },
  "Personal Care": { merchants: ["Great Clips", "Sephora", "Massage Envy"], min: 15, max: 110 },
  Travel: { merchants: ["United Airlines", "Airbnb", "Marriott"], min: 120, max: 700 },
  Services: { merchants: ["Geico Insurance", "Rover", "TaskRabbit"], min: 20, max: 160 },
};

// How often each category shows up in day-to-day spending (relative weights).
// Everyday categories dominate so any recent window has realistic activity.
const SPEND_WEIGHTS: Record<string, number> = {
  "Food & Dining": 6,
  Groceries: 3,
  Transportation: 3,
  Shopping: 2,
  Entertainment: 1,
  Health: 1,
  "Personal Care": 1,
  Services: 1,
  Travel: 1,
};
const WEIGHTED_SPEND: string[] = Object.entries(SPEND_WEIGHTS).flatMap(
  ([cat, w]) => Array(w).fill(cat)
);

// Recurring monthly bills (day-of-month, merchant, category, amount)
const RECURRING = [
  { day: 1, merchant: "Sunset Apartments", category: "Housing", dollars: 1850 },
  { day: 5, merchant: "PG&E", category: "Bills & Utilities", dollars: 95 },
  { day: 8, merchant: "Comcast Xfinity", category: "Bills & Utilities", dollars: 79 },
  { day: 10, merchant: "AT&T Wireless", category: "Bills & Utilities", dollars: 68 },
  { day: 3, merchant: "Netflix", category: "Entertainment", dollars: 15.49 },
  { day: 3, merchant: "Spotify", category: "Entertainment", dollars: 11.99 },
  { day: 15, merchant: "Planet Fitness", category: "Personal Care", dollars: 24.99 },
];

export async function seedDemo(prisma: PrismaClient) {
  assertLocalOnly();

  const userId = DEMO_USER_ID;

  console.log("Creating the local demo user…");
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: DEMO_EMAIL,
      name: "Demo",
      // Verified so the demo account can use the app without a mail server.
      emailVerified: true,
      timezone: "America/Los_Angeles",
      plaidUserRef: `mu_demo_${randomBytes(8).toString("hex")}`,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      onboardedAt: new Date(),
    },
  });

  // Scoped to the demo user: re-seeding never touches another account's rows.
  console.log("Clearing the demo user's existing data…");
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.holding.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.item.deleteMany({ where: { userId } });
  await prisma.budget.deleteMany({ where: { userId } });
  await prisma.merchantRule.deleteMany({ where: { userId } });
  await prisma.goal.deleteMany({ where: { userId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.folder.deleteMany({ where: { userId } });
  await prisma.category.deleteMany({ where: { userId } });

  console.log("Seeding categories…");
  await prisma.$transaction(
    CATEGORIES.map((c) =>
      prisma.category.create({
        data: { userId, name: c.name, icon: c.icon, color: c.color, group: c.group },
      })
    )
  );
  const cats = await prisma.category.findMany();
  const catId = (name: string) => cats.find((c) => c.name === name)?.id ?? null;

  console.log("Seeding accounts…");
  // Three separate demo institutions so per-bank / per-card filtering has
  // something real to show (mirrors a typical bank + card issuer + broker mix).
  const bank = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-bank",
      userId,
      // Demo connections carry a clearly-fake encrypted credential; they are
      // never used against the real Plaid API.
      accessTokenCipher: "v1.demo.demo.demo.demo",
      accessTokenKeyId: "demo",
      institutionName: "Demo Bank (sample)",
    },
  });
  const cardCo = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-card",
      userId,
      // Demo connections carry a clearly-fake encrypted credential; they are
      // never used against the real Plaid API.
      accessTokenCipher: "v1.demo.demo.demo.demo",
      accessTokenKeyId: "demo",
      institutionName: "Demo Card Co. (sample)",
    },
  });
  const broker = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-invest",
      userId,
      // Demo connections carry a clearly-fake encrypted credential; they are
      // never used against the real Plaid API.
      accessTokenCipher: "v1.demo.demo.demo.demo",
      accessTokenKeyId: "demo",
      institutionName: "Demo Invest (sample)",
    },
  });
  const bizBank = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-business",
      userId,
      // Demo connections carry a clearly-fake encrypted credential; they are
      // never used against the real Plaid API.
      accessTokenCipher: "v1.demo.demo.demo.demo",
      accessTokenKeyId: "demo",
      institutionName: "Demo Business Bank (sample)",
    },
  });

  const checking = await prisma.account.create({
    data: {
      userId,
      plaidAccountId: "demo-checking",
      itemId: bank.id,
      name: "Everyday Checking",
      mask: "4821",
      type: "depository",
      subtype: "checking",
      currentBalanceCents: dollarsToCents(4287.55),
      availableBalanceCents: dollarsToCents(4187.55),
    },
  });
  const savings = await prisma.account.create({
    data: {
      userId,
      plaidAccountId: "demo-savings",
      itemId: bank.id,
      name: "High-Yield Savings",
      mask: "9033",
      type: "depository",
      subtype: "savings",
      currentBalanceCents: dollarsToCents(15840.12),
      availableBalanceCents: dollarsToCents(15840.12),
    },
  });
  const credit = await prisma.account.create({
    data: {
      userId,
      plaidAccountId: "demo-credit",
      itemId: cardCo.id,
      name: "Cash Rewards Card",
      mask: "1177",
      type: "credit",
      subtype: "credit card",
      currentBalanceCents: dollarsToCents(892.41),
      availableBalanceCents: dollarsToCents(7107.59),
    },
  });
  const brokerage = await prisma.account.create({
    data: {
      userId,
      plaidAccountId: "demo-invest",
      itemId: broker.id,
      name: "Brokerage",
      mask: "5520",
      type: "investment",
      subtype: "brokerage",
      currentBalanceCents: dollarsToCents(28450.9),
    },
  });
  const cryptoWallet = await prisma.account.create({
    data: {
      userId,
      plaidAccountId: "demo-crypto",
      itemId: broker.id,
      name: "Crypto Wallet",
      mask: "0007",
      type: "investment",
      subtype: "crypto exchange",
      currentBalanceCents: dollarsToCents(12994.5),
    },
  });
  const bizChecking = await prisma.account.create({
    data: {
      userId,
      plaidAccountId: "demo-business",
      itemId: bizBank.id,
      name: "Business Checking",
      mask: "3300",
      type: "depository",
      subtype: "checking",
      currentBalanceCents: dollarsToCents(9412.77),
      isBusiness: true,
    },
  });

  console.log("Seeding holdings…");
  // Brokerage holdings sum to its balance; same for the crypto wallet.
  await prisma.holding.createMany({
    data: [
      { userId, accountId: brokerage.id, symbol: "VOO", name: "Vanguard S&P 500 ETF", quantity: 30, priceUsd: 512.4, valueCents: dollarsToCents(15372.0), kind: "etf" },
      { userId, accountId: brokerage.id, symbol: "AAPL", name: "Apple", quantity: 25, priceUsd: 224.5, valueCents: dollarsToCents(5612.5), kind: "stock" },
      { userId, accountId: brokerage.id, symbol: "NVDA", name: "NVIDIA", quantity: 40, priceUsd: 131.2, valueCents: dollarsToCents(5248.0), kind: "stock" },
      { userId, accountId: brokerage.id, symbol: "USD", name: "Cash sweep", quantity: 2218.4, priceUsd: 1, valueCents: dollarsToCents(2218.4), kind: "cash" },
      { userId, accountId: cryptoWallet.id, symbol: "BTC", name: "Bitcoin", quantity: 0.12, priceUsd: 64500, valueCents: dollarsToCents(7740.0), kind: "crypto" },
      { userId, accountId: cryptoWallet.id, symbol: "ETH", name: "Ethereum", quantity: 1.5, priceUsd: 3503, valueCents: dollarsToCents(5254.5), kind: "crypto" },
    ],
  });

  console.log("Seeding business activity…");
  // A small freelance/side business: client invoices in, tools + contractor out.
  {
    const today0 = new Date();
    let bc = 0;
    const bizTxns: {
      userId: string;
      plaidTransactionId: string;
      accountId: string;
      amountCents: number;
      date: Date;
      name: string;
      merchantName: string;
      categoryId: string | null;
    }[] = [];
    const CLIENTS = ["Northwind LLC", "Bluebird Media", "Hartley & Co"];
    for (let d = 150; d >= 0; d--) {
      const date = new Date(today0.getFullYear(), today0.getMonth(), today0.getDate() - d);
      // invoices land roughly every 10-12 days
      if (d % 11 === 3) {
        const client = pick(CLIENTS);
        bizTxns.push({
          userId,
      plaidTransactionId: `demo-biz-${bc++}`,
          accountId: bizChecking.id,
          amountCents: dollarsToCents(-round2(rand(1100, 2600))),
          date,
          name: `${client} Invoice`,
          merchantName: client,
          categoryId: catId("Income"),
        });
      }
      // monthly tools
      if (date.getDate() === 4) {
        for (const [merchant, amt] of [
          ["Adobe Creative Cloud", 59.99],
          ["QuickBooks", 30.0],
          ["Google Workspace", 14.4],
        ] as const) {
          bizTxns.push({
            userId,
      plaidTransactionId: `demo-biz-${bc++}`,
            accountId: bizChecking.id,
            amountCents: dollarsToCents(amt),
            date,
            name: merchant,
            merchantName: merchant,
            categoryId: catId("Services"),
          });
        }
      }
      // contractor payout mid-month
      if (date.getDate() === 16) {
        bizTxns.push({
          userId,
      plaidTransactionId: `demo-biz-${bc++}`,
          accountId: bizChecking.id,
          amountCents: dollarsToCents(round2(rand(380, 900))),
          date,
          name: "Contractor Payout",
          merchantName: "Contractor Payout",
          categoryId: catId("Services"),
        });
      }
      // occasional supplies
      if (d % 17 === 5) {
        const supplier = pick(["Office Depot", "Uline", "Best Buy Business"]);
        bizTxns.push({
          userId,
      plaidTransactionId: `demo-biz-${bc++}`,
          accountId: bizChecking.id,
          amountCents: dollarsToCents(round2(rand(24, 160))),
          date,
          name: supplier,
          merchantName: supplier,
          categoryId: catId("Shopping"),
        });
      }
    }
    await prisma.transaction.createMany({ data: bizTxns });
  }

  console.log("Seeding transactions…");
  const today = new Date();
  const DAYS = 150;
  const txns: {
    userId: string;
    plaidTransactionId: string;
    accountId: string;
    amountCents: number;
    date: Date;
    name: string;
    merchantName: string;
    categoryId: string | null;
  }[] = [];
  let counter = 0;

  const spendAccounts = [checking.id, credit.id];

  for (let d = DAYS; d >= 0; d--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);

    // Biweekly paycheck (income = negative amount)
    if (d % 14 === 0) {
      txns.push({
        userId,
      plaidTransactionId: `demo-tx-${counter++}`,
        accountId: checking.id,
        amountCents: dollarsToCents(-round2(rand(2550, 2700))),
        date,
        name: "Acme Corp Payroll",
        merchantName: "Acme Corp",
        categoryId: catId("Income"),
      });
    }

    // Recurring monthly bills on their day
    for (const r of RECURRING) {
      if (date.getDate() === r.day) {
        txns.push({
          userId,
      plaidTransactionId: `demo-tx-${counter++}`,
          accountId: r.dollars > 100 ? checking.id : credit.id,
          amountCents: dollarsToCents(r.dollars),
          date,
          name: r.merchant,
          merchantName: r.merchant,
          categoryId: catId(r.category),
        });
      }
    }

    // Monthly transfer to savings
    if (date.getDate() === 2) {
      txns.push({
        userId,
      plaidTransactionId: `demo-tx-${counter++}`,
        accountId: checking.id,
        amountCents: dollarsToCents(500),
        date,
        name: "Transfer to Savings",
        merchantName: "Transfer to Savings",
        categoryId: catId("Transfer"),
      });
    }

    // 0-3 discretionary spends per day, weighted toward everyday categories
    // (food, groceries, gas) so recent windows always show realistic activity.
    const n = Math.floor(rand(0, 3.4));
    for (let i = 0; i < n; i++) {
      const category = pick(WEIGHTED_SPEND);
      const spec = SPEND[category];
      // travel is rare
      if (category === "Travel" && Math.random() > 0.12) continue;
      const merchant = pick(spec.merchants);
      const amount = round2(rand(spec.min, spec.max));
      // Mirrors the amount-aware gas rule in src/lib/smart-categorize.ts:
      // a small gas-station charge is snacks, not fuel.
      const GAS = ["Shell", "Chevron"];
      const effCategory =
        GAS.includes(merchant) && amount < 15 ? "Food & Dining" : category;
      txns.push({
        userId,
      plaidTransactionId: `demo-tx-${counter++}`,
        accountId: pick(spendAccounts),
        amountCents: dollarsToCents(amount),
        date,
        name: merchant,
        merchantName: merchant,
        categoryId: catId(effCategory),
      });
    }
  }

  // Insert in chunks
  for (let i = 0; i < txns.length; i += 100) {
    await prisma.transaction.createMany({ data: txns.slice(i, i + 100) });
  }
  console.log(`  ${txns.length} transactions`);

  console.log("Seeding reimbursements…");
  const dRecent = (days: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  await prisma.transaction.createMany({
    data: [
      {
        userId,
      plaidTransactionId: "demo-owed-1",
        accountId: credit.id,
        amountCents: dollarsToCents(180),
        date: dRecent(16),
        name: "Ticketmaster",
        merchantName: "Ticketmaster",
        categoryId: catId("Entertainment"),
        owedBack: true,
        reimbursedAmountCents: 0,
        notes: "Concert tickets — Jordan's share",
      },
      {
        userId,
      plaidTransactionId: "demo-owed-2",
        accountId: checking.id,
        amountCents: dollarsToCents(240),
        date: dRecent(9),
        name: "Group dinner",
        merchantName: "Sushi Ren",
        categoryId: catId("Food & Dining"),
        owedBack: true,
        reimbursedAmountCents: 120, // half paid back so far
      },
      {
        userId,
      plaidTransactionId: "demo-repay-1",
        accountId: checking.id,
        amountCents: dollarsToCents(-120),
        date: dRecent(7),
        name: "Cash App · Jordan",
        merchantName: "Cash App",
        categoryId: catId("Transfer"),
      },
    ],
  });

  console.log("Seeding budgets…");
  const budgets = [
    { name: "Groceries", dollars: 600 },
    { name: "Food & Dining", dollars: 400 },
    { name: "Transportation", dollars: 200 },
    { name: "Shopping", dollars: 350 },
    { name: "Entertainment", dollars: 150 },
    { name: "Bills & Utilities", dollars: 350 },
  ];
  for (const b of budgets) {
    const id = catId(b.name);
    if (id) await prisma.budget.create({ data: { userId, categoryId: id, amountCents: dollarsToCents(b.dollars) } });
  }

  console.log("Seeding goals…");
  await prisma.goal.createMany({
    data: [
      { userId, name: "Emergency Fund", targetAmountCents: dollarsToCents(15000), currentAmountCents: dollarsToCents(9200), icon: "PiggyBank", color: "#22c55e" },
      { userId, name: "Japan Trip", targetAmountCents: dollarsToCents(5000), currentAmountCents: dollarsToCents(1850), icon: "Plane", color: "#06b6d4" },
      { userId, name: "New Laptop", targetAmountCents: dollarsToCents(2500), currentAmountCents: dollarsToCents(2500), icon: "Target", color: "#6366f1" },
      { userId, name: "Down Payment", targetAmountCents: dollarsToCents(60000), currentAmountCents: dollarsToCents(18400), icon: "Home", color: "#a855f7" },
    ],
  });

  console.log("Seeding rental properties…");
  await prisma.property.deleteMany();
  await prisma.property.createMany({
    data: [
      {
        userId, name: "Elm St duplex",
        rentIncomeCents: dollarsToCents(2400),
        mortgageCents: dollarsToCents(1750),
        utilitiesCents: dollarsToCents(180),
        hoaCents: dollarsToCents(0),
        sweatInCents: dollarsToCents(14500),
        sweatOutCents: dollarsToCents(26400),
        notes: "Tenants cover it — cash-flows every month.",
      },
      {
        userId, name: "Oak Ave",
        rentIncomeCents: dollarsToCents(1900),
        mortgageCents: dollarsToCents(1820),
        utilitiesCents: dollarsToCents(210),
        hoaCents: dollarsToCents(95),
        sweatInCents: dollarsToCents(9800),
        sweatOutCents: dollarsToCents(6200),
        notes: "Under renovation — topping up until rent bumps in the fall.",
      },
    ],
  });

  console.log("✅ Seed complete.");
}

// CLI entry: `npm run seed`
if (require.main === module) {
  const prisma = new PrismaClient();
  seedDemo(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
