import "server-only";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { getCategoryIdMap, getSetting, setSetting } from "@/lib/db-helpers";
import { rememberAiCategory } from "@/lib/smart-categorize";
import {
  askClaude,
  claimAiCall,
  parseJsonResponse,
  untrusted,
  untrustedBlock,
  aiConfigured,
  AiBudgetExceeded,
} from "@/lib/ai/guard";
import { sanitizeDisplayUrl } from "@/lib/security/url-guard";
import { log } from "@/lib/security/logger";

/**
 * Background AI passes — sorter, audit, logo detective — now per user
 * (§2, §7, §30-§33).
 *
 * Every query is scoped to one tenant, so the AI can only ever see the
 * transactions of the person whose sync triggered it. The verdicts it returns
 * are validated against that user's own category ids before anything is
 * written: a model that hallucinated (or was injected into emitting) an id
 * belonging to someone else simply fails the lookup and is discarded (§32).
 *
 * The cost armour from the original app is intact and now per user: batching,
 * caching each verdict as a merchant rule so a merchant costs tokens once,
 * timeouts, and daily ceilings.
 */

const BATCH = 60;

/** The user context the AI passes need. Loaded once per sync. */
export interface AiUser {
  id: string;
  timezone: string;
  emailVerified: boolean;
  aiDailyLimit: number | null;
}

async function loadAiUser(userId: string): Promise<AiUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, timezone: true, emailVerified: true, aiDailyLimit: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return null;
  return user;
}

export function aiCategorizerConfigured(): boolean {
  return aiConfigured();
}

/**
 * Sort a user's unsorted spending with one batched call.
 *
 * Never throws: a failed pass leaves the transactions for the next sync.
 */
export async function aiSortNewTransactions(userId: string): Promise<number> {
  if (!aiConfigured()) return 0;
  const user = await loadAiUser(userId);
  if (!user) return 0;

  try {
    const categoryMap = await getCategoryIdMap(userId);
    const otherId = categoryMap["Other"];

    // Unsorted spending plus anything in the generic "Other" bucket.
    const candidates = await prisma.transaction.findMany({
      where: {
        userId,
        amount: { gt: 0 },
        OR: [{ categoryId: null }, ...(otherId ? [{ categoryId: otherId }] : [])],
      },
      orderBy: { date: "desc" },
      take: BATCH,
      select: { id: true, name: true, merchantName: true, amount: true },
    });
    if (candidates.length === 0) return 0;

    await claimAiCall(user);

    // Explicit projection: id, merchant, amount. Nothing else about the
    // transaction — no account, no balance, no notes, no internal ids beyond
    // the row id the model must echo back (§30).
    const lines = candidates
      .map((t) => `${t.id}\t${untrusted(t.merchantName || t.name, 80)}\t$${t.amount.toFixed(2)}`)
      .join("\n");

    const text = await askClaude({
      system:
        "You sort bank transactions into budget categories. Reply with ONLY a JSON " +
        'object mapping each transaction id to the best category name from the ' +
        'allowed list. Use exact category names. If truly unclear, use "Other".',
      userContent:
        `Allowed categories:\n${CATEGORIES.map((c) => c.name).join(", ")}\n\n` +
        `Transactions (id, merchant, amount):\n${untrustedBlock(lines)}`,
      maxTokens: 1500,
    });

    const verdicts = parseJsonResponse<Record<string, string>>(text);
    if (!verdicts) return 0;

    const byId = new Map(candidates.map((t) => [t.id, t]));
    let sorted = 0;

    for (const [transactionId, categoryName] of Object.entries(verdicts)) {
      const transaction = byId.get(transactionId);
      // categoryMap holds only THIS user's category ids, so a verdict naming
      // anything else resolves to undefined and is dropped.
      const categoryId = typeof categoryName === "string" ? categoryMap[categoryName] : undefined;
      if (!transaction || !categoryId || categoryName === "Other") continue;

      // updateMany scoped by userId: even if the model echoed back an id it
      // was never given, the write cannot land on another tenant's row (§32).
      const { count } = await prisma.transaction.updateMany({
        where: { id: transactionId, userId },
        data: { categoryId },
      });
      if (count === 0) continue;
      sorted++;

      await rememberAiCategory(userId, transaction.merchantName || transaction.name, categoryId);
    }
    return sorted;
  } catch (error) {
    if (error instanceof AiBudgetExceeded) return 0;
    log.warn("AI transaction sorting failed", { error });
    return 0;
  }
}

const AUDIT_EVERY_DAYS = 7;
const AUDIT_MAX_TXNS = 120;

/**
 * Weekly second-opinion audit over one user's recent categorisation.
 * Skips any merchant the user has corrected by hand — their word is final.
 */
