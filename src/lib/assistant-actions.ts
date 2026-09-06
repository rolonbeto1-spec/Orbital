import "server-only";
import { prisma } from "@/lib/prisma";
import { formatCurrency as formatDollars } from "@/lib/format";
import { centsToDollars, sumCentsBy } from "@/lib/money";

/** Action replies are user-facing text; cents become dollars at format time. */
const formatCurrency = (cents: number) => formatDollars(centsToDollars(cents));
import { getAlertPrefs, setAlertPrefs } from "@/lib/alert-prefs";
import { CATEGORIES } from "@/lib/categories";
import { learnFromCorrection } from "@/lib/smart-categorize";
import { getCashflow, getSpendingByCategory } from "@/lib/queries";
import { currentMonthRange } from "@/lib/time";
import type { AuthedUser } from "@/lib/security/session";
import { detectRecurring } from "@/lib/recurring";
import type { AssistantAnswer } from "@/lib/assistant";

// Maps casual words to canonical category names ("food" -> Food & Dining).
const CATEGORY_ALIASES: Record<string, string> = {
  food: "Food & Dining",
  dining: "Food & Dining",
  restaurant: "Food & Dining",
  restaurants: "Food & Dining",
  "eating out": "Food & Dining",
  grocery: "Groceries",
  gas: "Transportation",
  fuel: "Transportation",
  transport: "Transportation",
  car: "Transportation",
  bills: "Bills & Utilities",
  utilities: "Bills & Utilities",
  bill: "Bills & Utilities",
  rent: "Housing",
  mortgage: "Loan Payments",
  loan: "Loan Payments",
  loans: "Loan Payments",
  medical: "Health",
  doctor: "Health",
  fun: "Entertainment",
  subscriptions: "Entertainment",
  clothes: "Shopping",
  haircut: "Personal Care",
  vacation: "Travel",
};

