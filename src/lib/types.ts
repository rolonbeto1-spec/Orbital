/**
 * WIRE TYPES — the shape of JSON as the browser receives it.
 *
 * These are deliberately separate from the server-side types in
 * src/lib/{hive,queries,budget}.ts, and the difference is the money
 * representation (§49):
 *
 *   server side   `amountCents: number`   exact integer cents, all arithmetic
 *   ─────────────────────────────────────────────────────────────────────────
 *   wire / client `amount: number`        dollars, display only
 *
 * The conversion happens once, at the API boundary, in `serializeMoneyFields`
 * (src/lib/money.ts), which strips the `Cents` suffix and divides by 100. The
 * browser never does money arithmetic that has to be exact — it formats and
 * draws — so dollars are the right shape here, and keeping the two type sets
 * distinct means a server value can never be handed to the client without
 * passing through that conversion.
 */

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  group: string;
}

export interface Account {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalance: number;
  availableBalance: number | null;
  currencyCode: string;
  isBusiness?: boolean;
}

// A connected institution (Plaid Item) with its accounts — one "bank".
export interface BankWithAccounts {
  id: string;
  institutionName: string;
  accounts: Account[];
}

export interface Transaction {
  id: string;
  amount: number;
  date: string;
  name: string;
  merchantName: string | null;
  categoryId: string | null;
  category: Category | null;
  logoUrl?: string | null;
  pending: boolean;
  notes: string | null;
  owedBack?: boolean;
  reimbursedAmount?: number;
  folderId?: string | null;
  folder?: { id: string; name: string } | null;
  account?: { name: string; mask: string | null };
}

export interface NetWorth {
  assets: number;
  liabilities: number;
  netWorth: number;
  trueAvailable?: number;
  cash?: number;
  cardDebt?: number;
}

export interface Cashflow {
  spending: number;
  income: number;
  net: number;
}

export interface BudgetWithSpend {
  id: string;
  categoryId: string;
  category: Category;
  limit: number;
  spent: number;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  icon: string;
  color: string;
}

export interface SpendSlice {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  total: number;
  prevTotal?: number;
  pct?: number; // % change vs last month; for spending, up is bad
}

export interface DashboardData {
  netWorth: NetWorth;
  cashflow: Cashflow;
  accounts: Account[];
  budgets: BudgetWithSpend[];
  topCategories: SpendSlice[];
  recent: Transaction[];
  goals: Goal[];
  month: string;
  connectedBanks: number;
  plaidConfigured: boolean;
  properties?: { id: string; name: string; net: number }[];
}


// ---------------------------------------------------------------------------
// Hive wire types (dollars — see the note at the top of this file)
// ---------------------------------------------------------------------------

export interface HiveItemWire {
  id: string;
  kind: "category" | "account" | "property";
  name: string;
  icon: string;
  /** Dollars. */
  value: number;
  /** Dollars, for account cells. */
  balance?: number;
  categoryId?: string;
  trendPct?: number;
  trendGood?: boolean;
  isBusiness?: boolean;
  property?: {
    rentIncome: number;
    mortgage: number;
    utilities: number;
    hoa: number;
    net: number;
    sweatIn: number;
    sweatOut: number;
  };
}

export interface HiveBranchWire {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  /** Dollars. */
  value: number;
  pct: number;
  items: HiveItemWire[];
}

export interface BudgetCategoryWire {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  /** Dollars. */
  limit: number;
  /** Dollars. */
  spent: number;
}

export interface BudgetStatusWire {
  /** Dollars. */
  limit: number;
  /** Dollars. */
  spent: number;
  /** Dollars. */
  left: number;
  hasBudget: boolean;
  categories: BudgetCategoryWire[];
}

export interface HiveMoneyWire {
  /** Dollars. */
  total: number;
  /** Dollars. */
  trueAvailable: number;
  /** Dollars — this month's income minus spending. */
  monthNet: number;
}

export interface RecurringChargeWire {
  merchant: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  cadence: "weekly" | "biweekly" | "monthly";
  /** Dollars — the typical (median) charge. */
  amount: number;
  /** Dollars — normalised to a monthly figure. */
  monthlyCost: number;
  lastDate: string;
  nextExpected: string;
  count: number;
}
