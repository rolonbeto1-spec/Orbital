import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import {
  getNetWorth,
  getCashflow,
  getSpendingByCategory,
  getBudgetsWithSpend,
  getReimbursements,
  currentMonthRange,
} from "@/lib/queries";
import { NEEDS_CATEGORIES, WANTS_CATEGORIES } from "@/lib/buckets";
import { categoryInBudget } from "@/lib/budget";
import { detectRecurring } from "@/lib/recurring";
import type { AssistantAnswer } from "@/lib/assistant";

// The natural-language upgrade for the assistant. Activated by setting
// ANTHROPIC_API_KEY in .env — without a key the app keeps using the built-in
// rule engine in assistant.ts, so this file is entirely optional at runtime.

export function llmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ChatTurn {
  role: "user" | "bot";
  text: string;
}

// Chat model — owner's choice via the AI_MODEL env var. Defaults to Haiku,
// which answers snapshot-grounded questions well at a fraction of the cost.
const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";

// Daily ceiling on AI calls, as a runaway backstop rather than a leash.
// Owner-tunable via AI_DAILY_LIMIT; set it to 0 for no limit at all.
// Past the ceiling the caller's fallback answers via the rule engine.
const DAILY_CALL_LIMIT = (() => {
  const raw = process.env.AI_DAILY_LIMIT;
  if (raw == null || raw.trim() === "") return 1000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 1000;
})();

export async function spendOneDailyCall(): Promise<void> {
  if (DAILY_CALL_LIMIT <= 0) return; // owner turned the limit off
  const key = `aiCalls:${new Date().toISOString().slice(0, 10)}`;
  const row = await prisma.setting.findUnique({ where: { key } });
  const used = row ? parseInt(row.value, 10) || 0 : 0;
  if (used >= DAILY_CALL_LIMIT) {
    throw new Error(`Daily AI budget reached (${DAILY_CALL_LIMIT} questions)`);
  }
  await prisma.setting.upsert({
    where: { key },
    update: { value: String(used + 1) },
    create: { key, value: "1" },
  });
}

// Everything the model needs to answer, in one compact snapshot. Sent fresh on
// every question so answers always reflect the current database.
async function buildContext(): Promise<string> {
  const now = new Date();
  const { start: monthStart, end: monthEnd } = currentMonthRange();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 45);

  const [netWorth, cashflow, spendNow, spendPrev, budgets, reimb, accounts, goals, properties, recent, holdings, recurring] =
    await Promise.all([
      getNetWorth(),
      getCashflow(monthStart, monthEnd),
      getSpendingByCategory(monthStart, monthEnd),
      getSpendingByCategory(prevStart, prevEnd),
      getBudgetsWithSpend(),
      getReimbursements(),
      prisma.account.findMany({ include: { item: true } }),
      prisma.goal.findMany(),
      prisma.property.findMany(),
      prisma.transaction.findMany({
        where: { date: { gte: recentStart } },
        include: { category: true },
        orderBy: { date: "desc" },
        take: 60,
      }),
      prisma.holding.findMany({ include: { account: { select: { name: true } } } }),
      detectRecurring(),
    ]);

  const d = (v: number) => Math.round(v * 100) / 100;
  const day = (dt: Date) => dt.toISOString().slice(0, 10);

  const ctx = {
    today: day(now),
    net_worth: {
      assets: d(netWorth.assets),
      debt: d(netWorth.liabilities),
      net: d(netWorth.netWorth),
      cash: d(netWorth.cash),
      credit_card_debt_not_yet_paid: d(netWorth.cardDebt),
      truly_available: d(netWorth.trueAvailable),
    },
    this_month: {
      income: d(cashflow.income),
      spending: d(cashflow.spending),
      spending_by_category: spendNow.map((c) => ({ category: c.name, spent: d(c.total) })),
    },
    last_month_spending_by_category: spendPrev.map((c) => ({ category: c.name, spent: d(c.total) })),
    budgets: budgets.map((b) => ({
      category: b.category.name,
      limit: d(b.limit),
      spent_this_month: d(b.spent),
      in_my_budget: categoryInBudget(b.category),
    })),
    accounts: accounts.map((a) => ({
      name: a.name,
      bank: a.item.institutionName,
      type: a.type,
      subtype: a.subtype,
      balance: d(a.currentBalance ?? 0),
    })),
    goals: goals.map((g) => ({
      name: g.name,
      target: d(g.targetAmount),
      saved: d(g.currentAmount),
      deadline: g.targetDate ? day(g.targetDate) : null,
    })),
    rental_properties: properties.map((p) => ({
      name: p.name,
      rent_income: d(p.rentIncome),
      mortgage: d(p.mortgage),
      utilities: d(p.utilities),
      hoa: d(p.hoa),
      monthly_net: d(p.rentIncome - p.mortgage - p.utilities - p.hoa),
      sweat_equity_put_in: d(p.sweatIn),
      sweat_equity_gotten_out: d(p.sweatOut),
    })),
    investment_holdings: holdings.map((h) => ({
      account: h.account.name,
      symbol: h.symbol,
      name: h.name,
      kind: h.kind,
      quantity: h.quantity,
      value: d(h.value),
    })),
    recurring_bills_and_subscriptions: recurring.map((r) => ({
      merchant: r.merchant,
      cadence: r.cadence,
      typical_amount: d(r.amount),
      monthly_cost: d(r.monthlyCost),
      next_expected: r.nextExpected.slice(0, 10),
    })),
    money_owed_back_to_user: reimb.outstanding.map((t) => ({
      merchant: t.name,
      date: day(t.date),
      amount: d(t.amount),
      already_repaid: d(t.reimbursed),
    })),
    recent_transactions: recent.map((t) => ({
      date: day(t.date),
      merchant: t.merchantName || t.name,
      amount: d(t.amount),
      category: t.category?.name ?? "Uncategorized",
      owed_back: t.owedBack || undefined,
    })),
  };
  return JSON.stringify(ctx);
}

