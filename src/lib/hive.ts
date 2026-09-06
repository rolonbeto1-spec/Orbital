import "server-only";
import { prisma } from "@/lib/prisma";
import { NEEDS_CATEGORIES, WANTS_CATEGORIES } from "@/lib/buckets";
import { getBudgetStatus, type BudgetStatus } from "@/lib/budget";
import { getNetWorth, getCashflow } from "@/lib/queries";
import { currentMonthRange } from "@/lib/time";
import { asCents, effectiveSpendCents, sumCentsBy } from "@/lib/money";

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
  valueCents: number; // drives cell size; meaning depends on kind (spend / balance / rent)
  display?: string; // optional label override (e.g. balance for accounts)
  categoryId?: string;
  trendPct?: number; // % change vs previous window (categories)
  trendGood?: boolean; // whether the trend/state is good (green) or bad (red)
  property?: {
    rentIncomeCents: number;
    mortgageCents: number;
    utilitiesCents: number;
    hoaCents: number;
    netCents: number;
    sweatInCents: number;
    sweatOutCents: number;
  };
  balanceCents?: number;
  isBusiness?: boolean;
}

export interface HiveBranch {
  id: "needs" | "wants" | "invest" | "rentals";
  label: string;
  icon: string;
  blurb: string;
  valueCents: number;
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

/**
 * The Hive, for one user.
 *
 * Every query is scoped to `userId`, so the honeycomb is built only from that
 * person's transactions, categories, accounts and properties. Row counts are
 * bounded: the window is at most a few months and the read is capped, so this
 * endpoint cannot be turned into an unbounded scan (§51).
 */
const HIVE_MAX_ROWS = 6000;

export async function getHive(
  userId: string,
  timeZone: string,
  windowSpec?: string | null,
) {
  const win = resolveWindow(windowSpec);

  const [txns, categories, accounts, properties] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: win.prevStart, lte: win.end },
        account: { isBusiness: false },
      },
      include: { category: { select: { id: true, name: true, group: true } } },
      take: HIVE_MAX_ROWS,
    }),
    prisma.category.findMany({ where: { userId } }),
    prisma.account.findMany({ where: { userId } }),
    prisma.property.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  const inWindow = txns.filter((t) => t.date >= win.start && t.date <= win.end);
  const inPrev = txns.filter((t) => t.date >= win.prevStart && t.date <= win.prevEnd);

  // Every figure below is exact integer cents (§49).
  const spendOf = (list: typeof txns, name: string) =>
    sumCentsBy(
      list.filter((t) => t.category?.name === name && t.amountCents > 0),
      (t) =>
        t.owedBack
          ? effectiveSpendCents(t.amountCents, t.reimbursedAmountCents)
          : t.amountCents,
    );

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
          valueCents: cur,
          categoryId: cat?.id,
          trendPct: flat ? undefined : pct,
          trendGood: flat ? undefined : cur < prev, // less spending = good
        };
      })
      .filter((i) => i.valueCents > 0)
      .sort((a, b) => b.valueCents - a.valueCents);
  }

  const needsItems = categoryItems(NEEDS_CATEGORIES);
  const wantsItems = categoryItems(WANTS_CATEGORIES);

  // Every dollar deserves a hexagon: spending in "Other" — plus anything not
  // categorized at all — shows as one cell under Wants (matching the budget's
  // default treatment) instead of silently vanishing from the hive.
  const uncatOf = (list: typeof txns) =>
    sumCentsBy(
      list.filter((t) => !t.category && t.amountCents > 0),
      (t) =>
        t.owedBack
          ? effectiveSpendCents(t.amountCents, t.reimbursedAmountCents)
          : t.amountCents,
    );
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
      valueCents: otherCur,
      categoryId: otherCat?.id,
      trendPct: flat ? undefined : pct,
      trendGood: flat ? undefined : otherCur < otherPrev,
    });
    wantsItems.sort((a, b) => b.valueCents - a.valueCents);
  }

  const needsTotal = sumCentsBy(needsItems, (i) => i.valueCents);
  const wantsTotal = sumCentsBy(wantsItems, (i) => i.valueCents);

  // Investing flow: money moved out via transfers this window (e.g. to savings).
  const investFlow = sumCentsBy(
    inWindow.filter((t) => t.category?.group === "transfer" && t.amountCents > 0),
    (t) => t.amountCents,
  );
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
      valueCents: asCents(a.currentBalanceCents),
      balanceCents: asCents(a.currentBalanceCents),
      trendGood: true,
      isBusiness: a.isBusiness,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);
  const investTotal = investFlow;

  // Rentals: cells are houses; branch value is the monthly outflow they carry.
  const rentalItems: HiveItem[] = properties.map((p) => {
    // Each BIGINT column becomes a number once, at the read.
    const rentIncomeCents = asCents(p.rentIncomeCents);
    const mortgageCents = asCents(p.mortgageCents);
    const utilitiesCents = asCents(p.utilitiesCents);
    const hoaCents = asCents(p.hoaCents);
    const netCents = rentIncomeCents - mortgageCents - utilitiesCents - hoaCents;
    return {
      id: `prop:${p.id}`,
      kind: "property" as const,
      name: p.name,
      icon: "Home",
      // A house with no rent still deserves a visible cell, hence the floor.
      valueCents: Math.max(rentIncomeCents, 1),
      trendGood: netCents >= 0,
      property: {
        rentIncomeCents,
        mortgageCents,
        utilitiesCents,
        hoaCents,
        netCents,
        sweatInCents: asCents(p.sweatInCents),
        sweatOutCents: asCents(p.sweatOutCents),
      },
    };
  });
  const rentalsOutflow = sumCentsBy(
    properties,
    (p) => asCents(p.mortgageCents) + asCents(p.utilitiesCents) + asCents(p.hoaCents),
  );

  const branchesRaw: HiveBranch[] = [
    {
      id: "needs",
      label: "Needs",
      icon: "Home",
      blurb: "Has to go out",
      valueCents: needsTotal,
      pct: 0,
      items: needsItems,
    },
    {
      id: "wants",
      label: "Wants",
      icon: "Sparkles",
      blurb: "You control these",
      valueCents: wantsTotal,
      pct: 0,
      items: wantsItems,
    },
    {
      id: "invest",
      label: "Investing",
      icon: "TrendingUp",
      blurb: "Growing your money",
      valueCents: investTotal,
      pct: 0,
      items: investItems,
    },
    {
      id: "rentals",
      label: "Rentals",
      icon: "Building2",
      blurb: "Property P&L",
      valueCents: rentalsOutflow,
      pct: 0,
      items: rentalItems,
    },
  ];

  // Hide branches with nothing to show; percentages over what remains.
  const branches = branchesRaw.filter((b) => b.valueCents > 0 || b.items.length > 0);
  const totalCents = sumCentsBy(branches, (b) => b.valueCents);
  for (const b of branches) {
    b.pct = totalCents > 0 ? Math.round((b.valueCents / totalCents) * 100) : 0;
  }

  // Budget takes center stage; total money becomes its own cell with an
  // up/down read from this month's net cashflow.
  const { start: mStart, end: mEnd } = currentMonthRange(timeZone);
  const [budget, netWorth, monthFlow] = await Promise.all([
    getBudgetStatus(userId, timeZone),
    getNetWorth(userId),
    getCashflow(userId, mStart, mEnd),
  ]);

  return {
    windowLabel: win.label,
    totalCents,
    branches,
    budget,
    money: {
      totalCents: netWorth.netWorthCents,
      trueAvailableCents: netWorth.trueAvailableCents,
      monthNetCents: monthFlow.netCents,
    },
  };
}

export type { BudgetStatus };

export interface HiveMoney {
  totalCents: number;
  trueAvailableCents: number;
  /** This month's income minus spending — the up/down signal. Exact cents. */
  monthNetCents: number;
}
