import { route, safeJson } from "@/lib/security/api";
import { detectRecurring } from "@/lib/recurring";
import { serializeMoneyFields, sumCentsBy } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recurring-charge detection.
 *
 * Rate-limited on its own budget because it is one of the more expensive
 * reads in the app: it scans six months of the user's transactions and does
 * cadence analysis over them (§22, §72).
 */
export const GET = route({ auth: "user", limits: ["recurring"] }, async (ctx) => {
  const recurring = await detectRecurring(ctx.user.id);

  // Two things this response was missing, both of which the Recurring panel
  // and card render: money in dollars rather than raw `*Cents` fields, and
  // the monthly total. Without them the panel showed "$NaN" per row and
  // "$NaN/mo" in the header.
  return safeJson({
    recurring: recurring.map((charge) => serializeMoneyFields(charge)),
    monthlyTotal: sumCentsBy(recurring, (charge) => charge.monthlyCostCents) / 100,
  });
});