const SYSTEM = `You are Metta's built-in money assistant, powered by Anthropic's Claude. You answer questions about the user's own money using ONLY the JSON snapshot provided — never invent numbers.

What the app can DO (never claim these are impossible or "up to a data team" — this is the user's own app and these are built in):
- Saying "sort my transactions" (or organize/categorize them) makes the app's AI sorter re-file miscategorized and "Other" transactions automatically.
- Tapping any transaction in Activity lets the user recategorize it by hand, and the app permanently learns that correction.
- Merchant logos attach automatically as transactions sync in from the bank.
- "Save this <merchant> charge to my <name> folder" and "remind me at half my budget" are real commands this chat executes.
- Telling this chat "the <merchant> charge is <category>" (e.g. "the Chevron charge is Transportation") re-files that merchant's charges and permanently teaches the rule.
When the user complains about sorting or asks you to fix categories, tell them to say "sort my transactions" right here in the chat — that phrase triggers the sorter.

Rules of the app you must respect:
- Transaction amounts follow Plaid's convention: positive = money spent, negative = money received.
- "Budget" counts only the categories the user chose to include (marked in_my_budget in the snapshot; defaults to discretionary Wants). Needs categories (${NEEDS_CATEGORIES.join(", ")}) are tracked but stay out of the budget unless the user added them. Wants categories are: ${WANTS_CATEGORIES.join(", ")}.
- "Truly available" = cash minus credit-card balances whose statement hasn't been paid yet. Prefer it over raw cash when the user asks what they can spend.
- Purchases marked owed_back are expected to be repaid to the user (reimbursements).

Style:
- Answer in 1-3 short conversational sentences. Round money to whole dollars ($1,234). No markdown, no headers, no bullet lists in the answer.
- Do the math for goal questions (per month / per week amounts).
- If the data genuinely can't answer the question, say so briefly and suggest what you can answer.
- This is the user's own financial data shown back to them in their own app.`;

export async function askLLM(question: string, history: ChatTurn[] = []): Promise<AssistantAnswer> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });
  const context = await buildContext();

  const messages: Anthropic.MessageParam[] = [
    // Recent conversation so follow-ups like "and last week?" keep their meaning.
    ...history.slice(-8).map(
      (t): Anthropic.MessageParam => ({
        role: t.role === "user" ? "user" : "assistant",
        content: t.text,
      }),
    ),
    {
      role: "user",
      content: `<financial_snapshot>${context}</financial_snapshot>\n\nQuestion: ${question}`,
    },
  ];

  await spendOneDailyCall();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages,
  });

  const answer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!answer) throw new Error("Empty answer from model");
  return { answer };
}
