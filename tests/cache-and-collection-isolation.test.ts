import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { prisma, resetDatabase, createTenant, asAuthedUser, type TestUser } from "./fixtures";

/**
 * Two attacks that do not involve guessing an object id (§53, and §7 from the
 * collection side).
 *
 * 1. CACHE ISOLATION. Every authenticated response is built from one tenant's
 *    data. The failure mode is not an attacker doing anything clever — it is
 *    the framework, a CDN, or a memoised function handing A's response to B.
 *    These tests alternate two users through the same handlers, with
 *    deliberately DIFFERENT values, and assert nobody sees the other's number.
 *
 * 2. AUTHORIZATION WITHOUT AN ID. Reports, summaries, dashboards, exports and
 *    the assistant take no target object, so there is no id to check. The only
 *    thing standing between tenants is that every query behind the response
 *    names the caller. These tests assert that at the response level.
 *
 * Alice and Bob are given clearly distinguishable finances so a leak is
 * unmistakable rather than plausible: Alice spends $84.21, Bob spends
 * $1,234.56; Alice holds $2,500, Bob holds $9,999.
 */

let signedInUserId: string | null = null;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        signedInUserId ? { user: { id: signedInUserId }, session: {} } : null,
    },
  },
}));

vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return { ...actual, consumeRateLimit: async () => ({ ok: true, retryAfter: 0 }) };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        throw Object.assign(new Error("mocked: no network in tests"), { status: 503 });
      },
    };
  },
}));

function request(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

let alice: TestUser;
let bob: TestUser;

/** Distinctive markers, so a leak is unambiguous. */
const ALICE_SPEND_CENTS = 8421; // $84.21 (from the fixture)
const BOB_SPEND_CENTS = 123_456; // $1,234.56
const ALICE_BALANCE_CENTS = 250_000; // $2,500.00 (from the fixture)
const BOB_BALANCE_CENTS = 999_900; // $9,999.00
const BOB_MERCHANT = "BOBS-DISTINCTIVE-MERCHANT";

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
  bob = await createTenant("bob");

  // Give Bob unmistakably different numbers and a unique merchant string.
  await prisma.account.updateMany({
    where: { userId: bob.id },
    data: { currentBalanceCents: BOB_BALANCE_CENTS, availableBalanceCents: BOB_BALANCE_CENTS },
  });
  await prisma.transaction.updateMany({
    where: { userId: bob.id },
    data: { amountCents: BOB_SPEND_CENTS, merchantName: BOB_MERCHANT, name: BOB_MERCHANT },
  });
  await prisma.budget.updateMany({
    where: { userId: bob.id },
    data: { amountCents: 777_700 },
  });
  await prisma.goal.updateMany({
    where: { userId: bob.id },
    data: { name: "BOBS-SECRET-GOAL", targetAmountCents: 5_555_500 },
  });
});

beforeEach(() => {
  signedInUserId = alice.id;
});

