// Canonical category set for the app. `icon` values are keys in the ICONS map
// in src/lib/icons.ts. Colors are used across charts, budgets and transaction chips.

export type CategoryGroup = "expense" | "income" | "transfer";

export interface CategoryDef {
  name: string;
  icon: string;
  color: string;
  group: CategoryGroup;
}

export const CATEGORIES: CategoryDef[] = [
  { name: "Income", icon: "DollarSign", color: "#22c55e", group: "income" },
  { name: "Food & Dining", icon: "Utensils", color: "#f97316", group: "expense" },
  { name: "Groceries", icon: "ShoppingCart", color: "#84cc16", group: "expense" },
  { name: "Shopping", icon: "ShoppingBag", color: "#ec4899", group: "expense" },
  { name: "Transportation", icon: "Car", color: "#3b82f6", group: "expense" },
  { name: "Travel", icon: "Plane", color: "#06b6d4", group: "expense" },
  { name: "Bills & Utilities", icon: "Receipt", color: "#eab308", group: "expense" },
  { name: "Housing", icon: "Home", color: "#8b5cf6", group: "expense" },
  { name: "Entertainment", icon: "Film", color: "#a855f7", group: "expense" },
  { name: "Health", icon: "HeartPulse", color: "#ef4444", group: "expense" },
  { name: "Personal Care", icon: "Sparkles", color: "#f472b6", group: "expense" },
  { name: "Services", icon: "Wrench", color: "#64748b", group: "expense" },
  { name: "Fees", icon: "Banknote", color: "#78716c", group: "expense" },
  { name: "Loan Payments", icon: "Landmark", color: "#0ea5e9", group: "expense" },
  { name: "Transfer", icon: "ArrowLeftRight", color: "#94a3b8", group: "transfer" },
  { name: "Other", icon: "CircleHelp", color: "#9ca3af", group: "expense" },
];

// Map Plaid personal_finance_category.primary -> our category name.
const PLAID_PRIMARY_MAP: Record<string, string> = {
  INCOME: "Income",
  TRANSFER_IN: "Transfer",
  TRANSFER_OUT: "Transfer",
  LOAN_PAYMENTS: "Loan Payments",
  BANK_FEES: "Fees",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food & Dining",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Housing",
  RENT_AND_UTILITIES: "Bills & Utilities",
  MEDICAL: "Health",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Services",
  GOVERNMENT_AND_NON_PROFIT: "Services",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
};

// Some detailed categories deserve a more specific mapping than their primary.
const PLAID_DETAILED_MAP: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: "Groceries",
};

export function mapPlaidCategory(
  primary?: string | null,
  detailed?: string | null
): string {
  if (detailed && PLAID_DETAILED_MAP[detailed]) return PLAID_DETAILED_MAP[detailed];
  if (primary && PLAID_PRIMARY_MAP[primary]) return PLAID_PRIMARY_MAP[primary];
  return "Other";
}

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
