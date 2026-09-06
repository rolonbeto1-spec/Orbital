import "server-only";
import { prisma } from "@/lib/prisma";
import {
  getNetWorth,
  getCashflow,
  getSpendingByCategory,
  getBudgetsWithSpend,
  getReimbursements,
} from "@/lib/queries";
import { currentMonthRange, monthRangeInZone, partsInZone } from "@/lib/time";
import { NEEDS_CATEGORIES, WANTS_CATEGORIES } from "@/lib/buckets";
import { categoryInBudget } from "@/lib/budget";
import { detectRecurring } from "@/lib/recurring";
import { asCents, centsToDollars, type CentsLike } from "@/lib/money";
import type { AssistantAnswer } from "@/lib/assistant";
import type { AuthedUser } from "@/lib/security/session";
import { askClaude, claimAiCall, untrusted, untrustedBlock } from "@/lib/ai/guard";
import { env } from "@/lib/env";

/**
 * The natural-language assistant (§30, §31).
 *
 * Three properties this file is responsible for:
 *
 *  1. The snapshot is built from ONE user's data, by an explicit projection.
 *     Every query below is scoped by userId, and every field sent is named
 *     here by hand. No Prisma row is spread into the payload, so a column
 *     added to the schema later — an encrypted token, an internal flag —
 *     cannot start being sent to Anthropic by accident (§30).
 *
 *  2. Attacker-controlled strings inside that snapshot (merchant names,
 *     transaction descriptions, folder names, the user's own notes) are
 *     wrapped as untrusted data and length-bounded, and the standing system
 *     preamble in ai/guard.ts tells the model they are data (§31).
 *
 *  3. The model has no tools. It cannot query the database, call an API, or
 *     reach another tenant's data — so even a fully successful prompt
 *     injection can only make it say something wrong, which is the
 *     structural containment the delimiters alone would not give (§31).
 *
 * What is deliberately NOT in the snapshot: Plaid tokens, access credentials,
 * session identifiers, API keys, database identifiers, email addresses, the
 * user's name, or any account or routing number (§30).
 */

export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export interface ChatTurn {
  role: "user" | "bot";
  text: string;
}

/** How much history to carry. Bounded so a long chat cannot grow the bill. */
const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_CHARS = 1000;

/**
 * Build the financial snapshot for one user.
 *
 * Note the shape of the identifiers: the model receives category *names* and
 * merchant *names*, never database ids. It has nothing to echo back that
 * could address a row, which is part of why the structured-action path
 * (assistant-actions.ts) resolves everything by ownership-checked lookup
 * rather than by trusting an id from the model (§32).
 */
