import { prisma } from "@/lib/prisma";
import { NEEDS_CATEGORIES, WANTS_CATEGORIES } from "@/lib/buckets";
import { getBudgetStatus, type BudgetStatus } from "@/lib/budget";
import { getNetWorth, getCashflow, currentMonthRange } from "@/lib/queries";

// Data for the honeycomb home screen: your money in the center, branching into
// Needs / Wants / Investing / Rentals, each with satellite cells. Everything is
// computed from live data over a trailing window, with a same-length previous
// window for trends.

const WINDOW_DAYS = 35;

export interface HiveItem {
  id: string;
  kind: "category" | "account" | "property";
  name: string;
  icon: string;
  value: number; // drives cell size; meaning depends on kind (spend / balance / rent)
  display?: string; // optional label override (e.g. balance for accounts)
  categoryId?: string;
  trendPct?: number; // % change vs previous window (categories)
  trendGood?: boolean; // whether the trend/state is good (green) or bad (red)
  property?: {
    rentIncome: number;
    mortgage: number;
    utilities: number;
    hoa: number;
    net: number;
    sweatIn: number;
    sweatOut: number;
  };
  balance?: number;
  isBusiness?: boolean;
}

export interface HiveBranch {
  id: "needs" | "wants" | "invest" | "rentals";
  label: string;
  icon: string;
  blurb: string;
  value: number;
  pct: number;
  items: HiveItem[];
}

// A hive window: what span you're looking at, plus a matched previous span
// for the trend badges. Specs: null/"35d" (default trailing window), "week",
// "month" (this month so far, compared to the same days of last month), or
// "month:YYYY-MM" (a full specific month vs the month before it).
export interface HiveWindowSpec {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
}

export function resolveWindow(spec?: string | null): HiveWindowSpec {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  if (spec === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    return { start, end: endOfDay, prevStart, prevEnd: start, label: "Past 7 days" };
  }
  if (spec === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 23, 59, 59, 999);
    return {
      start,
      end: endOfDay,
      prevStart,
      prevEnd,
      label: now.toLocaleDateString("en-US", { month: "long" }),
    };
  }
  const m = spec?.match(/^month:(\d{4})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const start = new Date(y, mo, 1);
    const end = new Date(y, mo + 1, 0, 23, 59, 59, 999);
    const prevStart = new Date(y, mo - 1, 1);
    const prevEnd = new Date(y, mo, 0, 23, 59, 59, 999);
    return {
      start,
      end,
      prevStart,
      prevEnd,
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }
  // default: trailing window
  const start = new Date(now);
  start.setDate(start.getDate() - WINDOW_DAYS);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - WINDOW_DAYS);
  return { start, end: endOfDay, prevStart, prevEnd: start, label: `Past ${WINDOW_DAYS} days` };
}

