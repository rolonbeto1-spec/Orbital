import "server-only";
import { prisma } from "@/lib/prisma";
import { getReimbursements } from "@/lib/queries";
import { getBudgetStatus } from "@/lib/budget";
import { getAlertPrefs } from "@/lib/alert-prefs";
import { formatCurrency as formatDollars, formatDateShort } from "@/lib/format";

/** Nudge text is user-facing, so cents are formatted as dollars here. */
const formatCurrency = (cents: number) => formatDollars(centsToDollars(cents));
import { sumCentsBy, centsToDollars } from "@/lib/money";
import { partsInZone } from "@/lib/time";

// Proactive "heads up" messages: the app noticing things so you don't have to.
// Pure heuristics over your own data — no external API.

export interface Nudge {
  id: string;
  tone: "warn" | "info" | "good";
  title: string;
  body: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 1) Budget pace: are you spending faster than the month is passing?
// Uses the user's customized in-budget category set and their reminder
// preferences (half-mark alert, full-budget alert, weekly check-ins).
async function budgetPaceNudge(userId: string, timeZone: string): Promise<Nudge | null> {
  const [status, prefs] = await Promise.all([
    getBudgetStatus(userId, timeZone),
    getAlertPrefs(userId),
  ]);
  const budget = status.limitCents;
  if (budget <= 0) return null;
  const spent = status.spentCents;

  // Month progress is measured in the user's own calendar, not the server's:
  // on the 1st in Auckland it is still the previous month in UTC (§50).
  const now = new Date();
  const { year, month, day: dayOfMonth } = partsInZone(now, timeZone);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthFrac = Math.max(dayOfMonth / daysInMonth, 0.05);
  const projected = spent / monthFrac;
  const usedFrac = spent / budget;

  // Full-budget alert — the loudest one.
  if (prefs.full && spent > budget) {
    return {
      id: "pace-over",
      tone: "warn",
      title: `Over your budget by ${formatCurrency(spent - budget)}`,
      body: `${formatCurrency(spent)} spent of ${formatCurrency(budget)} this month. Fixed bills aren't counted — this is the spending you control.`,
    };
  }

  // Half-mark alert: crossing 50% matters most when the month isn't half over.
  if (prefs.half && usedFrac >= 0.5 && usedFrac < 1) {
    const daysLeft = daysInMonth - dayOfMonth;
    if (monthFrac < 0.45) {
      return {
        id: "half-early",
        tone: "warn",
        title: "Halfway through your budget already",
        body: `You crossed 50% of your ${formatCurrency(budget)} budget in ${dayOfMonth} days — the month has ${daysLeft} days left. At this pace you'd hit about ${formatCurrency(projected)}.`,
      };
    }
    if (monthFrac >= 0.45 && monthFrac <= 0.6 && usedFrac <= 0.6) {
      return {
        id: "half-pace",
        tone: "good",
        title: "Halfway through the month, halfway through the budget",
        body: `${formatCurrency(spent)} of ${formatCurrency(budget)} used — right on pace.`,
      };
    }
  }

  // Weekly check-in: split the month into weeks and report the pace.
  if (prefs.weekly) {
    const week = Math.min(Math.ceil(now.getDate() / 7), Math.ceil(daysInMonth / 7));
    const weeks = Math.ceil(daysInMonth / 7);
    const offPace = usedFrac > monthFrac * 1.15;
    return {
      id: `week-${week}`,
      tone: offPace ? "warn" : "info",
      title: `Week ${week} of ${weeks}: ${Math.round(usedFrac * 100)}% of budget used`,
      body: offPace
        ? `${formatCurrency(spent)} of ${formatCurrency(budget)} — a bit ahead of the calendar. About ${formatCurrency(budget - spent)} left for the rest of the month.`
        : `${formatCurrency(spent)} of ${formatCurrency(budget)} — tracking with the calendar. ${formatCurrency(budget - spent)} left.`,
    };
  }

  if (projected > budget * 1.15) {
    return {
      id: "pace-fast",
      tone: "warn",
      title: "You're not on pace to stay in budget",
      body: `${formatCurrency(spent)} of your ${formatCurrency(budget)} budget is gone with ${daysInMonth - now.getDate()} days left — on track for about ${formatCurrency(projected)}.`,
    };
  }
  if (now.getDate() >= 10 && projected < budget * 0.85) {
    return {
      id: "pace-good",
      tone: "good",
      title: "On pace to come in under budget",
      body: `Spending is tracking to about ${formatCurrency(projected)} against your ${formatCurrency(budget)} budget. Keep it up.`,
    };
  }
  return null;
}

