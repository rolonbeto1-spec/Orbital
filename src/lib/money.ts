/**
 * Money arithmetic (§49).
 *
 * Amounts are stored as Float dollars, matching Plaid's own representation
 * and the existing Metta convention (positive = money out, negative = money
 * in). That choice is inherited, not invented, and changing the storage type
 * would mean rewriting every screen for no security gain.
 *
 * What we do NOT inherit is naive float accumulation. `0.1 + 0.2` is
 * 0.30000000000000004, and a personal-finance app adds thousands of such
 * numbers together; the error is small per operation and visible after a few
 * hundred. So every aggregation in the app goes through this module, which
 * converts to integer cents, sums exactly in integers, and converts back once
 * at the end.
 *
 * Residual risk, stated plainly: a single stored value can still be a float
 * that is not exactly representable. Reads are rounded to the cent on the way
 * in, so this is bounded at a half-cent per stored row and does not compound.
 * SECURITY_REVIEW.md records this as an accepted, documented limitation.
 */

/**
 * Convert dollars to integer cents, rounding half away from zero.
 *
 * Two corrections over the naive `Math.round(dollars * 100)`:
 *
 * 1. SIGN SYMMETRY. `Math.round(-0.5)` is -0 in JavaScript, because Math.round
 *    breaks ties toward +Infinity. That would round a $0.005 debit and a
 *    $0.005 credit differently. We round the magnitude and reapply the sign.
 *
 * 2. REPRESENTATION ERROR. A value like 1.005 is stored as
 *    1.00499999999999989, so `1.005 * 100` is 100.49999999999999 and rounds
 *    DOWN to 100 — a cent lost on a value that a person typed as $1.005.
 *    Normalising the scaled value to six decimal places first absorbs the
 *    representation error (100.49999999999999 -> 100.5) without affecting any
 *    value that was already exact.
 */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  const sign = dollars < 0 ? -1 : 1;
  const scaled = Number((Math.abs(dollars) * 100).toFixed(6));
  return sign * Math.round(scaled);
}

/** Convert integer cents back to dollars. */
export function toDollars(cents: number): number {
  return cents / 100;
}

/** Round a dollar amount to the cent. */
export function roundMoney(dollars: number): number {
  return toDollars(toCents(dollars));
}

/**
 * Exact sum of dollar amounts.
 *
 * Sums in integer cents so that adding ten thousand transactions produces the
 * same answer as adding them in any other order, with no drift.
 */
export function sumMoney(amounts: readonly number[]): number {
  let cents = 0;
  for (const amount of amounts) cents += toCents(amount);
  return toDollars(cents);
}

/** Exact sum over a collection, via a selector. */
export function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  let cents = 0;
  for (const item of items) cents += toCents(select(item));
  return toDollars(cents);
}

/** Exact addition of two amounts. */
export function addMoney(a: number, b: number): number {
  return toDollars(toCents(a) + toCents(b));
}

/** Exact subtraction. */
export function subtractMoney(a: number, b: number): number {
  return toDollars(toCents(a) - toCents(b));
}

/**
 * Effective spend for a transaction: the amount minus anything reimbursed.
 *
 * Kept here rather than inline at a dozen call sites because getting the sign
 * convention wrong is the single easiest way to produce a wrong number in
 * this app. Positive = money out, so a reimbursement reduces the magnitude of
 * a spend and never flips it past zero.
 */
export function effectiveSpend(amount: number, reimbursedAmount: number): number {
  const amountCents = toCents(amount);
  const reimbursedCents = toCents(reimbursedAmount);
  if (amountCents <= 0) return toDollars(amountCents); // income/refund: unchanged
  // Never reimburse more than was spent.
  return toDollars(Math.max(0, amountCents - Math.max(0, reimbursedCents)));
}

/** Multiply a money amount by a plain factor, rounding once at the end. */
export function scaleMoney(dollars: number, factor: number): number {
  if (!Number.isFinite(factor)) return 0;
  return toDollars(Math.round(toCents(dollars) * factor));
}

/**
 * Percentage of a budget consumed, guarded against a zero limit.
 * Returns null when there is no meaningful percentage to show.
 */
export function percentOf(part: number, whole: number): number | null {
  const wholeCents = toCents(whole);
  if (wholeCents === 0) return null;
  return (toCents(part) / wholeCents) * 100;
}

/** True when two amounts are the same to the cent. */
export function moneyEquals(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}
