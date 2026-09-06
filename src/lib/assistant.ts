import "server-only";
import { prisma } from "@/lib/prisma";
import { getNetWorth } from "@/lib/queries";
import { currentMonthRange, partsInZone, zonedTimeToUtc } from "@/lib/time";
import type { AuthedUser } from "@/lib/security/session";
import { formatCents } from "@/lib/format";
import { asCents, dollarsToCents, sumCentsBy } from "@/lib/money";

import { getBudgetStatus } from "@/lib/budget";

// A small, deterministic question-answering engine over the user's finances.
// It needs no external API — it parses the question, resolves a time window and
// (optionally) categories, and answers from the database. The shape is designed
// so a real LLM can be dropped in later behind the same interface.

export interface AssistantAnswer {
  answer: string;
  detail?: { label: string; value: string }[];
}

// ---- time window parsing ----
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sun
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseWindow(q: string, timeZone: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (/\btoday\b/.test(q)) {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    return { start: s, end, label: "today" };
  }
  if (/\byesterday\b/.test(q)) {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: "yesterday" };
  }
  if (/last month/.test(q)) {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { start: s, end: e, label: "last month" };
  }
  if (/this week|\bthis wk\b/.test(q) || /\bweek\b/.test(q)) {
    if (/last week/.test(q)) {
      const s = startOfWeek(now); s.setDate(s.getDate() - 7);
      const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: "last week" };
    }
    return { start: startOfWeek(now), end, label: "this week" };
  }
  const nDays = q.match(/last (\d{1,3}) days?/);
  if (nDays) {
    const s = new Date(now); s.setDate(s.getDate() - Number(nDays[1])); s.setHours(0, 0, 0, 0);
    return { start: s, end, label: `the last ${nDays[1]} days` };
  }
  if (/this year|\byear\b/.test(q)) {
    // The user's calendar year, not the server's (§50).
    const { year } = partsInZone(now, timeZone);
    return { start: zonedTimeToUtc(timeZone, year, 1, 1), end, label: "this year" };
  }
  // default: this month
  const { start } = currentMonthRange(timeZone);
  return { start, end, label: "this month" };
}

// ---- category resolution ----
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  "Food & Dining": ["dining", "restaurant", "restaurants", "eat", "eating", "takeout", "take out", "coffee", "lunch", "dinner"],
  Groceries: ["grocery", "groceries", "supermarket"],
  Transportation: ["gas", "fuel", "transport", "transportation", "uber", "lyft", "commute", "parking"],
  Shopping: ["shopping", "shop", "amazon", "clothes", "clothing"],
  "Bills & Utilities": ["bill", "bills", "utility", "utilities", "electric", "electricity", "internet", "phone", "water"],
  Housing: ["rent", "housing", "mortgage"],
  Entertainment: ["entertainment", "movies", "movie", "netflix", "spotify", "games", "streaming"],
  Health: ["health", "medical", "doctor", "pharmacy", "medicine", "gym"],
  Travel: ["travel", "flight", "flights", "hotel", "airbnb", "vacation", "trip"],
  "Personal Care": ["personal care", "haircut", "salon", "spa"],
  Services: ["services", "insurance", "subscription", "subscriptions"],
};

// "food" is a common ambiguous ask → treat as dining + groceries.
function resolveCategories(q: string): { names: string[]; label: string } | null {
  if (/\bfood\b/.test(q)) return { names: ["Food & Dining", "Groceries"], label: "food" };
  for (const [cat, syns] of Object.entries(CATEGORY_SYNONYMS)) {
    if (syns.some((s) => q.includes(s)) || q.includes(cat.toLowerCase())) {
      return { names: [cat], label: cat.toLowerCase() };
    }
  }
  return null;
}

// ---- query helpers ----
async function spendIn(userId: string, names: string[] | null, start: Date, end: Date) {
  const txns = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lte: end }, amountCents: { gt: 0 } },
    include: { category: { select: { name: true, group: true } } },
    take: 5000,
  });
  let total = 0;
  const byCat: Record<string, number> = {};
  const byMerchant: Record<string, { total: number; count: number }> = {};
  for (const t of txns) {
    const group = t.category?.group ?? "expense";
    if (group !== "expense") continue; // exclude transfers/income
    if (names && !(t.category && names.includes(t.category.name))) continue;
    const amountCents = asCents(t.amountCents);
    total += amountCents;
    const cn = t.category?.name ?? "Other";
    byCat[cn] = (byCat[cn] ?? 0) + amountCents;
    const mn = t.merchantName || t.name;
    byMerchant[mn] = byMerchant[mn] || { total: 0, count: 0 };
    byMerchant[mn].total += amountCents;
    byMerchant[mn].count++;
  }
  return { total, byCat, byMerchant };
}

// ---- intent handlers ----
/**
 * The built-in rule engine, scoped to one user.
 *
 * This is the fallback that keeps chat working with no API key, past the AI
 * budget, or when the model call fails. Like everything else, it reads only
 * the caller's own data.
 */
