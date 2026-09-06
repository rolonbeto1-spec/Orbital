/**
 * Money (§49).
 *
 * ## The representation
 *
 * **Currency is persisted as integer minor units (cents), never as a float.**
 * Every column that holds an amount of money is `Int` and named `*Cents`. The
 * name is part of the control: a field called `amountCents` cannot be quietly
 * mistaken for dollars, and renaming the columns forced the compiler to
 * surface every single call site during the migration.
 *
 * Why not `Float`, which is what this app used to do: binary floating point
 * cannot represent 0.1, 0.2, or 8.21 exactly. Individually the error is
 * invisible; summed across a few thousand transactions it is not, and the
 * direction of the drift depends on the order of addition. A personal-finance
 * app whose totals change depending on sort order is broken in a way users
 * eventually notice and cannot explain.
 *
 * Why not `Decimal`: Prisma's Decimal is correct, but it arrives in JavaScript
 * as an object that must be converted before arithmetic, and a missed
 * conversion silently degrades to string concatenation or `NaN`. Integers are
 * the JavaScript-native exact type; `Number.MAX_SAFE_INTEGER` is 9.007e15,
 * which is ninety trillion dollars in cents — far beyond any balance this
 * product will hold, and asserted below.
 *
 * ## The boundaries
 *
 * - **Database and all arithmetic:** integer cents. Exact.
 * - **Plaid:** sends dollars as JSON numbers. Converted to cents on the way in
 *   by `dollarsToCents`, once, at the sync boundary.
 * - **HTTP responses:** dollars, converted by `centsToDollars` at the API
 *   boundary so the presentation layer stays unchanged. This is a display
 *   conversion of an already-exact value, not a storage decision — see
 *   `serializeMoney` below.
 *
 * ## Sign convention (unchanged, and load-bearing)
 *
 * Plaid's convention is preserved exactly: **positive = money out (spending),
 * negative = money in (income or a refund)**. Every helper here respects it.
 */

/** Beyond this, integer cents would exceed Number.MAX_SAFE_INTEGER's headroom. */
export const MAX_SAFE_CENTS = 9_007_199_254_740_000; // ~$90 trillion

/**
 * Convert a dollar amount (from Plaid, or a user-entered form value) to exact
 * integer cents.
 *
 * Two corrections over `Math.round(dollars * 100)`:
 *
 * 1. **Sign symmetry.** `Math.round(-0.5)` is `-0` — Math.round breaks ties
 *    toward +Infinity, so a $0.005 debit and a $0.005 credit would round in
 *    opposite directions. We round the magnitude and reapply the sign.
 *
 * 2. **Representation error.** 1.005 is stored as 1.00499999999999989, so
 *    `1.005 * 100` is 100.49999999999999 and rounds DOWN, losing a cent.
 *    Normalising the scaled value to six decimal places absorbs that error
 *    without affecting any value that was already exact.
 */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  const sign = dollars < 0 ? -1 : 1;
  const scaled = Number((Math.abs(dollars) * 100).toFixed(6));
  const cents = sign * Math.round(scaled);
  // Clamp rather than silently overflow into imprecise integer territory.
  if (cents > MAX_SAFE_CENTS) return MAX_SAFE_CENTS;
  if (cents < -MAX_SAFE_CENTS) return -MAX_SAFE_CENTS;
  return cents;
}

/**
 * Convert integer cents to a dollar number, for display and JSON transport.
 *
 * This is the ONLY place cents become a float, and it happens at the very edge
 * of the system. For any value inside MAX_SAFE_CENTS the division is exact to
 * the cent when formatted to two decimal places.
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** True when a value is a usable integer cent amount. */
export function isValidCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_SAFE_CENTS;
}

/**
 * Coerce a value that must be integer cents, defensively.
 * Used where a number arrives from outside our own writes.
 */
export function asCents(value: unknown): number {
  if (isValidCents(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  return 0;
}

// ---------------------------------------------------------------------------
// Arithmetic — all exact, all in cents
// ---------------------------------------------------------------------------

/**
 * Sum integer cents.
 *
 * Kept as a named helper (rather than a bare `reduce`) so that summing money
 * is a greppable act, and so the overflow guard applies everywhere.
 */
export function sumCents(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) total += asCents(amount);
  return total;
}

/** Sum over a collection via a selector. */
export function sumCentsBy<T>(items: readonly T[], select: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += asCents(select(item));
  return total;
}

/**
 * Effective spend for a transaction: the amount minus anything reimbursed.
 *
 * Kept here rather than inline at a dozen call sites because getting the sign
 * convention wrong is the easiest way to produce a wrong number in this app.
 * Positive = money out, so a reimbursement reduces the magnitude of a spend
 * and never flips it past zero. Income and refunds (negative) are untouched —
 * "reimbursing" income is not a concept.
 */
export function effectiveSpendCents(amountCents: number, reimbursedCents: number): number {
  const amount = asCents(amountCents);
  const reimbursed = asCents(reimbursedCents);
  if (amount <= 0) return amount; // income or refund: unchanged
  return Math.max(0, amount - Math.max(0, reimbursed));
}

/**
 * Multiply cents by a plain factor (a rate, a share), rounding once.
 * Used for projections, not for money-to-money arithmetic.
 */
export function scaleCents(cents: number, factor: number): number {
  if (!Number.isFinite(factor)) return 0;
  return Math.round(asCents(cents) * factor);
}

/**
 * Percentage of a budget consumed, guarded against a zero limit.
 * Returns null when there is no meaningful percentage to show.
 */
export function percentOfCents(partCents: number, wholeCents: number): number | null {
  const whole = asCents(wholeCents);
  if (whole === 0) return null;
  return (asCents(partCents) / whole) * 100;
}

/** Median of a list of cent amounts. Exact for even-length lists. */
export function medianCents(amounts: readonly number[]): number {
  if (amounts.length === 0) return 0;
  const sorted = [...amounts].map(asCents).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  // Average of the two middle values, rounded half away from zero so the
  // result is still an exact cent amount.
  const total = sorted[middle - 1] + sorted[middle];
  const sign = total < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(total) / 2);
}

// ---------------------------------------------------------------------------
// The presentation boundary
// ---------------------------------------------------------------------------

/**
 * Convert integer cents to the dollar number an HTTP response carries.
 *
 * Every API route that returns money calls this (directly or through
 * `serializeMoneyFields`). It exists as a named function so that the
 * cents→dollars transition is explicit and searchable rather than an
 * incidental `/ 100` scattered through route handlers.
 */
export function serializeMoney(cents: number): number {
  return centsToDollars(asCents(cents));
}

/**
 * Serialize a record's `*Cents` fields to dollar-valued fields with the
 * `Cents` suffix removed.
 *
 * `{ amountCents: 8421 }` becomes `{ amount: 84.21 }`.
 *
 * This keeps the JSON contract the presentation layer already expects while
 * the database and every calculation stay in exact integers. Fields without
 * the suffix pass through untouched.
 */
export function serializeMoneyFields<T extends object>(
  record: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (key.endsWith("Cents") && typeof value === "number") {
      out[key.slice(0, -"Cents".length)] = serializeMoney(value);
    } else if (key.endsWith("Cents") && value === null) {
      out[key.slice(0, -"Cents".length)] = null;
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" && !(item instanceof Date)
          ? serializeMoneyFields(item as object)
          : item,
      );
    } else if (value && typeof value === "object" && !(value instanceof Date)) {
      out[key] = serializeMoneyFields(value as object);
    } else {
      out[key] = value;
    }
  }
  return out;
}
