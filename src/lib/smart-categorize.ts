import "server-only";
import { prisma } from "@/lib/prisma";
import type { MerchantRule } from "@/generated/prisma";
import { medianCents, asCents } from "@/lib/money";

/**
 * Merchant categorisation memory — now per user (§2, §6).
 *
 * The product rule is unchanged and load-bearing: a correction the user makes
 * by hand becomes a `learned` rule that permanently outranks the AI sorter
 * and the builtins. What changed is that a rule belongs to one person. User A
 * teaching Metta that "SQ *" is Groceries must not reclassify User B's
 * transactions, and A's history must not be readable through B's rules.
 *
 * Every function here takes a userId and every query is scoped by it.
 */

// The "gas station problem": the same merchant means different things at
// different amounts. $8 at Shell is snacks; $60 is fuel.
const GAS_STATIONS = [
  "shell", "chevron", "exxon", "mobil", "arco", "valero", "sunoco", "speedway",
  "marathon", "phillips 66", "circle k", "quiktrip", "casey's", "wawa", "76 ",
];

/** Below this, a gas-station charge is treated as snacks, not fuel. In cents. */
export const GAS_SNACK_THRESHOLD_CENTS = 1500;

export function isGasStation(merchant: string): boolean {
  const lower = merchant.toLowerCase();
  return GAS_STATIONS.some((station) => lower.includes(station));
}

/** Load one user's rules. */
export async function loadMerchantRules(userId: string): Promise<MerchantRule[]> {
  return prisma.merchantRule.findMany({ where: { userId } });
}

/**
 * Resolve a category for a transaction from a set of rules.
 *
 * Pure: it takes the rules it is given and does no I/O, which is what makes
 * it safe — a caller cannot accidentally have it read another tenant's rules,
 * because it reads nothing at all.
 */
export function resolveSmartCategory(
  merchant: string,
  amountCents: number,
  rules: MerchantRule[],
): { categoryId?: string; categoryName?: string } | null {
  const key = merchant.toLowerCase();

  // Learned rules win over builtins; amount-bounded rules win over unbounded.
  const matches = rules.filter((rule) => key.includes(rule.match));
  const bounded = matches.find(
    (rule) =>
      (rule.minAmountCents != null || rule.maxAmountCents != null) &&
      (rule.minAmountCents == null || amountCents >= rule.minAmountCents) &&
      (rule.maxAmountCents == null || amountCents <= rule.maxAmountCents),
  );
  const unbounded = matches.find(
    (rule) => rule.minAmountCents == null && rule.maxAmountCents == null,
  );
  const rule = bounded ?? unbounded;
  if (rule) return { categoryId: rule.categoryId };

  if (isGasStation(key) && amountCents > 0) {
    return {
      categoryName:
        amountCents < GAS_SNACK_THRESHOLD_CENTS ? "Food & Dining" : "Transportation",
    };
  }
  return null;
}

/**
 * Learn from a manual correction, for one user.
 *
 * `categoryId` is assumed to have been ownership-checked by the caller — API
 * routes do that through assertOwned() before they get here. The writes below
 * are still scoped by userId, so a mistake upstream cannot write a rule into
 * another tenant's set.
 */
