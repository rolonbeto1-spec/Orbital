import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Static tenant-scoping audit, run as a test (§2, §7).
 *
 * The IDOR tests attack routes that take an object id. This one comes at the
 * problem from the other direction, which is the harder half: it walks every
 * Prisma call in `src/` and asserts that operations on user-owned models name
 * the tenant.
 *
 * The dangerous cases are the ones with NO id — `findMany`, `count`,
 * `aggregate`, `groupBy`, `deleteMany`. An IDOR is at least visible in a URL;
 * an unscoped `findMany` behind a report endpoint returns everybody's data
 * with nothing in the request to hint that it happened.
 *
 * This is deliberately a lint-shaped test rather than a runtime one. A new
 * route that forgets `userId` fails here on the first CI run, before anyone
 * has to think of writing an attack for it.
 */

const OWNED_MODELS = new Set([
  "item", "account", "transaction", "holding", "category",
  "merchantRule", "budget", "goal", "property", "folder", "setting",
]);

const OPERATIONS = [
  "findMany", "findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow",
  "update", "updateMany", "delete", "deleteMany", "upsert",
  "count", "aggregate", "groupBy",
];

/**
 * Call sites that are scoped through a `where` object built earlier in the
 * function rather than inline. Each is listed explicitly, with the reason,
 * so that "it's fine, trust me" is a reviewable decision rather than a silent
 * gap. Anything not on this list must name userId inside the call itself.
 */
const REVIEWED_EXCEPTIONS: Array<{ file: string; reason: string }> = [
  {
    file: "src/app/api/transactions/route.ts",
    reason:
      "The `where` object is initialised as `{ ...ownedBy(ctx.user.id) }` on " +
      "its first line and every client filter is ANDed onto it; the findMany " +
      "and the count both use that same object. Asserted separately below.",
  },
];

interface Call {
  file: string;
  line: number;
  model: string;
  operation: string;
  source: string;
  scoped: boolean;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!full.includes("generated")) sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Extract the full text of a call by balancing parentheses. */
function callText(source: string, startIndex: number): string {
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  return source.slice(startIndex, startIndex + 2000);
}

function collectCalls(): Call[] {
  const calls: Call[] = [];
  for (const file of sourceFiles("src")) {
    const source = fs.readFileSync(file, "utf8");
    const pattern = new RegExp(
      `prisma\\.(\\w+)\\.(${OPERATIONS.join("|")})\\s*\\(`,
      "g",
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const [, model, operation] = match;
      if (!OWNED_MODELS.has(model)) continue;
      const text = callText(source, match.index + match[0].length - 1);
      calls.push({
        file,
        line: source.slice(0, match.index).split("\n").length,
        model,
        operation,
        source: text,
        scoped: /userId/.test(text),
      });
    }
  }
  return calls;
}