// 2) Unusual big purchase: way above your usual size for that category.
async function bigPurchaseNudge(userId: string): Promise<Nudge | null> {
  const recent = await prisma.transaction.findMany({
    where: { userId, date: { gte: daysAgo(7) }, amountCents: { gt: 5000 }, owedBack: false },
    include: { category: { select: { name: true, group: true } } },
    orderBy: { amountCents: "desc" },
    take: 50,
  });
  for (const t of recent) {
    if (!t.category || t.category.group !== "expense") continue;
    const history = await prisma.transaction.aggregate({
      where: {
        userId,
        categoryId: t.categoryId,
        date: { gte: daysAgo(90), lt: daysAgo(7) },
        amountCents: { gt: 0 },
      },
      _avg: { amountCents: true },
      _count: true,
    });
    const avg = history._avg.amountCents ?? 0;
    if (history._count >= 5 && avg > 0 && t.amountCents > avg * 3) {
      return {
        id: `big-${t.id}`,
        tone: "info",
        title: `What was the ${formatCurrency(t.amountCents)} at ${t.merchantName || t.name}?`,
        body: `That's about ${Math.round(t.amountCents / avg)}× your usual ${t.category.name} purchase. If someone owes you for it, mark it "owed back" and it won't count against you.`,
      };
    }
  }
  return null;
}

// 3) Day-pattern break: eating out on a day you usually don't.
async function dayPatternNudge(userId: string): Promise<Nudge | null> {
  // Categories are per-user rows, so this looks up THIS user's "Food & Dining".
  const cat = await prisma.category.findUnique({
    where: { userId_name: { userId, name: "Food & Dining" } },
    select: { id: true },
  });
  if (!cat) return null;

  const history = await prisma.transaction.findMany({
    where: {
      userId,
      categoryId: cat.id,
      date: { gte: daysAgo(90), lt: daysAgo(7) },
      amountCents: { gt: 0 },
    },
    select: { date: true, amountCents: true },
    take: 2000,
  });
  if (history.length < 10) return null;

  const share = new Array(7).fill(0);
  for (const t of history) share[new Date(t.date).getDay()] += t.amountCents;
  const total = share.reduce((s, x) => s + x, 0);
  if (total <= 0) return null;

  const usualDays = share
    .map((v, i) => ({ i, frac: v / total }))
    .filter((d) => d.frac >= 0.2)
    .map((d) => DAY_NAMES[d.i]);

  const thisWeek = await prisma.transaction.findMany({
    where: { userId, categoryId: cat.id, date: { gte: daysAgo(7) }, amountCents: { gt: 1500 } },
    select: { id: true, date: true, amountCents: true, name: true, merchantName: true },
    orderBy: { amountCents: "desc" },
    take: 50,
  });
  for (const t of thisWeek) {
    const day = new Date(t.date).getDay();
    if (share[day] / total < 0.08 && usualDays.length > 0) {
      return {
        id: `day-${t.id}`,
        tone: "info",
        title: `${DAY_NAMES[day]} takeout is new for you`,
        body: `${formatCurrency(t.amountCents)} at ${t.merchantName || t.name} on a ${DAY_NAMES[day]} — you usually eat out on ${usualDays.join(" and ")}. It digs into that budget.`,
      };
    }
  }
  return null;
}

// 4) Stale reimbursement: someone's been owing you for a while.
async function staleReimbursementNudge(userId: string): Promise<Nudge | null> {
  const { outstanding } = await getReimbursements(userId);
  const stale = outstanding.filter((i) => new Date(i.date) < daysAgo(14));
  if (!stale.length) return null;
  const total = sumCentsBy(stale, (i) => i.outstandingCents);
  const oldest = stale[stale.length - 1];
  return {
    id: "stale-reimb",
    tone: "info",
    title: `Still owed ${formatCurrency(total)}`,
    body: `${oldest.name} from ${formatDateShort(oldest.date)} is still ${formatCurrency(oldest.outstandingCents)} outstanding. Might be time for a nudge.`,
  };
}

/** Heads-up nudges for one user, computed from their own data only. */
export async function getNudges(userId: string, timeZone: string): Promise<Nudge[]> {
  const results = await Promise.all([
    budgetPaceNudge(userId, timeZone),
    bigPurchaseNudge(userId),
    dayPatternNudge(userId),
    staleReimbursementNudge(userId),
  ]);
  return results.filter((n): n is Nudge => n !== null).slice(0, 3);
}