function resolveCategoryName(input: string): string | null {
  const s = input.toLowerCase().replace(/[."']/g, "").trim();
  if (!s) return null;
  const exact = CATEGORIES.find((c) => c.name.toLowerCase() === s);
  if (exact) return exact.name;
  if (CATEGORY_ALIASES[s]) return CATEGORY_ALIASES[s];
  const partial = CATEGORIES.find(
    (c) => c.name.toLowerCase().startsWith(s) || c.name.toLowerCase().includes(s),
  );
  return partial ? partial.name : null;
}

// The assistant can DO things, not just answer. Commands are parsed
// deterministically (works with or without an API key) and run before the
/**
 * Deterministic assistant actions (§32).
 *
 * These are the token-free commands the chat understands directly. They are
 * the answer to "never execute arbitrary AI-generated commands": the model
 * does not choose an action or supply parameters here at all. The user's own
 * text is matched against a fixed set of patterns, and every object the
 * action touches is looked up inside the caller's tenancy.
 *
 * Every function takes `user`. Every query is scoped by `user.id`. There is
 * no code path in this file that can read or write another tenant's row.
 */

export async function maybeAction(
  user: AuthedUser,
  question: string,
): Promise<AssistantAnswer | null> {
  const q = question.toLowerCase().trim();

  // ---- "where's my money going" — the full breakdown, on demand ----
  if (
    /where(?:'?s| is| does| did)?\s+(?:my |the |all my )?money(?:\s+go(?:ing)?)?/.test(q) ||
    /\b(money breakdown|break\s*down my (spending|money))\b/.test(q)
  ) {
    const { start, end } = currentMonthRange(user.timezone);
    const [cashflow, byCategory, recurring] = await Promise.all([
      getCashflow(user.id, start, end),
      getSpendingByCategory(user.id, start, end),
      detectRecurring(user.id),
    ]);
    const total = sumCentsBy(byCategory, (c) => c.totalCents);
    const top = byCategory.slice(0, 5);
    const recurringMonthly = sumCentsBy(recurring, (r) => r.monthlyCostCents);

    // Biggest merchants this month.
    const txns = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        date: { gte: start, lte: end },
        amountCents: { gt: 0 },
        account: { isBusiness: false },
        category: { group: { not: "transfer" } },
      },
      select: { merchantName: true, name: true, amountCents: true },
    });
    const byMerchant = new Map<string, number>();
    for (const t of txns) {
      const m = t.merchantName || t.name;
      byMerchant.set(m, (byMerchant.get(m) ?? 0) + t.amountCents);
    }
    const topMerchants = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    const kept = cashflow.incomeCents - cashflow.spendingCents;
    return {
      answer:
        `This month: ${formatCurrency(cashflow.incomeCents)} came in, ${formatCurrency(cashflow.spendingCents)} went out — you kept ${formatCurrency(kept)}. ` +
        (total > 0 && top.length > 0
          ? `Most of it went to ${top[0].name} (${formatCurrency(top[0].totalCents)}, ${Math.round((top[0].totalCents / total) * 100)}% of spending). `
          : "") +
        (recurringMonthly > 0
          ? `Subscriptions and bills quietly take ${formatCurrency(recurringMonthly)}/mo — the Recurring tab in Insights lists them all.`
          : ""),
      detail: [
        ...top.map((c) => ({
          label: c.name,
          value: `${formatCurrency(c.totalCents)}${total > 0 ? ` · ${Math.round((c.totalCents / total) * 100)}%` : ""}`,
        })),
        ...topMerchants.map(([m, v], i) => ({
          label: `Top merchant ${i + 1}: ${m}`,
          value: formatCurrency(v),
        })),
      ],
    };
  }

  // ---- "the <merchant> charge is <category>" — recategorize by chat ----
  // e.g. "this chevron charge is transportation", "miners drive-in is food",
  // "categorize costco as groceries", "put the ihop one under food"
  const recat =
    q.match(
      /^(?:the |this |that |my )?(?:charge |transaction |purchase )?(?:from |at |for )?(.{2,40}?)\s*(?:charge|transaction|purchase|one)?\s+(?:is|should be|belongs (?:in|under|to)|goes (?:in|under|to))\s+(?:in |under |a |an )?(.{2,30}?)[.!]?\s*$/,
    ) ||
    q.match(
      /^(?:categori[sz]e|put|move|file)\s+(?:the |this |that |my |all )?(?:charges? |transactions? |purchases? )?(?:from |at |for )?(.{2,40}?)\s+(?:as|to|under|into|in)\s+(.{2,30}?)[.!]?\s*$/,
    );
  if (recat) {
    const merchantQuery = recat[1].trim();
    const categoryName = resolveCategoryName(recat[2]);
    if (categoryName) {
      // This user's own category row, not a shared global one.
      const category = await prisma.category.findFirst({
        where: { userId: user.id, name: categoryName },
        select: { id: true, name: true },
      });
      if (category) {
        const since = new Date();
        since.setDate(since.getDate() - 180);
        const recent = await prisma.transaction.findMany({
          where: {
            userId: user.id, date: { gte: since } },
          select: { id: true, name: true, merchantName: true, categoryId: true, amountCents: true },
          orderBy: { date: "desc" },
          take: 600,
        });
        const mq = merchantQuery.toLowerCase();
        const matches = recent.filter((t) =>
          `${t.merchantName ?? ""} ${t.name}`.toLowerCase().includes(mq),
        );
        if (matches.length === 0) {
          return {
            answer: `I couldn't find any charge matching “${merchantQuery}”. Try the name exactly as it shows in Activity.`,
          };
        }
        let moved = 0;
        for (const t of matches) {
          if (t.categoryId !== category.id) {
            await prisma.transaction.updateMany({
              where: { userId: user.id, id: t.id },
              data: { categoryId: category.id },
            });
            moved++;
          }
        }
        // Teach the permanent rule off the real merchant string.
        const merchant = matches[0].merchantName || matches[0].name;
        await learnFromCorrection(user.id, merchant, category.id);
        return {
          answer:
            moved > 0
              ? `Done — filed ${moved} ${merchant} charge${moved === 1 ? "" : "s"} under ${category.name}, and I'll remember that ${merchant} means ${category.name} from now on.`
              : `${merchant} was already under ${category.name} — and I've locked that in as a permanent rule.`,
        };
      }
    }
  }

  // ---- "sort / organize / categorize my transactions" ----
  if (
    // Any mention of categorizing/organizing implies the sorter in this app;
    // "sort"/"fix"/"clean up" need a money-ish word nearby to avoid hijacking
    // unrelated questions.
    /categori[sz]/.test(q) ||
    /\borgani[sz]e/.test(q) ||
    (/\b(sort|re-?sort|clean\s*up|fix)\b/.test(q) &&
      /\b(transactions?|charges?|spending|purchases?|activity|categor|everything|stuff|it all)\b/.test(q))
  ) {
    const { aiCategorizerConfigured, aiSortNewTransactions, aiAuditTransactions } = await import(
      "@/lib/ai-categorize"
    );
    if (!aiCategorizerConfigured()) {
      return {
        answer:
          "I need an AI key to sort transactions (add ANTHROPIC_API_KEY to the server). You can still recategorize anything by tapping it in Activity — I'll remember every correction.",
      };
    }
    // Force a full audit and logo pass right now, not on their timers.
    // Clear only THIS user's timers, so one person asking to re-sort does
    // not force a re-run for everybody (§6).
    await prisma.setting.deleteMany({
      where: { userId: user.id, key: { in: ["aiAuditLast", "aiLogosLast"] } },
    });
    const { aiIdentifyLogos } = await import("@/lib/ai-categorize");
    const sorted = await aiSortNewTransactions(user.id);
    const audited = await aiAuditTransactions(user.id);
    await aiIdentifyLogos(user.id);
    const total = sorted + audited;
    return {
      answer:
        total > 0
          ? `Done — I went through your recent activity and re-filed ${total} transaction${total === 1 ? "" : "s"} into better categories. Check Activity to see the result; tap anything I got wrong and your correction becomes the permanent rule.`
          : "I went through your recent activity and everything already looks sorted — nothing needed to move. If something specific looks wrong, tap it in Activity and recategorize it; your word overrides mine permanently.",
    };
  }

  // ---- "save <charge> to folder <name>" ----
  const save = q.match(
    /(?:save|put|file|add)\s+(?:the |this |that |my )?(?:last |latest |recent )?(?:charge|purchase|transaction|one)?\s*(?:from |at |for )?(.*?)\s*(?:to|into|in)\s+(?:a |the |my )?(?:new )?folder(?:\s+(?:called|named))?\s+["“']?([^"”']+?)["”']?\s*$/,
  );
  if (save) {
    const merchantQuery = save[1].trim();
    const folderName = titleCase(save[2].trim());
    if (!folderName) return null;

    const txn = await prisma.transaction.findFirst({
      where: {
        userId: user.id,
        amountCents: { gt: 0 },
        ...(merchantQuery
          ? {
              OR: [
                { merchantName: { contains: merchantQuery } },
                { name: { contains: merchantQuery } },
              ],
            }
          : {}),
      },
      include: { account: { select: { name: true, mask: true } } },
      orderBy: { date: "desc" },
    });
    if (!txn) {
      return {
        answer: merchantQuery
          ? `I couldn't find a charge matching “${merchantQuery}”. Try the merchant name as it appears in Activity.`
          : "I couldn't find a recent charge to save.",
      };
    }
    const folder = await prisma.folder.upsert({
      where: { userId_name: { userId: user.id, name: folderName } },
      update: {},
      create: { userId: user.id, name: folderName },
    });
    await prisma.transaction.updateMany({
      where: { id: txn.id, userId: user.id },
      data: { folderId: folder.id },
    });
    const when = txn.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return {
      answer: `Saved it: ${txn.merchantName || txn.name} — ${formatCurrency(txn.amountCents)} on ${when} (${txn.account.name}) is now in the “${folder.name}” folder. Find it any time on the Folders screen.`,
    };
  }

  // ---- budget reminder switches ----
  const wantsReminder = /(remind|notif|alert|heads.?up|tell me|let me know)/.test(q);
  const turningOff = /(stop|turn off|disable|no more|cancel|don'?t)/.test(q);
  if (wantsReminder && /budget/.test(q)) {
    const patch: { half?: boolean; full?: boolean; weekly?: boolean } = {};
    const parts: string[] = [];
    if (/(half|halfway|50\s*%|midpoint|mid.?way)/.test(q)) {
      patch.half = !turningOff;
      parts.push(`the halfway-mark alert ${turningOff ? "off" : "on"}`);
    }
    if (/(over|pass|exceed|cross|blow|full|whole|entire|100\s*%)/.test(q) && !/(half|halfway|50)/.test(q)) {
      patch.full = !turningOff;
      parts.push(`the over-budget alert ${turningOff ? "off" : "on"}`);
    }
    if (/(weekly|every week|each week|per week|week by week)/.test(q)) {
      patch.weekly = !turningOff;
      parts.push(`weekly check-ins ${turningOff ? "off" : "on"}`);
    }
    if (Object.keys(patch).length === 0) {
      // generic "remind me about my budget" → turn the pair on
      patch.half = !turningOff;
      patch.full = !turningOff;
      parts.push(`budget alerts ${turningOff ? "off" : "on"} (halfway + over-budget)`);
    }
    const prefs = await setAlertPrefs(user.id, patch);
    const state = `Now: halfway ${prefs.half ? "on" : "off"} · over-budget ${prefs.full ? "on" : "off"} · weekly ${prefs.weekly ? "on" : "off"}.`;
    return {
      answer: `Done — turned ${joinList(parts)}. Heads-ups appear on your Home screen. ${state}`,
    };
  }

  // ---- reminder switches without the word budget ("weekly check-ins") ----
  if (wantsReminder && /(weekly|every week)/.test(q) && /(spend|pace|check)/.test(q)) {
    const prefs = await setAlertPrefs(user.id, { weekly: !turningOff });
    return {
      answer: `Done — weekly pace check-ins are ${prefs.weekly ? "on" : "off"}. You'll see “week 2 of 4” style updates in the Heads up card.`,
    };
  }

  return null;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}
