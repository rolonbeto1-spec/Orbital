import "server-only";
import { prisma } from "@/lib/prisma";
import { getNetWorth } from "@/lib/queries";
import { currentMonthRange, partsInZone, zonedTimeToUtc } from "@/lib/time";
import type { AuthedUser } from "@/lib/security/session";
import { formatCurrency } from "@/lib/format";
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
    where: { userId, date: { gte: start, lte: end }, amount: { gt: 0 } },
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
    total += t.amount;
    const cn = t.category?.name ?? "Other";
    byCat[cn] = (byCat[cn] ?? 0) + t.amount;
    const mn = t.merchantName || t.name;
    byMerchant[mn] = byMerchant[mn] || { total: 0, count: 0 };
    byMerchant[mn].total += t.amount;
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
      answer: `Your net worth is ${formatCurrency(nw.netWorth)} — ${formatCurrency(nw.assets)} in assets minus ${formatCurrency(nw.liabilities)} in debt.`,
      detail: [
        { label: "Assets", value: formatCurrency(nw.assets) },
        { label: "Debt", value: formatCurrency(nw.liabilities) },
        { label: "Net worth", value: formatCurrency(nw.netWorth) },
      ],
    };
  }

  // income / earnings
  if (/how much did i (make|earn)|my income|got paid|paid this/.test(q)) {
    const txns = await prisma.transaction.findMany({
      where: { userId: user.id, date: { gte: win.start, lte: win.end }, amount: { lt: 0 } },
      include: { category: { select: { group: true } } },
      take: 5000,
    });
    const income = txns.filter((t) => t.category?.group === "income").reduce((s, t) => s - t.amount, 0);
    return { answer: `You brought in ${formatCurrency(income)} ${win.label}.` };
  }

  // budget pace (the user's customizable in-budget set)
  if (/budget|on pace|on track|overspend|spending too much/.test(q)) {
    const status = await getBudgetStatus(user.id, user.timezone);
    const total = status.spent;
    const budget = status.limit > 0 ? status.limit : 2000; // fallback target
    const remaining = budget - total;
    const over = remaining < 0;
    return {
      answer: over
        ? `You're ${formatCurrency(-remaining)} over your budget this month — ${formatCurrency(total)} spent of a ${formatCurrency(budget)} target. (Only categories you count in your budget are included — bills and fixed costs stay out unless you add them.)`
        : `You're on track: ${formatCurrency(total)} of your ${formatCurrency(budget)} budget this month, ${formatCurrency(remaining)} left. Only the categories you count are included.`,
      detail: [
        { label: "Spent (in budget)", value: formatCurrency(total) },
        { label: "Budget", value: formatCurrency(budget) },
        { label: over ? "Over by" : "Left", value: formatCurrency(Math.abs(remaining)) },
      ],
    };
  }

  // goal planning: "how much to save for <$amount> by <month/date>"
  const goalMatch = q.match(/\$?([\d,]+(?:\.\d+)?)\s*(k|thousand)?/);
  if (/save|saving|goal|afford/.test(q) && goalMatch) {
    let target = parseFloat(goalMatch[1].replace(/,/g, ""));
    if (goalMatch[2]) target *= 1000;
    const months = extractMonths(q);
    if (target > 0 && months > 0) {
      const perMonth = target / months;
      return {
        answer: `To reach ${formatCurrency(target)} in ${months} month${months > 1 ? "s" : ""}, save about ${formatCurrency(perMonth)} per month (${formatCurrency(perMonth / 4.33)} a week).`,
        detail: [
          { label: "Goal", value: formatCurrency(target) },
          { label: "Timeframe", value: `${months} months` },
          { label: "Per month", value: formatCurrency(perMonth) },
        ],
      };
    }
    if (target > 0) {
      return { answer: `To save ${formatCurrency(target)}, tell me your timeframe (e.g. "…by December" or "in 18 months") and I'll break it down per month.` };
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
        answer: `Your top spots ${win.label}: ${top.slice(0, 3).map(([n, v]) => `${n} (${formatCurrency(v.total)})`).join(", ")}.`,
        detail: top.map(([n, v]) => ({ label: n, value: formatCurrency(v.total) })),
      };
    }
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) return { answer: `No spending found ${win.label}.` };
    return {
      answer: `Your biggest category ${win.label} was ${top[0][0]} at ${formatCurrency(top[0][1])} — that's ${Math.round((top[0][1] / total) * 100)}% of the ${formatCurrency(total)} you spent.`,
      detail: top.map(([n, v]) => ({ label: n, value: formatCurrency(v) })),
    };
  }

  // spend on a category (or overall) for a window
  if (/how much|spent|spend|spending/.test(q)) {
    const cat = resolveCategories(q);
    const { total, byMerchant } = await spendIn(user.id, cat ? cat.names : null, win.start, win.end);
    if (cat) {
      const top = Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total).slice(0, 4);
      return {
        answer: `You spent ${formatCurrency(total)} on ${cat.label} ${win.label}.`,
        detail: top.map(([n, v]) => ({ label: `${n} · ${v.count}×`, value: formatCurrency(v.total) })),
      };
    }
    return { answer: `You spent ${formatCurrency(total)} total ${win.label}.` };
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

