import "server-only";
import { prisma } from "@/lib/prisma";
import type { MerchantRule } from "@/generated/prisma";
import { roundMoney } from "@/lib/money";

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

/** Below this, a gas-station charge is treated as snacks, not fuel. */
export const GAS_SNACK_THRESHOLD = 15;

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
  amount: number,
  rules: MerchantRule[],
): { categoryId?: string; categoryName?: string } | null {
  const key = merchant.toLowerCase();

  // Learned rules win over builtins; amount-bounded rules win over unbounded.
  const matches = rules.filter((rule) => key.includes(rule.match));
  const bounded = matches.find(
    (rule) =>
      (rule.minAmount != null || rule.maxAmount != null) &&
      (rule.minAmount == null || amount >= rule.minAmount) &&
      (rule.maxAmount == null || amount <= rule.maxAmount),
  );
  const unbounded = matches.find((rule) => rule.minAmount == null && rule.maxAmount == null);
  const rule = bounded ?? unbounded;
  if (rule) return { categoryId: rule.categoryId };

  if (isGasStation(key) && amount > 0) {
    return {
      categoryName: amount < GAS_SNACK_THRESHOLD ? "Food & Dining" : "Transportation",
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
  amount?: number,
): Promise<void> {
  const match = merchant.toLowerCase().trim().slice(0, 120);
  if (!match) return;

  if (amount != null && amount > 0) {
    // A correction landing inside an already-learned band retargets it.
    const rules = await prisma.merchantRule.findMany({ where: { userId, match } });
    const band = rules.find(
      (rule) =>
        (rule.minAmount != null || rule.maxAmount != null) &&
        (rule.minAmount == null || amount >= rule.minAmount) &&
        (rule.maxAmount == null || amount <= rule.maxAmount),
    );
    if (band) {
      await prisma.merchantRule.update({
        where: { id: band.id },
        data: { categoryId, source: "learned" },
      });
      return;
    }

    const split = await findAmountSplit(userId, match, categoryId, amount);
    if (split) {
      const low = amount < split.otherTypical;
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
              minAmount: low ? null : split.cutoff,
              maxAmount: low ? split.cutoff : null,
            },
            {
              userId,
              match,
              categoryId: split.otherCategoryId,
              source: "learned",
              minAmount: low ? split.cutoff : null,
              maxAmount: low ? null : split.cutoff,
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
    where: { userId, match, minAmount: null, maxAmount: null },
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
        where: { userId, match, minAmount: null, maxAmount: null },
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
    where: { userId, match, minAmount: null, maxAmount: null },
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
  amount: number,
): Promise<{ cutoff: number; otherCategoryId: string; otherTypical: number } | null> {
  const peers = await prisma.transaction.findMany({
    where: {
      userId, // scoped: never learns from another person's spending
      OR: [{ merchantName: { contains: match } }, { name: { contains: match } }],
      categoryId: { not: null },
      amount: { gt: 0 },
    },
    select: { amount: true, categoryId: true },
    take: 200,
  });

  const byCategory = new Map<string, number[]>();
  for (const peer of peers) {
    if (!peer.categoryId || peer.categoryId === categoryId) continue;
    const amounts = byCategory.get(peer.categoryId) ?? [];
    amounts.push(peer.amount);
    byCategory.set(peer.categoryId, amounts);
  }

  let best: { otherCategoryId: string; otherTypical: number; count: number } | null = null;
  for (const [category, amounts] of byCategory) {
    const sorted = [...amounts].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)];
    // "Clearly apart": at least $10 and 60% of the larger amount.
    const gap = Math.abs(amount - typical);
    if (gap < 10 || gap < Math.max(amount, typical) * 0.6) continue;
    if (!best || amounts.length > best.count) {
      best = { otherCategoryId: category, otherTypical: typical, count: amounts.length };
    }
  }
  if (!best) return null;
  return {
    cutoff: roundMoney((amount + best.otherTypical) / 2),
    otherCategoryId: best.otherCategoryId,
    otherTypical: best.otherTypical,
  };
}
