// Formatting helpers shared across the UI.

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