/** Every endpoint that returns money and takes no object id. */
const COLLECTION_ENDPOINTS: Array<[name: string, path: string, load: () => Promise<{ GET: (r: Request) => Promise<Response> }>]> = [
  ["dashboard", "/api/dashboard", () => import("@/app/api/dashboard/route")],
  ["hive", "/api/hive", () => import("@/app/api/hive/route")],
  ["insights", "/api/insights", () => import("@/app/api/insights/route")],
  ["report", "/api/report", () => import("@/app/api/report/route")],
  ["digest", "/api/digest", () => import("@/app/api/digest/route")],
  ["budget-overview", "/api/budget-overview", () => import("@/app/api/budget-overview/route")],
  ["budgets", "/api/budgets", () => import("@/app/api/budgets/route")],
  ["goals", "/api/goals", () => import("@/app/api/goals/route")],
  ["accounts", "/api/accounts", () => import("@/app/api/accounts/route")],
  ["transactions", "/api/transactions", () => import("@/app/api/transactions/route")],
  ["recurring", "/api/recurring", () => import("@/app/api/recurring/route")],
  ["reimbursements", "/api/reimbursements", () => import("@/app/api/reimbursements/route")],
  ["holdings", "/api/holdings", () => import("@/app/api/holdings/route")],
  ["categories", "/api/categories", () => import("@/app/api/categories/route")],
  ["folders", "/api/folders", () => import("@/app/api/folders/route")],
  ["properties", "/api/properties", () => import("@/app/api/properties/route")],
  ["questions", "/api/questions", () => import("@/app/api/questions/route")],
  ["nudges", "/api/nudges", () => import("@/app/api/nudges/route")],
  ["export", "/api/account/export", () => import("@/app/api/account/export/route")],
  ["profile", "/api/account/profile", () => import("@/app/api/account/profile/route")],
  ["audit", "/api/account/audit", () => import("@/app/api/account/audit/route")],
  ["plaid-status", "/api/plaid/status", () => import("@/app/api/plaid/status/route")],
  ["alert-prefs", "/api/alert-prefs", () => import("@/app/api/alert-prefs/route")],
  ["hive-layout", "/api/hive-layout", () => import("@/app/api/hive-layout/route")],
];

// ---------------------------------------------------------------------------
describe("Authorization without an object id (§7 from the collection side)", () => {
  it("never returns B's markers to A, on any collection endpoint", async () => {
    for (const [name, path, load] of COLLECTION_ENDPOINTS) {
      signedInUserId = alice.id;
      const { GET } = await load();
      const response = await GET(request("GET", path));
      expect(response.status, `${name} should answer A`).toBe(200);

      const text = await response.text();

      // Bob's identity and his distinctive values must appear nowhere.
      expect(text, `${name} leaked B's user id`).not.toContain(bob.id);
      expect(text, `${name} leaked B's email`).not.toContain(bob.email);
      expect(text, `${name} leaked B's merchant`).not.toContain(BOB_MERCHANT);
      expect(text, `${name} leaked B's goal`).not.toContain("BOBS-SECRET-GOAL");
      expect(text, `${name} leaked B's spend`).not.toContain("1234.56");
      expect(text, `${name} leaked B's balance`).not.toContain("9999");
      expect(text, `${name} leaked B's budget`).not.toContain("7777");
    }
  });

  it("never returns A's markers to B, on any collection endpoint", async () => {
    // The mirror image. A leak is rarely symmetric, so both directions are
    // worth asserting.
    for (const [name, path, load] of COLLECTION_ENDPOINTS) {
      signedInUserId = bob.id;
      const { GET } = await load();
      const response = await GET(request("GET", path));
      expect(response.status, `${name} should answer B`).toBe(200);

      const text = await response.text();
      expect(text, `${name} leaked A's user id`).not.toContain(alice.id);
      expect(text, `${name} leaked A's email`).not.toContain(alice.email);
    }
  });

  it("gives each user their own totals from the same aggregate endpoints", async () => {
    const checks: Array<[string, () => Promise<{ GET: (r: Request) => Promise<Response> }>, string, (body: Record<string, unknown>) => number]> = [
      ["insights", () => import("@/app/api/insights/route"), "/api/insights",
        (b) => (b.cashflow as { spending: number }).spending],
      ["report", () => import("@/app/api/report/route"), "/api/report",
        (b) => b.spending as number],
    ];

    for (const [name, load, path, extract] of checks) {
      const { GET } = await load();

      signedInUserId = alice.id;
      const aliceBody = await (await GET(request("GET", path))).json();

      signedInUserId = bob.id;
      const bobBody = await (await GET(request("GET", path))).json();

      expect(extract(aliceBody), `${name}: A's spending`).toBe(ALICE_SPEND_CENTS / 100);
      expect(extract(bobBody), `${name}: B's spending`).toBe(BOB_SPEND_CENTS / 100);
      // And crucially not the sum, which is what an unscoped query returns.
      expect(extract(aliceBody)).not.toBe((ALICE_SPEND_CENTS + BOB_SPEND_CENTS) / 100);
    }
  });

  it("gives each user their own net worth from the dashboard", async () => {
    const { GET } = await import("@/app/api/dashboard/route");

    signedInUserId = alice.id;
    const aliceBody = await (await GET(request("GET", "/api/dashboard"))).json();
    signedInUserId = bob.id;
    const bobBody = await (await GET(request("GET", "/api/dashboard"))).json();

    expect(aliceBody.netWorth.assets).toBe(ALICE_BALANCE_CENTS / 100);
    expect(bobBody.netWorth.assets).toBe(BOB_BALANCE_CENTS / 100);
  });
});