export async function learnFromCorrection(
  userId: string,
  merchant: string,
  categoryId: string,
  amountCents?: number,
): Promise<void> {
  const match = merchant.toLowerCase().trim().slice(0, 120);
  if (!match) return;

  if (amountCents != null && amountCents > 0) {
    // A correction landing inside an already-learned band retargets it.
    const rules = await prisma.merchantRule.findMany({ where: { userId, match } });
    const band = rules.find(
      (rule) =>
        (rule.minAmountCents != null || rule.maxAmountCents != null) &&
        (rule.minAmountCents == null || amountCents >= rule.minAmountCents) &&
        (rule.maxAmountCents == null || amountCents <= rule.maxAmountCents),
    );
    if (band) {
      await prisma.merchantRule.update({
        where: { id: band.id },
        data: { categoryId, source: "learned" },
      });
      return;
    }

    const split = await findAmountSplit(userId, match, categoryId, amountCents);
    if (split) {
      const low = amountCents < split.otherTypicalCents;
      // Replace this merchant's rules with a two-band pair, atomically, so a
      // concurrent sync cannot observe the merchant with no rule at all.
      await prisma.$transaction([
        prisma.merchantRule.deleteMany({ where: { userId, match } }),
        prisma.merchantRule.createMany({
          data: [
            {
              userId,
              match,
              categoryId,
              source: "learned",
              minAmountCents: low ? null : split.cutoffCents,
              maxAmountCents: low ? split.cutoffCents : null,
            },
            {
              userId,
              match,
              categoryId: split.otherCategoryId,
              source: "learned",
              minAmountCents: low ? split.cutoffCents : null,
              maxAmountCents: low ? null : split.cutoffCents,
            },
          ],
        }),
      ]);
      return;
    }
  }

  // One unbounded rule per (user, merchant); latest correction wins.
  // upsert on the composite unique key rather than find-then-write, so two
  // concurrent corrections cannot both insert (§48).
  // Prisma's composite-unique input does not accept nulls, so the unbounded
  // rule is found explicitly and then written. The create is guarded against
  // a concurrent insert by the same unique constraint (§48).
  const existing = await prisma.merchantRule.findFirst({
    where: { userId, match, minAmountCents: null, maxAmountCents: null },
    select: { id: true },
  });
  if (existing) {
    await prisma.merchantRule.update({
      where: { id: existing.id },
      data: { categoryId, source: "learned" },
    });
    return;
  }
  await prisma.merchantRule
    .create({ data: { userId, match, categoryId, source: "learned" } })
    .catch(async () => {
      // Lost a race: another request created it first. Apply our value.
      await prisma.merchantRule.updateMany({
        where: { userId, match, minAmountCents: null, maxAmountCents: null },
        data: { categoryId, source: "learned" },
      });
    });
}

/**
 * Record what the AI concluded about a merchant, so the same merchant costs
 * tokens once. Never overwrites a `learned` rule — the user's word is law.
 */
export async function rememberAiCategory(
  userId: string,
  merchant: string,
  categoryId: string,
): Promise<void> {
  const match = merchant.toLowerCase().trim().slice(0, 120);
  if (!match) return;

  const existing = await prisma.merchantRule.findFirst({
    where: { userId, match, minAmountCents: null, maxAmountCents: null },
    select: { id: true, source: true },
  });

  if (existing) {
    if (existing.source === "learned") return; // never override the user
    await prisma.merchantRule.update({
      where: { id: existing.id },
      data: { categoryId, source: "ai" },
    });
    return;
  }

  await prisma.merchantRule
    .create({ data: { userId, match, categoryId, source: "ai" } })
    // A concurrent sync may have created it first; that is fine.
    .catch(() => undefined);
}

/**
 * Does this user's history show a second category at clearly different
 * amounts than the one just corrected? If so, where to draw the line.
 */
async function findAmountSplit(
  userId: string,
  match: string,
  categoryId: string,
  amountCents: number,
): Promise<{ cutoffCents: number; otherCategoryId: string; otherTypicalCents: number } | null> {
  const peers = await prisma.transaction.findMany({
    where: {
      userId, // scoped: never learns from another person's spending
      OR: [{ merchantName: { contains: match } }, { name: { contains: match } }],
      categoryId: { not: null },
      amountCents: { gt: 0 },
    },
    select: { amountCents: true, categoryId: true },
    take: 200,
  });

  const byCategory = new Map<string, number[]>();
  for (const peer of peers) {
    if (!peer.categoryId || peer.categoryId === categoryId) continue;
    const amounts = byCategory.get(peer.categoryId) ?? [];
    amounts.push(peer.amountCents);
    byCategory.set(peer.categoryId, amounts);
  }

  let best: { otherCategoryId: string; otherTypicalCents: number; count: number } | null = null;
  for (const [category, amounts] of byCategory) {
    const typicalCents = medianCents(amounts);
    // "Clearly apart": at least $10 (1000 cents) and 60% of the larger amount.
    const gap = Math.abs(amountCents - typicalCents);
    if (gap < 1000 || gap < Math.max(amountCents, typicalCents) * 0.6) continue;
    if (!best || amounts.length > best.count) {
      best = { otherCategoryId: category, otherTypicalCents: typicalCents, count: amounts.length };
    }
  }
  if (!best) return null;
  // The cutoff sits halfway between the two typical amounts, rounded to an
  // exact cent so the stored band boundary is itself exact.
  return {
    cutoffCents: Math.round((amountCents + best.otherTypicalCents) / 2),
    otherCategoryId: best.otherCategoryId,
    otherTypicalCents: best.otherTypicalCents,
  };
}
