// Groups the flat category list into the Needs / Wants / Investing mental model
// used by the flow view and the assistant's budget logic.

export const NEEDS_CATEGORIES = [
  "Housing",
  "Bills & Utilities",
  "Groceries",
  "Transportation",
  "Health",
  "Loan Payments",
  "Fees",
  "Services",
];

export const WANTS_CATEGORIES = [
  "Food & Dining",
  "Entertainment",
  "Shopping",
  "Personal Care",
  "Travel",
];

export type Bucket = "needs" | "wants" | "investing" | "other";

export function bucketFor(categoryName: string): Bucket {
  if (NEEDS_CATEGORIES.includes(categoryName)) return "needs";
  if (WANTS_CATEGORIES.includes(categoryName)) return "wants";
  return "other";
}
