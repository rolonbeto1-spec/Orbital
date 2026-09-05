// Seeds realistic demo data so the app is fully usable without Plaid keys.
// Run with: npm run seed — or imported as seedDemo() by the app itself, which
// auto-seeds an empty database on first boot (how a fresh deploy fills up).
import { PrismaClient } from "../src/generated/prisma";
import { CATEGORIES } from "../src/lib/categories";

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
  { day: 1, merchant: "Sunset Apartments", category: "Housing", amount: 1850 },
  { day: 5, merchant: "PG&E", category: "Bills & Utilities", amount: 95 },
  { day: 8, merchant: "Comcast Xfinity", category: "Bills & Utilities", amount: 79 },
  { day: 10, merchant: "AT&T Wireless", category: "Bills & Utilities", amount: 68 },
  { day: 3, merchant: "Netflix", category: "Entertainment", amount: 15.49 },
  { day: 3, merchant: "Spotify", category: "Entertainment", amount: 11.99 },
  { day: 15, merchant: "Planet Fitness", category: "Personal Care", amount: 24.99 },
];

export async function seedDemo(prisma: PrismaClient) {
  console.log("Clearing existing data…");
  await prisma.transaction.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.account.deleteMany();
  await prisma.item.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.category.deleteMany();

  console.log("Seeding categories…");
  await prisma.$transaction(
    CATEGORIES.map((c) =>
      prisma.category.create({
        data: { name: c.name, icon: c.icon, color: c.color, group: c.group },
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
      accessToken: "demo",
      institutionName: "Demo Bank (sample)",
    },
  });
  const cardCo = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-card",
      accessToken: "demo",
      institutionName: "Demo Card Co. (sample)",
    },
  });
  const broker = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-invest",
      accessToken: "demo",
      institutionName: "Demo Invest (sample)",
    },
  });
  const bizBank = await prisma.item.create({
    data: {
      plaidItemId: "demo-item-business",
      accessToken: "demo",
      institutionName: "Demo Business Bank (sample)",
    },
  });

  const checking = await prisma.account.create({
    data: {
      plaidAccountId: "demo-checking",
      itemId: bank.id,
      name: "Everyday Checking",
      mask: "4821",
      type: "depository",
      subtype: "checking",
      currentBalance: 4287.55,
      availableBalance: 4187.55,
    },
  });
  const savings = await prisma.account.create({
    data: {
      plaidAccountId: "demo-savings",
      itemId: bank.id,
      name: "High-Yield Savings",
      mask: "9033",
      type: "depository",
      subtype: "savings",
      currentBalance: 15840.12,
      availableBalance: 15840.12,
    },
  });
  const credit = await prisma.account.create({
    data: {
      plaidAccountId: "demo-credit",
      itemId: cardCo.id,
      name: "Cash Rewards Card",
      mask: "1177",
      type: "credit",
      subtype: "credit card",
      currentBalance: 892.41,
      availableBalance: 7107.59,
    },
  });
  const brokerage = await prisma.account.create({
    data: {
      plaidAccountId: "demo-invest",
      itemId: broker.id,
      name: "Brokerage",
      mask: "5520",
      type: "investment",
      subtype: "brokerage",
      currentBalance: 28450.9,
    },
  });
  const cryptoWallet = await prisma.account.create({
    data: {
      plaidAccountId: "demo-crypto",
      itemId: broker.id,
      name: "Crypto Wallet",
      mask: "0007",
      type: "investment",
      subtype: "crypto exchange",
      currentBalance: 12994.5,
    },
  });
  const bizChecking = await prisma.account.create({
    data: {
      plaidAccountId: "demo-business",
      itemId: bizBank.id,
      name: "Business Checking",
      mask: "3300",
      type: "depository",
      subtype: "checking",
      currentBalance: 9412.77,
      isBusiness: true,
    },
  });

  console.log("Seeding holdings…");
  // Brokerage holdings sum to its balance; same for the crypto wallet.
  await prisma.holding.createMany({
    data: [
      { accountId: brokerage.id, symbol: "VOO", name: "Vanguard S&P 500 ETF", quantity: 30, price: 512.4, value: 15372.0, kind: "etf" },
      { accountId: brokerage.id, symbol: "AAPL", name: "Apple", quantity: 25, price: 224.5, value: 5612.5, kind: "stock" },
      { accountId: brokerage.id, symbol: "NVDA", name: "NVIDIA", quantity: 40, price: 131.2, value: 5248.0, kind: "stock" },
      { accountId: brokerage.id, symbol: "USD", name: "Cash sweep", quantity: 2218.4, price: 1, value: 2218.4, kind: "cash" },
      { accountId: cryptoWallet.id, symbol: "BTC", name: "Bitcoin", quantity: 0.12, price: 64500, value: 7740.0, kind: "crypto" },
      { accountId: cryptoWallet.id, symbol: "ETH", name: "Ethereum", quantity: 1.5, price: 3503, value: 5254.5, kind: "crypto" },
    ],
  });

  console.log("Seeding business activity…");
  // A small freelance/side business: client invoices in, tools + contractor out.
  {
    const today0 = new Date();
    let bc = 0;
    const bizTxns: {
      plaidTransactionId: string;
      accountId: string;
      amount: number;
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
          plaidTransactionId: `demo-biz-${bc++}`,
          accountId: bizChecking.id,
          amount: -round2(rand(1100, 2600)),
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
            plaidTransactionId: `demo-biz-${bc++}`,
            accountId: bizChecking.id,
            amount: amt,
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
          plaidTransactionId: `demo-biz-${bc++}`,
          accountId: bizChecking.id,
          amount: round2(rand(380, 900)),
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
          plaidTransactionId: `demo-biz-${bc++}`,
          accountId: bizChecking.id,
          amount: round2(rand(24, 160)),
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
    plaidTransactionId: string;
    accountId: string;
    amount: number;
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
        plaidTransactionId: `demo-tx-${counter++}`,
        accountId: checking.id,
        amount: -round2(rand(2550, 2700)),
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
          plaidTransactionId: `demo-tx-${counter++}`,
          accountId: r.amount > 100 ? checking.id : credit.id,
          amount: round2(r.amount),
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
        plaidTransactionId: `demo-tx-${counter++}`,
        accountId: checking.id,
        amount: 500,
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
        plaidTransactionId: `demo-tx-${counter++}`,
        accountId: pick(spendAccounts),
        amount,
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
        plaidTransactionId: "demo-owed-1",
        accountId: credit.id,
        amount: 180,
        date: dRecent(16),
        name: "Ticketmaster",
        merchantName: "Ticketmaster",
        categoryId: catId("Entertainment"),
        owedBack: true,
        reimbursedAmount: 0,
        notes: "Concert tickets — Jordan's share",
      },
      {
        plaidTransactionId: "demo-owed-2",
        accountId: checking.id,
        amount: 240,
        date: dRecent(9),
        name: "Group dinner",
        merchantName: "Sushi Ren",
        categoryId: catId("Food & Dining"),
        owedBack: true,
        reimbursedAmount: 120, // half paid back so far
      },
      {
        plaidTransactionId: "demo-repay-1",
        accountId: checking.id,
        amount: -120,
        date: dRecent(7),
        name: "Cash App · Jordan",
        merchantName: "Cash App",
        categoryId: catId("Transfer"),
      },
    ],
  });

  console.log("Seeding budgets…");
  const budgets = [
    { name: "Groceries", amount: 600 },
    { name: "Food & Dining", amount: 400 },
    { name: "Transportation", amount: 200 },
    { name: "Shopping", amount: 350 },
    { name: "Entertainment", amount: 150 },
    { name: "Bills & Utilities", amount: 350 },
  ];
  for (const b of budgets) {
    const id = catId(b.name);
    if (id) await prisma.budget.create({ data: { categoryId: id, amount: b.amount } });
  }

  console.log("Seeding goals…");
  await prisma.goal.createMany({
    data: [
      { name: "Emergency Fund", targetAmount: 15000, currentAmount: 9200, icon: "PiggyBank", color: "#22c55e" },
      { name: "Japan Trip", targetAmount: 5000, currentAmount: 1850, icon: "Plane", color: "#06b6d4" },
      { name: "New Laptop", targetAmount: 2500, currentAmount: 2500, icon: "Target", color: "#6366f1" },
      { name: "Down Payment", targetAmount: 60000, currentAmount: 18400, icon: "Home", color: "#a855f7" },
    ],
  });

  console.log("Seeding rental properties…");
  await prisma.property.deleteMany();
  await prisma.property.createMany({
    data: [
      {
        name: "Elm St duplex",
        rentIncome: 2400,
        mortgage: 1750,
        utilities: 180,
        hoa: 0,
        sweatIn: 14500,
        sweatOut: 26400,
        notes: "Tenants cover it — cash-flows every month.",
      },
      {
        name: "Oak Ave",
        rentIncome: 1900,
        mortgage: 1820,
        utilities: 210,
        hoa: 95,
        sweatIn: 9800,
        sweatOut: 6200,
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
