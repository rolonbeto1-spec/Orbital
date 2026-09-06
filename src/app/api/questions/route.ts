import { z } from "zod";
import { route, safeJson, HttpError } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { getCategoryIdMap, getJsonSetting, setJsonSetting, getSetting, setSetting } from "@/lib/db-helpers";
import { requireOwned } from "@/lib/security/ownership";
import { learnFromCorrection } from "@/lib/smart-categorize";
import { detectRecurring } from "@/lib/recurring";
import { idSchema, shortText } from "@/lib/validation";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metta asks: the app notices things it does not understand and asks the user.
 *
 * Answers teach the categoriser permanently, through exactly the same
 * ownership-checked path as a manual correction in Activity — the question
 * card is not a shortcut around authorization (§7, §32).
 *
 * Dismissals and acknowledgements live in the per-user Setting table. The old
 * global keys ("questionsDismissed", "recurringAcked", "digestLast") would
 * have been shared by every tenant (§6).
 */

const DISMISSED_KEY = "questionsDismissed";
const ACKED_KEY = "recurringAcked";
const DIGEST_KEY = "digestLast";

async function readSet(userId: string, key: string): Promise<Set<string>> {
  const values = await getJsonSetting<string[]>(userId, key, []);
  return new Set(Array.isArray(values) ? values : []);
}

async function writeSet(userId: string, key: string, set: Set<string>): Promise<void> {
  // Bounded memory: keep the most recent 400 entries.
  await setJsonSetting(userId, key, [...set].slice(-400));
}

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const userId = ctx.user.id;

  const [dismissed, acked] = await Promise.all([
    readSet(userId, DISMISSED_KEY),
    readSet(userId, ACKED_KEY),
  ]);

  const since = new Date();
  since.setDate(since.getDate() - 30);

  // Mystery charges: this user's unsorted or "Other" spending.
  const mysteries = await prisma.transaction.findMany({
    where: {
      userId,
      amountCents: { gt: 0 },
      date: { gte: since },
      OR: [{ categoryId: null }, { category: { name: "Other" } }],
    },
    orderBy: { amountCents: "desc" },
    take: 12,
    select: { id: true, name: true, merchantName: true, amountCents: true, date: true },
  });

  const chargeQuestions = mysteries
    .filter((t) => !dismissed.has(t.id))
    .slice(0, 3)
    .map((t) => ({
      kind: "charge" as const,
      txnId: t.id,
      merchant: t.merchantName || t.name,
      amountCents: t.amountCents,
      date: t.date,
    }));

  const recurring = await detectRecurring(userId);
  const recurringQuestions = recurring
    .filter((r) => !acked.has(r.merchant.toLowerCase()))
    .slice(0, 3)
    .map((r) => ({
      kind: "recurring" as const,
      merchant: r.merchant,
      amountCents: r.amountCents,
      cadence: r.cadence,
      monthlyCostCents: r.monthlyCostCents,
    }));

  const digestLast = await getSetting(userId, DIGEST_KEY);
  const digestDue =
    !digestLast || Date.now() - new Date(digestLast).getTime() > 7 * 86_400_000;

  return safeJson({
    questions: [
      ...(digestDue ? [{ kind: "digest" as const }] : []),
      ...chargeQuestions.map((q) => serializeMoneyFields(q)),
      ...recurringQuestions.map((q) => serializeMoneyFields(q)),
    ],
  });
});

const answerBody = z
  .object({
    kind: z.enum(["charge", "recurring", "digest"]),
    txnId: idSchema.optional(),
    categoryName: shortText(60).optional(),
    merchant: shortText(120).optional(),
  })
  .strict();

export const POST = route(
  { auth: "user", limits: ["write"], body: answerBody },
  async (ctx) => {
    const userId = ctx.user.id;

    if (ctx.body.kind === "digest") {
      await setSetting(userId, DIGEST_KEY, new Date().toISOString());
      return safeJson({ ok: true });
    }

    if (ctx.body.kind === "charge" && ctx.body.txnId) {
      if (ctx.body.categoryName) {
        // The category name is resolved against THIS user's own catalog, and
        // the transaction is fetched with ownership in the query — a crafted
        // txnId belonging to another tenant is a 404, not a write (§7).
        const categoryMap = await getCategoryIdMap(userId);
        const categoryId = categoryMap[ctx.body.categoryName];
        if (!categoryId) {
          throw new HttpError(400, "unknown category", "That category does not exist.");
        }

        const txn = await requireOwned<{
          id: string;
          name: string;
          merchantName: string | null;
          amountCents: number;
        }>("transaction", ctx.body.txnId, userId, {
          select: { id: true, name: true, merchantName: true, amountCents: true },
        });

        await prisma.transaction.updateMany({
          where: { id: txn.id, userId },
          data: { categoryId },
        });

        // The user's answer is law: learn the merchant permanently.
        await learnFromCorrection(
          userId,
          txn.merchantName || txn.name,
          categoryId,
          txn.amountCents,
        );
      }

      const dismissed = await readSet(userId, DISMISSED_KEY);
      dismissed.add(ctx.body.txnId);
      await writeSet(userId, DISMISSED_KEY, dismissed);
      return safeJson({ ok: true });
    }

    if (ctx.body.kind === "recurring" && ctx.body.merchant) {
      const acked = await readSet(userId, ACKED_KEY);
      acked.add(ctx.body.merchant.toLowerCase());
      await writeSet(userId, ACKED_KEY, acked);
      return safeJson({ ok: true });
    }

    throw new HttpError(400, "unknown question", "That question could not be recorded.");
  },
);