// ---------------------------------------------------------------------------
describe("Cache isolation — alternating tenants through one handler (§53)", () => {
  it("does not carry A's response into B's request, on any endpoint", async () => {
    // Run A, then B, then A again, through the same module instance. A shared
    // cache anywhere in the stack — React cache(), a module-level memo, a
    // Next data cache — shows up as the second call returning the first
    // call's body.
    for (const [name, path, load] of COLLECTION_ENDPOINTS) {
      const { GET } = await load();

      signedInUserId = alice.id;
      const first = await (await GET(request("GET", path))).text();

      signedInUserId = bob.id;
      const second = await (await GET(request("GET", path))).text();

      signedInUserId = alice.id;
      const third = await (await GET(request("GET", path))).text();

      // Some responses legitimately carry a timestamp (the export stamps
      // exportedAt), so compare with those normalised — a differing clock is
      // not a cache leak.
      const stable = (body: string) =>
        body.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<TIME>");

      // B's response must not equal A's, unless the endpoint genuinely
      // returns tenant-independent content (an empty list, a static shape).
      if (stable(first) !== stable(second)) {
        // Different, as expected. A's repeat must match A's original.
        expect(stable(third), `${name}: A's repeat response changed`).toBe(stable(first));
      }

      // Whatever the shapes, B's body must not contain A's identity.
      expect(second, `${name}: B's response contained A's id`).not.toContain(alice.id);
      expect(second, `${name}: B's response contained A's email`).not.toContain(alice.email);
    }
  });

  it("re-resolves the session per request rather than memoising it globally", async () => {
    // getCurrentUser is wrapped in React's cache(). If that cache were
    // process-wide instead of per-request, this would return Alice for Bob.
    const { getCurrentUser } = await import("@/lib/security/session");

    signedInUserId = alice.id;
    expect((await getCurrentUser())?.id).toBe(alice.id);

    signedInUserId = bob.id;
    expect((await getCurrentUser())?.id).toBe(bob.id);

    signedInUserId = alice.id;
    expect((await getCurrentUser())?.id).toBe(alice.id);

    signedInUserId = null;
    expect(await getCurrentUser()).toBeNull();
  });

  it("marks every authenticated response private, no-store and Vary: Cookie", async () => {
    for (const [name, path, load] of COLLECTION_ENDPOINTS) {
      signedInUserId = alice.id;
      const { GET } = await load();
      const response = await GET(request("GET", path));

      const cacheControl = response.headers.get("Cache-Control") ?? "";
      expect(cacheControl, `${name} Cache-Control`).toContain("private");
      expect(cacheControl, `${name} Cache-Control`).toContain("no-store");
      expect(response.headers.get("Vary"), `${name} Vary`).toContain("Cookie");

      // A public/max-age combination on any of these would let a CDN serve
      // one person's balances to the next visitor.
      expect(cacheControl, `${name} must not be publicly cacheable`).not.toMatch(/\bpublic\b/);
      expect(cacheControl, `${name} must not have a positive max-age`).not.toMatch(
        /max-age=[1-9]/,
      );
      expect(cacheControl, `${name} must not be s-maxage'd`).not.toMatch(/s-maxage/);
    }
  });

  it("declares every data route dynamic, so nothing is prerendered at build", async () => {
    // A statically-rendered authenticated route would bake one user's data
    // into the build output and serve it to everyone.
    const fs = await import("node:fs");
    const path = await import("node:path");

    function routeFiles(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
      }
      return out;
    }

    for (const file of routeFiles("src/app/api")) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, `${file} must declare dynamic = "force-dynamic"`).toMatch(
        /export const dynamic = "force-dynamic"/,
      );
    }
  });

  it("keeps the AI snapshot inside one tenant", async () => {
    // The assistant builds a financial snapshot per request. If that were
    // cached across users, B would get an answer grounded in A's money.
    const { ask } = await import("@/lib/assistant");

    const aliceAnswer = await ask(asAuthedUser(alice), "what is my net worth?");
    const bobAnswer = await ask(asAuthedUser(bob), "what is my net worth?");

    expect(aliceAnswer.answer).toContain("2,500");
    expect(bobAnswer.answer).toContain("9,999");
    expect(aliceAnswer.answer).not.toContain("9,999");
    expect(bobAnswer.answer).not.toContain("2,500");
  });

  it("keeps per-user settings out of each other's reads", async () => {
    // The Setting table is keyed (userId, key) — the same key for two users
    // must return two different values, not one shared row.
    const { setSetting, getSetting } = await import("@/lib/db-helpers");

    await setSetting(alice.id, "cacheProbe", "ALICE-VALUE");
    await setSetting(bob.id, "cacheProbe", "BOB-VALUE");

    expect(await getSetting(alice.id, "cacheProbe")).toBe("ALICE-VALUE");
    expect(await getSetting(bob.id, "cacheProbe")).toBe("BOB-VALUE");
  });
});