describe("Static tenant-scoping audit (§2, §7)", () => {
  const calls = collectCalls();

  it("finds a meaningful number of calls to audit", () => {
    // Guards against the audit silently passing because the regex broke.
    expect(calls.length).toBeGreaterThan(100);
  });

  it("scopes every operation on a user-owned model by userId", () => {
    const unscoped = calls.filter(
      (call) =>
        !call.scoped &&
        !REVIEWED_EXCEPTIONS.some((exception) => exception.file === call.file),
    );

    const report = unscoped
      .map((c) => `  ${c.file}:${c.line}  prisma.${c.model}.${c.operation}`)
      .join("\n");

    expect(unscoped, `Unscoped Prisma calls on user-owned models:\n${report}`).toEqual([]);
  });

  it("scopes every COLLECTION and AGGREGATE operation — the ones with no id", () => {
    // Called out separately because these are the dangerous half: an
    // unscoped findMany or count returns or counts every tenant's rows, and
    // nothing in the request reveals that it happened.
    const collectionOps = new Set([
      "findMany", "count", "aggregate", "groupBy", "deleteMany", "updateMany",
    ]);

    const unscoped = calls.filter(
      (call) =>
        collectionOps.has(call.operation) &&
        !call.scoped &&
        !REVIEWED_EXCEPTIONS.some((exception) => exception.file === call.file),
    );

    const report = unscoped
      .map((c) => `  ${c.file}:${c.line}  prisma.${c.model}.${c.operation}`)
      .join("\n");

    expect(unscoped, `Unscoped collection/aggregate calls:\n${report}`).toEqual([]);
  });

  it("verifies the reviewed exception really is scoped", () => {
    // The one exception builds its `where` from ownedBy(). Assert that, so the
    // exemption cannot outlive the thing that justified it.
    const source = fs.readFileSync("src/app/api/transactions/route.ts", "utf8");
    expect(source).toMatch(
      /const where: Prisma\.TransactionWhereInput = \{ \.\.\.ownedBy\(ctx\.user\.id\) \}/,
    );
    // And that no line reassigns `where` to something unscoped.
    expect(source).not.toMatch(/where\s*=\s*\{(?!\s*\.\.\.ownedBy)/);
  });

  it("uses no raw SQL against user-owned tables in the application", () => {
    // Raw SQL bypasses every Prisma-level scope. The one justified use lives
    // in a migration script, not in src/.
    for (const file of sourceFiles("src")) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, `${file} uses $queryRawUnsafe`).not.toMatch(/\$queryRawUnsafe/);
      expect(source, `${file} uses $executeRawUnsafe`).not.toMatch(/\$executeRawUnsafe/);
    }
  });

  it("exposes no id-only mutator for Items outside the owning module", () => {
    // setItemStatusById, claimSyncSlot and releaseSyncSlot all take a userId.
    // If one loses it, the webhook path stops being self-evidently scoped.
    const source = fs.readFileSync("src/lib/plaid-items.ts", "utf8");
    for (const fn of ["setItemStatusById", "claimSyncSlot", "releaseSyncSlot"]) {
      const signature = new RegExp(`export async function ${fn}\\(([^)]*)\\)`, "s");
      const match = signature.exec(source);
      expect(match, `${fn} not found`).not.toBeNull();
      expect(match![1], `${fn} must take a userId`).toMatch(/userId: string/);
    }
  });

  it("requires a userId argument on every scoped domain entry point", () => {
    // The domain layer is the other place a missing scope hides. Each of
    // these reads a whole collection for one person, so each must be told
    // which person.
    const entryPoints: Array<[file: string, fn: string]> = [
      ["src/lib/queries.ts", "getNetWorth"],
      ["src/lib/queries.ts", "getCashflow"],
      ["src/lib/queries.ts", "getSpendingByCategory"],
      ["src/lib/queries.ts", "getMonthlyTrend"],
      ["src/lib/queries.ts", "getBudgetsWithSpend"],
      ["src/lib/queries.ts", "getReimbursements"],
      ["src/lib/budget.ts", "getBudgetStatus"],
      ["src/lib/budget.ts", "getBudgetCategoryNames"],
      ["src/lib/hive.ts", "getHive"],
      ["src/lib/recurring.ts", "detectRecurring"],
      ["src/lib/nudges.ts", "getNudges"],
      ["src/lib/db-helpers.ts", "getCategoryIdMap"],
      ["src/lib/db-helpers.ts", "listCategories"],
      ["src/lib/smart-categorize.ts", "loadMerchantRules"],
      ["src/lib/smart-categorize.ts", "learnFromCorrection"],
      ["src/lib/smart-categorize.ts", "rememberAiCategory"],
      ["src/lib/ai-categorize.ts", "aiSortNewTransactions"],
      ["src/lib/ai-categorize.ts", "aiAuditTransactions"],
      ["src/lib/ai-categorize.ts", "aiIdentifyLogos"],
      ["src/lib/sync.ts", "syncItemForUser"],
      ["src/lib/sync.ts", "syncAllItemsForUser"],
      ["src/lib/account-lifecycle.ts", "purgeUserData"],
      ["src/lib/account-lifecycle.ts", "provisionNewUser"],
    ];

    for (const [file, fn] of entryPoints) {
      const source = fs.readFileSync(file, "utf8");
      const signature = new RegExp(`export async function ${fn}\\(([^)]*)\\)`, "s");
      const match = signature.exec(source);
      expect(match, `${fn} not found in ${file}`).not.toBeNull();
      expect(
        match![1],
        `${fn} in ${file} must take a userId (or a user carrying one)`,
      ).toMatch(/userId: string|user: AuthedUser|user: \{/);
    }
  });

  it("has no function that syncs or reads across all tenants", () => {
    // A `syncAllItems()` with no owner is exactly the single-tenant habit
    // this rebuild removed. Assert it has not come back.
    for (const file of sourceFiles("src")) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, `${file} declares an unscoped all-tenant function`).not.toMatch(
        /export async function (syncAllItems|getAllTransactions|getAllAccounts)\s*\(\s*\)/,
      );
    }
  });
});