export async function ask(user: AuthedUser, question: string): Promise<AssistantAnswer> {
  const q = question.toLowerCase().trim();
  const win = parseWindow(q, user.timezone);

  // net worth / how much do I have
  if (/net worth|how much (money )?do i have|total balance|how much am i worth/.test(q)) {
    const nw = await getNetWorth(user.id);
    return {
      answer: `Your net worth is ${formatCents(nw.netWorthCents)} — ${formatCents(nw.assetsCents)} in assets minus ${formatCents(nw.liabilitiesCents)} in debt.`,
      detail: [
        { label: "Assets", value: formatCents(nw.assetsCents) },
        { label: "Debt", value: formatCents(nw.liabilitiesCents) },
        { label: "Net worth", value: formatCents(nw.netWorthCents) },
      ],
    };
  }

  // income / earnings
  if (/how much did i (make|earn)|my income|got paid|paid this/.test(q)) {
    const txns = await prisma.transaction.findMany({
      where: { userId: user.id, date: { gte: win.start, lte: win.end }, amountCents: { lt: 0 } },
      include: { category: { select: { group: true } } },
      take: 5000,
    });
    const income = sumCentsBy(
      txns.filter((t) => t.category?.group === "income"),
      (t) => -t.amountCents,
    );
    return { answer: `You brought in ${formatCents(income)} ${win.label}.` };
  }

  // budget pace (the user's customizable in-budget set)
  if (/budget|on pace|on track|overspend|spending too much/.test(q)) {
    const status = await getBudgetStatus(user.id, user.timezone);
    const total = status.spentCents;
    // Fallback target when no budget is set: $2,000, in cents.
    const budget = status.limitCents > 0 ? status.limitCents : 200_000;
    const remaining = budget - total;
    const over = remaining < 0;
    return {
      answer: over
        ? `You're ${formatCents(-remaining)} over your budget this month — ${formatCents(total)} spent of a ${formatCents(budget)} target. (Only categories you count in your budget are included — bills and fixed costs stay out unless you add them.)`
        : `You're on track: ${formatCents(total)} of your ${formatCents(budget)} budget this month, ${formatCents(remaining)} left. Only the categories you count are included.`,
      detail: [
        { label: "Spent (in budget)", value: formatCents(total) },
        { label: "Budget", value: formatCents(budget) },
        { label: over ? "Over by" : "Left", value: formatCents(Math.abs(remaining)) },
      ],
    };
  }

  // goal planning: "how much to save for <$amount> by <month/date>"
  const goalMatch = q.match(/\$?([\d,]+(?:\.\d+)?)\s*(k|thousand)?/);
  if (/save|saving|goal|afford/.test(q) && goalMatch) {
    let target = parseFloat(goalMatch[1].replace(/,/g, ""));
    if (goalMatch[2]) target *= 1000;
    // The only dollars in this file: the user typed them. Convert once, here,
    // so everything below is exact cents like the rest of the module.
    const targetCents = dollarsToCents(target);
    const months = extractMonths(q);
    if (targetCents > 0 && months > 0) {
      const perMonthCents = Math.round(targetCents / months);
      return {
        answer: `To reach ${formatCents(targetCents)} in ${months} month${months > 1 ? "s" : ""}, save about ${formatCents(perMonthCents)} per month (${formatCents(Math.round(perMonthCents / 4.33))} a week).`,
        detail: [
          { label: "Goal", value: formatCents(targetCents) },
          { label: "Timeframe", value: `${months} months` },
          { label: "Per month", value: formatCents(perMonthCents) },
        ],
      };
    }
    if (targetCents > 0) {
      return { answer: `To save ${formatCents(targetCents)}, tell me your timeframe (e.g. "…by December" or "in 18 months") and I'll break it down per month.` };
    }
  }

  // top category / biggest expense
  if (/most on|biggest|top (category|categories|expense|spending)|where.*money go|where did i spend/.test(q)) {
    const cat = resolveCategories(q);
    const { byCat, byMerchant, total } = await spendIn(user.id, cat ? cat.names : null, win.start, win.end);
    if (/merchant|store|place/.test(q) || (cat && /where/.test(q))) {
      const top = Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
      if (!top.length) return { answer: `No spending found ${win.label}.` };
      return {
        answer: `Your top spots ${win.label}: ${top.slice(0, 3).map(([n, v]) => `${n} (${formatCents(v.total)})`).join(", ")}.`,
        detail: top.map(([n, v]) => ({ label: n, value: formatCents(v.total) })),
      };
    }
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) return { answer: `No spending found ${win.label}.` };
    return {
      answer: `Your biggest category ${win.label} was ${top[0][0]} at ${formatCents(top[0][1])} — that's ${Math.round((top[0][1] / total) * 100)}% of the ${formatCents(total)} you spent.`,
      detail: top.map(([n, v]) => ({ label: n, value: formatCents(v) })),
    };
  }

  // spend on a category (or overall) for a window
  if (/how much|spent|spend|spending/.test(q)) {
    const cat = resolveCategories(q);
    const { total, byMerchant } = await spendIn(user.id, cat ? cat.names : null, win.start, win.end);
    if (cat) {
      const top = Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total).slice(0, 4);
      return {
        answer: `You spent ${formatCents(total)} on ${cat.label} ${win.label}.`,
        detail: top.map(([n, v]) => ({ label: `${n} · ${v.count}×`, value: formatCents(v.total) })),
      };
    }
    return { answer: `You spent ${formatCents(total)} total ${win.label}.` };
  }

  // fallback
  return {
    answer:
      "I can answer things like: “How much did I spend on food this week?”, “What did I spend the most on this month?”, “Am I on budget?”, “What's my net worth?”, or “How much should I save to reach $5,000 by December?”",
  };
}

function extractMonths(q: string): number {
  const inN = q.match(/in (\d{1,3}) months?/);
  if (inN) return Number(inN[1]);
  const inYears = q.match(/in (\d{1,2}) years?/);
  if (inYears) return Number(inYears[1]) * 12;
  // "by <month name>" — months from now until that month
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const byMonth = q.match(/by (\w+)/);
  if (byMonth) {
    const idx = MONTHS.indexOf(byMonth[1]);
    if (idx >= 0) {
      const now = new Date();
      let m = idx - now.getMonth();
      if (m <= 0) m += 12;
      return m;
    }
  }
  return 0;
}