export async function aiAuditTransactions(userId: string): Promise<number> {
  if (!aiConfigured()) return 0;
  const user = await loadAiUser(userId);
  if (!user) return 0;

  try {
    const last = await getSetting(userId, "aiAuditLast");
    if (last && Date.now() - new Date(last).getTime() < AUDIT_EVERY_DAYS * 86_400_000) {
      return 0;
    }

    const since = new Date();
    since.setDate(since.getDate() - 90);

    const learned = await prisma.merchantRule.findMany({
      where: { userId, source: "learned" },
      select: { match: true },
    });
    const transactions = await prisma.transaction.findMany({
      where: { userId, amount: { gt: 0 }, date: { gte: since } },
      include: { category: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: AUDIT_MAX_TXNS,
    });
    const candidates = transactions.filter((t) => {
      const merchant = (t.merchantName || t.name).toLowerCase();
      return !learned.some((rule) => merchant.includes(rule.match));
    });
    if (candidates.length === 0) {
      await setSetting(userId, "aiAuditLast", new Date().toISOString());
      return 0;
    }

    const categoryMap = await getCategoryIdMap(userId);
    let fixed = 0;

    for (let i = 0; i < candidates.length; i += BATCH) {
      const chunk = candidates.slice(i, i + BATCH);
      await claimAiCall(user);

      const lines = chunk
        .map(
          (t) =>
            `${t.id}\t${untrusted(t.merchantName || t.name, 80)}\t$${t.amount.toFixed(2)}\t${
              t.category?.name ?? "Uncategorized"
            }`,
        )
        .join("\n");

      const text = await askClaude({
        system:
          "You audit how bank transactions were categorized. Reply with ONLY a JSON " +
          "object mapping the id of each MISCATEGORIZED transaction to the correct " +
          "category name from the allowed list. Leave correct ones out. If everything " +
          "looks right, reply {}.",
        userContent:
          `Allowed categories:\n${CATEGORIES.map((c) => c.name).join(", ")}\n\n` +
          `Transactions (id, merchant, amount, current category):\n${untrustedBlock(lines)}`,
        maxTokens: 1200,
      });

      const verdicts = parseJsonResponse<Record<string, string>>(text);
      if (!verdicts) continue;
      const byId = new Map(chunk.map((t) => [t.id, t]));

      for (const [transactionId, categoryName] of Object.entries(verdicts)) {
        const transaction = byId.get(transactionId);
        const categoryId = typeof categoryName === "string" ? categoryMap[categoryName] : undefined;
        if (!transaction || !categoryId || categoryName === "Other") continue;
        if (transaction.categoryId === categoryId) continue;

        const { count } = await prisma.transaction.updateMany({
          where: { id: transactionId, userId },
          data: { categoryId },
        });
        if (count === 0) continue;
        fixed++;

        await rememberAiCategory(userId, transaction.merchantName || transaction.name, categoryId);
      }
    }

    await setSetting(userId, "aiAuditLast", new Date().toISOString());
    return fixed;
  } catch (error) {
    if (error instanceof AiBudgetExceeded) return 0;
    log.warn("AI category audit failed", { error });
    return 0;
  }
}

/**
 * Logo detective, per user.
 *
 * Note the SSRF posture (§20): the server never fetches any of these URLs. It
 * builds a favicon URL from a domain the model suggested, validates that the
 * result is an https URL, stores it, and the *browser* loads it. The domain
 * is also constrained to a plausible hostname shape so the model cannot emit
 * something that becomes a different kind of URL entirely.
 */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function faviconFor(domain: string): string | null {
  const clean = domain.toLowerCase().replace(/^www\./, "").trim();
  if (clean.length > 253 || !DOMAIN_PATTERN.test(clean)) return null;
  return sanitizeDisplayUrl(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`,
  );
}

export async function aiIdentifyLogos(userId: string): Promise<number> {
  const user = await loadAiUser(userId);
  if (!user) return 0;

  try {
    // Free pass: spread a known logo across the same merchant's logo-less
    // rows. Scoped to this user, so one tenant's logo data never populates
    // another's rows.
    const withLogos = await prisma.transaction.findMany({
      where: { userId, logoUrl: { not: null }, merchantName: { not: null } },
      select: { merchantName: true, logoUrl: true },
      distinct: ["merchantName"],
      take: 500,
    });
    for (const row of withLogos) {
      if (!row.merchantName || !row.logoUrl) continue;
      await prisma.transaction.updateMany({
        where: { userId, merchantName: row.merchantName, logoUrl: null },
        data: { logoUrl: row.logoUrl },
      });
    }

    if (!aiConfigured()) return 0;

    const last = await getSetting(userId, "aiLogosLast");
    if (last && Date.now() - new Date(last).getTime() < 86_400_000) return 0;

    const since = new Date();
    since.setDate(since.getDate() - 90);
    const bare = await prisma.transaction.findMany({
      where: { userId, logoUrl: null, date: { gte: since } },
      select: { merchantName: true, name: true },
      orderBy: { date: "desc" },
      take: 400,
    });

    const merchants = [
      ...new Set(bare.map((t) => (t.merchantName || t.name).trim()).filter(Boolean)),
    ].slice(0, 60);

    if (merchants.length === 0) {
      await setSetting(userId, "aiLogosLast", new Date().toISOString());
      return 0;
    }

    await claimAiCall(user);

    const text = await askClaude({
      system:
        "You identify businesses from bank-statement merchant names. Reply with ONLY " +
        "a JSON object mapping each merchant name to the business's official website " +
        'domain (like "chevron.com" — no www, no https, no path), or null when you ' +
        "are not confident.",
      userContent: `Merchants:\n${untrustedBlock(
        merchants.map((m) => untrusted(m, 80)).join("\n"),
      )}`,
      maxTokens: 1200,
    });

    const domains = parseJsonResponse<Record<string, string | null>>(text);
    if (!domains) return 0;

    let found = 0;
    for (const [merchant, domain] of Object.entries(domains)) {
      if (!domain || typeof domain !== "string") continue;
      const url = faviconFor(domain);
      if (!url) continue; // rejected by the domain/URL validation above

      await prisma.transaction.updateMany({
        where: {
          userId,
          logoUrl: null,
          OR: [{ merchantName: merchant }, { name: merchant }],
        },
        data: { logoUrl: url },
      });
      found++;
    }

    await setSetting(userId, "aiLogosLast", new Date().toISOString());
    return found;
  } catch (error) {
    if (error instanceof AiBudgetExceeded) return 0;
    log.warn("AI logo identification failed", { error });
    return 0;
  }
}
