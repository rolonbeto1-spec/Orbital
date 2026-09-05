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