export async function getHive(windowSpec?: string | null) {
  const win = resolveWindow(windowSpec);

  const [txns, categories, accounts, properties] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: win.prevStart, lte: win.end }, account: { isBusiness: false } },
      include: { category: true },
    }),
    prisma.category.findMany(),
    prisma.account.findMany(),
    prisma.property.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const inWindow = txns.filter((t) => t.date >= win.start && t.date <= win.end);
  const inPrev = txns.filter((t) => t.date >= win.prevStart && t.date <= win.prevEnd);

  const spendOf = (list: typeof txns, name: string) =>
    list
      .filter((t) => t.category?.name === name && t.amount > 0)
      .reduce((s, t) => s + (t.owedBack ? Math.max(0, t.amount - t.reimbursedAmount) : t.amount), 0);

  const catByName = new Map(categories.map((c) => [c.name, c]));

  function categoryItems(names: string[]): HiveItem[] {
    return names
      .map((name) => {
        const cat = catByName.get(name);
        const cur = spendOf(inWindow, name);
        const prev = spendOf(inPrev, name);
        const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0;
        const flat = prev > 0 ? Math.abs(cur - prev) / prev < 0.03 : cur === 0;
        return {
          id: `cat:${name}`,
          kind: "category" as const,
          name,
          icon: cat?.icon ?? "CircleHelp",
          value: cur,
          categoryId: cat?.id,
          trendPct: flat ? undefined : pct,
          trendGood: flat ? undefined : cur < prev, // less spending = good
        };
      })
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  const needsItems = categoryItems(NEEDS_CATEGORIES);
  const wantsItems = categoryItems(WANTS_CATEGORIES);

  // Every dollar deserves a hexagon: spending in "Other" — plus anything not
  // categorized at all — shows as one cell under Wants (matching the budget's
  // default treatment) instead of silently vanishing from the hive.
  const uncatOf = (list: typeof txns) =>
    list
      .filter((t) => !t.category && t.amount > 0)
      .reduce((s, t) => s + (t.owedBack ? Math.max(0, t.amount - t.reimbursedAmount) : t.amount), 0);
  const otherCur = spendOf(inWindow, "Other") + uncatOf(inWindow);
  const otherPrev = spendOf(inPrev, "Other") + uncatOf(inPrev);
  if (otherCur > 0) {
    const otherCat = catByName.get("Other");
    const pct = otherPrev > 0 ? Math.round(((otherCur - otherPrev) / otherPrev) * 100) : 100;
    const flat = otherPrev > 0 && Math.abs(otherCur - otherPrev) / otherPrev < 0.03;
    wantsItems.push({
      id: "cat:Other",
      kind: "category" as const,
      name: "Other",
      icon: otherCat?.icon ?? "CircleHelp",
      value: otherCur,
      categoryId: otherCat?.id,
      trendPct: flat ? undefined : pct,
      trendGood: flat ? undefined : otherCur < otherPrev,
    });
    wantsItems.sort((a, b) => b.value - a.value);
  }

  const needsTotal = needsItems.reduce((s, i) => s + i.value, 0);
  const wantsTotal = wantsItems.reduce((s, i) => s + i.value, 0);

  // Investing flow: money moved out via transfers this window (e.g. to savings).
  const investFlow = inWindow
    .filter((t) => t.category?.group === "transfer" && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  // Satellites: savings + investment accounts — and business accounts, which
  // live here too and open their own breakdown.
  const investAccounts = accounts.filter(
    (a) => a.type === "investment" || a.subtype === "savings" || a.isBusiness
  );
  const investItems: HiveItem[] = investAccounts
    .map((a) => ({
      id: `acct:${a.id}`,
      kind: "account" as const,
      name: a.name,
      icon: a.isBusiness
        ? "Briefcase"
        : a.subtype?.includes("crypto")
          ? "Bitcoin"
          : a.type === "investment"
            ? "TrendingUp"
            : "PiggyBank",
      value: a.currentBalance,
      balance: a.currentBalance,
      trendGood: true,
      isBusiness: a.isBusiness,
    }))
    .sort((a, b) => b.value - a.value);
  const investTotal = investFlow;

  // Rentals: cells are houses; branch value is the monthly outflow they carry.
  const rentalItems: HiveItem[] = properties.map((p) => {
    const net = p.rentIncome - p.mortgage - p.utilities - p.hoa;
    return {
      id: `prop:${p.id}`,
      kind: "property" as const,
      name: p.name,
      icon: "Home",
      value: Math.max(p.rentIncome, 1),
      trendGood: net >= 0,
      property: {
        rentIncome: p.rentIncome,
        mortgage: p.mortgage,
        utilities: p.utilities,
        hoa: p.hoa,
        net,
        sweatIn: p.sweatIn,
        sweatOut: p.sweatOut,
      },
    };
  });
  const rentalsOutflow = properties.reduce(
    (s, p) => s + p.mortgage + p.utilities + p.hoa,
    0
  );

  const branchesRaw: HiveBranch[] = [
    {
      id: "needs",
      label: "Needs",
      icon: "Home",
      blurb: "Has to go out",
      value: needsTotal,
      pct: 0,
      items: needsItems,
    },
    {
      id: "wants",
      label: "Wants",
      icon: "Sparkles",
      blurb: "You control these",
      value: wantsTotal,
      pct: 0,
      items: wantsItems,
    },
    {
      id: "invest",
      label: "Investing",
      icon: "TrendingUp",
      blurb: "Growing your money",
      value: investTotal,
      pct: 0,
      items: investItems,
    },
    {
      id: "rentals",
      label: "Rentals",
      icon: "Building2",
      blurb: "Property P&L",
      value: rentalsOutflow,
      pct: 0,
      items: rentalItems,
    },
  ];

  // Hide branches with nothing to show; percentages over what remains.
  const branches = branchesRaw.filter((b) => b.value > 0 || b.items.length > 0);
  const total = branches.reduce((s, b) => s + b.value, 0);
  for (const b of branches) b.pct = total > 0 ? Math.round((b.value / total) * 100) : 0;

  // Budget takes center stage; total money becomes its own cell with an
  // up/down read from this month's net cashflow.
  const { start: mStart, end: mEnd } = currentMonthRange();
  const [budget, netWorth, monthFlow] = await Promise.all([
    getBudgetStatus(),
    getNetWorth(),
    getCashflow(mStart, mEnd),
  ]);

  return {
    windowLabel: win.label,
    total,
    branches,
    budget,
    money: {
      total: netWorth.netWorth,
      trueAvailable: netWorth.trueAvailable,
      monthNet: Math.round(monthFlow.net),
    },
  };
}

export type { BudgetStatus };

export interface HiveMoney {
  total: number;
  trueAvailable: number;
  monthNet: number; // this month's income minus spending — the up/down signal
}