async function buildContext(user: AuthedUser): Promise<string> {
  const now = new Date();
  const timeZone = user.timezone;

  const { start: monthStart, end: monthEnd } = currentMonthRange(timeZone);
  const { year, month } = partsInZone(now, timeZone);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const { start: prevStart, end: prevEnd } = monthRangeInZone(timeZone, prevYear, prevMonth);

  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 45);

  const [
    netWorth, cashflow, spendNow, spendPrev, budgets, reimbursements,
    accounts, goals, properties, recent, holdings, recurring,
  ] = await Promise.all([
    getNetWorth(user.id),
    getCashflow(user.id, monthStart, monthEnd),
    getSpendingByCategory(user.id, monthStart, monthEnd),
    getSpendingByCategory(user.id, prevStart, prevEnd),
    getBudgetsWithSpend(user.id, timeZone),
    getReimbursements(user.id),
    prisma.account.findMany({
      where: { userId: user.id },
      select: {
        name: true, type: true, subtype: true, currentBalanceCents: true,
        item: { select: { institutionName: true } },
      },
    }),
    prisma.goal.findMany({
      where: { userId: user.id },
      select: {
        name: true, targetAmountCents: true, currentAmountCents: true, targetDate: true,
      },
    }),
    prisma.property.findMany({
      where: { userId: user.id },
      select: {
        name: true, rentIncomeCents: true, mortgageCents: true, utilitiesCents: true,
        hoaCents: true, sweatInCents: true, sweatOutCents: true,
      },
    }),
    prisma.transaction.findMany({
      where: { userId: user.id, date: { gte: recentStart } },
      select: {
        date: true, name: true, merchantName: true, amountCents: true, owedBack: true,
        category: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 60,
    }),
    prisma.holding.findMany({
      where: { userId: user.id },
      select: {
        symbol: true, name: true, kind: true, quantity: true, valueCents: true,
        account: { select: { name: true } },
      },
      take: 200,
    }),
    detectRecurring(user.id),
  ]);

  // The model is given dollars, because a language model reasons about
  // "$84.21" far better than "8421 cents". This is the same display
  // conversion the HTTP boundary performs; no arithmetic happens after it.
  const d = (cents: CentsLike) => centsToDollars(cents);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  // Merchant and account names come from banks and from the user; they are
  // the injection surface, so every one is scrubbed and bounded.
  const text = (value: string, max = 80) => untrusted(value, max);

  const context = {
    today: day(now),
    timezone: timeZone,
    net_worth: {
      assets: d(netWorth.assetsCents),
      debt: d(netWorth.liabilitiesCents),
      net: d(netWorth.netWorthCents),
      cash: d(netWorth.cashCents),
      credit_card_debt_not_yet_paid: d(netWorth.cardDebtCents),
      truly_available: d(netWorth.trueAvailableCents),
    },
    this_month: {
      income: d(cashflow.incomeCents),
      spending: d(cashflow.spendingCents),
      spending_by_category: spendNow.map((c) => ({ category: c.name, spent: d(c.totalCents) })),
    },
    last_month_spending_by_category: spendPrev.map((c) => ({
      category: c.name,
      spent: d(c.totalCents),
    })),
    budgets: budgets.map((b) => ({
      category: b.category.name,
      limit: d(b.limitCents),
      spent_this_month: d(b.spentCents),
      in_my_budget: categoryInBudget(b.category),
    })),
    accounts: accounts.map((a) => ({
      name: text(a.name, 60),
      bank: text(a.item.institutionName, 60),
      type: a.type,
      subtype: a.subtype,
      balance: d(a.currentBalanceCents ?? 0),
    })),
    goals: goals.map((g) => ({
      name: text(g.name, 60),
      target: d(g.targetAmountCents),
      saved: d(g.currentAmountCents),
      deadline: g.targetDate ? day(g.targetDate) : null,
    })),
    rental_properties: properties.map((p) => ({
      name: text(p.name, 60),
      rent_income: d(p.rentIncomeCents),
      mortgage: d(p.mortgageCents),
      utilities: d(p.utilitiesCents),
      hoa: d(p.hoaCents),
      monthly_net: d(
        asCents(p.rentIncomeCents) -
          asCents(p.mortgageCents) -
          asCents(p.utilitiesCents) -
          asCents(p.hoaCents),
      ),
      sweat_equity_put_in: d(p.sweatInCents),
      sweat_equity_gotten_out: d(p.sweatOutCents),
    })),
    investment_holdings: holdings.map((h) => ({
      account: text(h.account.name, 60),
      symbol: text(h.symbol, 20),
      name: text(h.name, 60),
      kind: h.kind,
      quantity: h.quantity,
      value: d(h.valueCents),
    })),
    recurring_bills_and_subscriptions: recurring.map((r) => ({
      merchant: text(r.merchant),
      cadence: r.cadence,
      typical_amount: d(r.amountCents),
      monthly_cost: d(r.monthlyCostCents),
      next_expected: r.nextExpected.slice(0, 10),
    })),
    money_owed_back_to_user: reimbursements.outstanding.map((t) => ({
      merchant: text(t.name),
      date: day(t.date),
      amount: d(t.amountCents),
      already_repaid: d(t.reimbursedCents),
    })),
    recent_transactions: recent.map((t) => ({
      date: day(t.date),
      merchant: text(t.merchantName || t.name),
      amount: d(t.amountCents),
      category: t.category?.name ?? "Uncategorized",
      owed_back: t.owedBack || undefined,
    })),
  };

  return JSON.stringify(context);
}

const SYSTEM = `You are Metta's built-in money assistant, powered by Anthropic's Claude. You answer questions about the user's own money using ONLY the JSON snapshot provided — never invent numbers.

What the app can DO (never claim these are impossible or "up to a data team" — this is the user's own app and these are built in):
- Saying "sort my transactions" (or organize/categorize them) makes the app's AI sorter re-file miscategorized and "Other" transactions automatically.
- Tapping any transaction in Activity lets the user recategorize it by hand, and the app permanently learns that correction.
- Merchant logos attach automatically as transactions sync in from the bank.
- "Save this <merchant> charge to my <name> folder" and "remind me at half my budget" are real commands this chat executes.
- Telling this chat "the <merchant> charge is <category>" (e.g. "the Chevron charge is Transportation") re-files that merchant's charges and permanently teaches the rule.
When the user complains about sorting or asks you to fix categories, tell them to say "sort my transactions" right here in the chat — that phrase triggers the sorter.

What the app CANNOT do, ever: move money. Metta's bank connection is read-only. It cannot transfer, pay bills, send money, or make purchases. If asked to move money, say plainly that Metta can only look, never touch.

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

/**
 * Ask the model a question, grounded in the signed-in user's snapshot.
 *
 * The AI budget is claimed BEFORE the snapshot is built and before the
 * request is sent, so a user who is out of allowance never causes a paid call
 * and never has their financial data assembled for one (§33).
 */
export async function askLLM(
  user: AuthedUser,
  question: string,
  history: ChatTurn[] = [],
): Promise<AssistantAnswer> {
  // Throws AiBudgetExceeded, which the route turns into a graceful fallback.
  await claimAiCall(user);

  const context = await buildContext(user);

  // Conversation history is the user's own prior text: untrusted, bounded,
  // and folded into the single user message rather than replayed as
  // assistant turns the model might treat as its own instructions.
  const priorTurns = history
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => `${turn.role === "user" ? "User" : "Metta"}: ${untrusted(turn.text, 400)}`)
    .join("\n")
    .slice(-MAX_HISTORY_CHARS);

  const answer = (
    await askClaude({
      system: SYSTEM,
      userContent:
        `<financial_snapshot>${context}</financial_snapshot>\n\n` +
        (priorTurns ? `Recent conversation:\n${untrustedBlock(priorTurns)}\n\n` : "") +
        `Question: ${untrustedBlock(untrusted(question, 2000))}`,
      maxTokens: 600,
    })
  ).trim();

  if (!answer) throw new Error("Empty answer from model");
  return { answer };
}
