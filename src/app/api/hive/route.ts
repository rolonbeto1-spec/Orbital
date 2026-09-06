import { z } from "zod";
import { route, safeJson } from "@/lib/security/api";
import { getHive } from "@/lib/hive";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z
  .object({
    // "35d" | "week" | "month" | "YYYY-MM". Bounded and pattern-checked so a
    // hostile value cannot become an unbounded date range (§51).
    window: z
      .string()
      .max(16)
      .regex(/^(\d{1,3}d|week|month|\d{4}-\d{2})$/, "Invalid window")
      .optional(),
  })
  .strict();

export const GET = route({ auth: "user", limits: ["read"], query }, async (ctx) => {
  const hive = await getHive(ctx.user.id, ctx.user.timezone, ctx.query.window ?? null);
  // The money boundary: every `*Cents` integer becomes a dollar number here,
  // once, recursively through branches, items and the budget block (§49).
  return safeJson(serializeMoneyFields(hive));
});