// ---------------------------------------------------------------------------
describe("Mutating collection endpoints stay scoped", () => {
  it("sync-all touches only the caller's items", async () => {
    const { POST } = await import("@/app/api/plaid/sync/route");

    signedInUserId = alice.id;
    const before = await prisma.item.findMany({
      where: { userId: bob.id },
      select: { id: true, cursor: true, syncStartedAt: true, status: true },
    });

    // No Plaid credentials in the test environment, so this is a no-op — but
    // it must be a no-op that never touched Bob's rows.
    const response = await POST(request("POST", "/api/plaid/sync", {}));
    expect(response.status).toBe(200);

    const after = await prisma.item.findMany({
      where: { userId: bob.id },
      select: { id: true, cursor: true, syncStartedAt: true, status: true },
    });
    expect(after).toEqual(before);
  });

  it("the AI sorter writes only inside the caller's tenant", async () => {
    const { aiSortNewTransactions } = await import("@/lib/ai-categorize");

    const bobBefore = await prisma.transaction.findMany({
      where: { userId: bob.id },
      select: { id: true, categoryId: true },
      orderBy: { id: "asc" },
    });

    await aiSortNewTransactions(alice.id);

    const bobAfter = await prisma.transaction.findMany({
      where: { userId: bob.id },
      select: { id: true, categoryId: true },
      orderBy: { id: "asc" },
    });
    expect(bobAfter).toEqual(bobBefore);
  });

  it("account deletion removes only the caller's rows", async () => {
    const victim = await createTenant("delete-probe");
    const { purgeUserData } = await import("@/lib/account-lifecycle");

    const aliceBefore = await prisma.transaction.count({ where: { userId: alice.id } });
    const bobBefore = await prisma.transaction.count({ where: { userId: bob.id } });

    await purgeUserData(victim.id);

    expect(await prisma.transaction.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.item.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.category.count({ where: { userId: victim.id } })).toBe(0);

    // Everyone else is untouched.
    expect(await prisma.transaction.count({ where: { userId: alice.id } })).toBe(aliceBefore);
    expect(await prisma.transaction.count({ where: { userId: bob.id } })).toBe(bobBefore);
  });
});
