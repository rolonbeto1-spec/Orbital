// Formatting helpers shared across the UI.
//
// MONEY: there are two formatters and the distinction is load-bearing.
//
//   formatCurrency(dollars)  — for values that have already crossed the
//                              serialisation boundary. Client components get
//                              dollars from `serializeMoneyFields`, so this is
//                              the one they use.
//   formatCents(cents)       — for server-side code, which works in exact
//                              integer cents and never sees dollars.
//
// Passing cents to formatCurrency renders a 100x overstatement ($84.21 shown
// as "$8,421.00"), and because both are `number` the compiler cannot catch
// it. Server modules must therefore use formatCents; tests/money-format
// enforces that.

import { centsToDollars, type CentsLike } from "@/lib/money";

export function formatCurrency(
  value: number,
  opts: { compact?: boolean; showSign?: boolean } = {}
): string {
  const { compact, showSign } = opts;
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: compact && abs >= 1000 ? 0 : 2,
    maximumFractionDigits: compact && abs >= 1000 ? 0 : 2,
    notation: compact && abs >= 10000 ? "compact" : "standard",
  }).format(abs);

  if (showSign) {
    if (value < 0) return `-${formatted}`;
    if (value > 0) return `+${formatted}`;
  }
  return value < 0 ? `-${formatted}` : formatted;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Format an exact integer cent amount for display.
 *
 * The server-side counterpart to formatCurrency: it performs the cents to
 * dollars conversion itself, so no caller has to remember a `/ 100`.
 */
export function formatCents(
  cents: CentsLike,
  opts: { compact?: boolean; showSign?: boolean } = {}
): string {
  return formatCurrency(centsToDollars(cents), opts);
}
