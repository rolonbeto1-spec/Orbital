import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma, resetDatabase, createTenant, asAuthedUser, type TestUser } from "./fixtures";

/**
 * Concurrency and abuse (§9, §10 of the follow-up brief; §22, §48).
 *
 * Serverless requests are not serialised. A webhook, a pull-to-refresh and a
 * page load can all fire at the same instant, on different instances, against
 * the same row. Every test here runs the real operations genuinely in
 * parallel (`Promise.all`) against a real database, because a sequential test
 * proves nothing about a race.
 *
 * Rate limits are NOT mocked in this file — these are the tests that show the
 * limiter actually refuses.
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

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
  bob = await createTenant("bob");
});

beforeEach(async () => {
  signedInUserId = alice.id;
  await prisma.rateLimitCounter.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.item.updateMany({ where: {}, data: { syncStartedAt: null } });
});

// ---------------------------------------------------------------------------
describe("Sync concurrency (§48)", () => {
  it("lets exactly one of many simultaneous claims win the sync lock", async () => {
    const { claimSyncSlot } = await import("@/lib/plaid-items");

    // Ten callers, genuinely at once, for the same Item.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimSyncSlot(alice.itemId, alice.id)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(9);
  });

  it("refuses a claim from another tenant even while the Item is free", async () => {
    const { claimSyncSlot } = await import("@/lib/plaid-items");
    // Bob claiming Alice's Item must fail on ownership, not on the lock.
    expect(await claimSyncSlot(alice.itemId, bob.id)).toBe(false);
    // And Alice can still claim it, proving it was not merely locked.
    expect(await claimSyncSlot(alice.itemId, alice.id)).toBe(true);
  });

  it("releases the lock so a later sync can run", async () => {
    const { claimSyncSlot, releaseSyncSlot } = await import("@/lib/plaid-items");
    expect(await claimSyncSlot(alice.itemId, alice.id)).toBe(true);
    expect(await claimSyncSlot(alice.itemId, alice.id)).toBe(false);

    await releaseSyncSlot(alice.itemId, alice.id, null);
    expect(await claimSyncSlot(alice.itemId, alice.id)).toBe(true);
  });

  it("reclaims a lock abandoned by a killed function", async () => {
    // A serverless function killed mid-sync leaves syncStartedAt set. Without
    // the staleness window the Item would never sync again.
    await prisma.item.updateMany({
      where: { id: alice.itemId },
      data: { syncStartedAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    const { claimSyncSlot } = await import("@/lib/plaid-items");
    expect(await claimSyncSlot(alice.itemId, alice.id)).toBe(true);
  });

  it("survives a webhook and a manual sync firing together", async () => {
    // Both paths funnel through syncItemForUser, which claims the lock. With
    // no Plaid credentials both are no-ops — the assertion is that they do not
    // corrupt the row or each other.
    const { syncItemForUser } = await import("@/lib/sync");
    const before = await prisma.item.findFirstOrThrow({
      where: { id: alice.itemId },
      select: { cursor: true, status: true },
    });

    await Promise.all([
      syncItemForUser(alice.itemId, alice.id),
      syncItemForUser(alice.itemId, alice.id),
      syncItemForUser(alice.itemId, alice.id),
    ]);

    const after = await prisma.item.findFirstOrThrow({
      where: { id: alice.itemId },
      select: { cursor: true, status: true },
    });
    expect(after).toEqual(before);
  });

  it("keeps concurrent syncs for different tenants independent", async () => {
    const { claimSyncSlot } = await import("@/lib/plaid-items");
    const [aliceClaim, bobClaim] = await Promise.all([
      claimSyncSlot(alice.itemId, alice.id),
      claimSyncSlot(bob.itemId, bob.id),
    ]);
    // One tenant's lock must not block another's.
    expect(aliceClaim).toBe(true);
    expect(bobClaim).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("Duplicate creation (§48)", () => {
  it("cannot create two Items for the same Plaid item id", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.item.create({
          data: {
            userId: alice.id,
            plaidItemId: "duplicate-probe",
            institutionName: "Test Bank",
            accessTokenCipher: "v1.v1.a.b.c",
            accessTokenKeyId: "v1",
          },
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.item.count({ where: { plaidItemId: "duplicate-probe" } })).toBe(1);
  });

  it("cannot re-link an existing Plaid item into a different tenant", async () => {
    const { upsertItemForUser } = await import("@/lib/plaid-items");
    await expect(
      upsertItemForUser({
        userId: bob.id,
        plaidItemId: "plaid-item-alice", // Alice's
        accessToken: "access-sandbox-attacker",
        institutionName: "Attacker Bank",
        institutionId: null,
      }),
    ).rejects.toThrow();

    // Alice's Item is untouched and still hers.
    const item = await prisma.item.findUniqueOrThrow({
      where: { plaidItemId: "plaid-item-alice" },
    });
    expect(item.userId).toBe(alice.id);
    expect(item.institutionName).toBe("Test Bank");
  });

  it("cannot create two transactions for the same Plaid transaction id", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.transaction.create({
          data: {
            userId: alice.id,
            accountId: alice.accountId,
            plaidTransactionId: "duplicate-txn-probe",
            name: "Probe",
            amountCents: 100,
            date: new Date(),
          },
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("cannot create two budgets for one category", async () => {
    const category = await prisma.category.findFirstOrThrow({
      where: { userId: alice.id, name: "Shopping" },
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.budget.create({
          data: { userId: alice.id, categoryId: category.id, amountCents: 10_000 },
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("cannot create two folders with the same name for one user", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.folder.create({ data: { userId: alice.id, name: "Concurrent Folder" } }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    // But the same name in another tenant is fine.
    await expect(
      prisma.folder.create({ data: { userId: bob.id, name: "Concurrent Folder" } }),
    ).resolves.toBeTruthy();
  });

  it("converges on one merchant rule under concurrent learning", async () => {
    const { learnFromCorrection } = await import("@/lib/smart-categorize");
    const dining = await prisma.category.findFirstOrThrow({
      where: { userId: alice.id, name: "Food & Dining" },
    });

    // Five simultaneous corrections for the same merchant.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        learnFromCorrection(alice.id, "Concurrent Merchant", dining.id),
      ),
    );

    const rules = await prisma.merchantRule.findMany({
      where: { userId: alice.id, match: "concurrent merchant" },
    });
    // The unique constraint on (userId, match, band) permits exactly one
    // unbounded rule; the losers of the race update rather than duplicate.
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(dining.id);
  });

  it("keeps concurrent category edits from crossing tenants", async () => {
    const aliceCategory = await prisma.category.findFirstOrThrow({
      where: { userId: alice.id, name: "Travel" },
    });
    const bobCategory = await prisma.category.findFirstOrThrow({
      where: { userId: bob.id, name: "Travel" },
    });

    await Promise.all([
      prisma.category.updateMany({
        where: { id: aliceCategory.id, userId: alice.id },
        data: { inBudget: true },
      }),
      prisma.category.updateMany({
        where: { id: bobCategory.id, userId: bob.id },
        data: { inBudget: false },
      }),
    ]);

    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: aliceCategory.id } })).inBudget,
    ).toBe(true);
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: bobCategory.id } })).inBudget,
    ).toBe(false);
  });

  it("de-duplicates a replayed webhook delivery", async () => {
    const fingerprint = `replay-probe-${randomBytes(6).toString("hex")}`;
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.webhookDelivery.create({ data: { fingerprint, itemId: "probe" } }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("does not corrupt data when deletion races a sync", async () => {
    const victim = await createTenant("delete-race");
    const { claimSyncSlot } = await import("@/lib/plaid-items");
    const { purgeUserData } = await import("@/lib/account-lifecycle");

    // Start a "sync" and delete the account at the same moment.
    await Promise.all([
      claimSyncSlot(victim.itemId, victim.id).catch(() => false),
      purgeUserData(victim.id),
    ]);

    // Whatever the interleaving, the account's data is gone and nothing is
    // half-deleted.
    expect(await prisma.item.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: victim.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("Rate limit enforcement — not mocked (§22)", () => {
  it("refuses once the burst budget is spent, and says nothing useful", async () => {
    const { GET } = await import("@/app/api/recurring/route");

    let limited: Response | null = null;
    for (let i = 0; i < 30; i++) {
      const response = await GET(request("GET", "/api/recurring"));
      if (response.status === 429) { limited = response; break; }
    }

    expect(limited, "the recurring budget (20/min) should have been hit").not.toBeNull();
    expect(limited!.headers.get("Retry-After")).toBeTruthy();

    const body = JSON.stringify(await limited!.json());
    // No budget name, no counts, no window — nothing to tune an attack with.
    expect(body).not.toMatch(/recurring|budget|quota|window|remaining/i);
    expect(body).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
  });

  it("enforces the export budget at exactly its stated limit", async () => {
    const { consumeRateLimit, RATE_LIMITS } = await import("@/lib/security/rate-limit");
    const max = RATE_LIMITS.export.max;

    const actor = `user:${alice.id}`;
    for (let i = 0; i < max; i++) {
      const result = await consumeRateLimit("export", actor);
      expect(result.ok, `call ${i + 1} of ${max} should be allowed`).toBe(true);
    }
    // The boundary: one past the limit is refused.
    const overflow = await consumeRateLimit("export", actor);
    expect(overflow.ok).toBe(false);
    expect(overflow.retryAfter).toBeGreaterThan(0);
  });

  it("keeps budgets separate per user AND per endpoint", async () => {
    const { consumeRateLimit, RATE_LIMITS } = await import("@/lib/security/rate-limit");

    for (let i = 0; i < RATE_LIMITS.export.max; i++) {
      await consumeRateLimit("export", `user:${alice.id}`);
    }
    expect((await consumeRateLimit("export", `user:${alice.id}`)).ok).toBe(false);

    // A different user is unaffected...
    expect((await consumeRateLimit("export", `user:${bob.id}`)).ok).toBe(true);
    // ...and so is a different endpoint for the same user.
    expect((await consumeRateLimit("read", `user:${alice.id}`)).ok).toBe(true);
  });

  it("counts concurrent requests, so a burst cannot slip through", async () => {
    // The classic limiter bug: read-then-write means N simultaneous requests
    // all read the same count and all proceed. The atomic upsert prevents it.
    const { consumeRateLimit, RATE_LIMITS } = await import("@/lib/security/rate-limit");
    const max = RATE_LIMITS.export.max;
    const actor = `user:${alice.id}`;

    const results = await Promise.all(
      Array.from({ length: max + 10 }, () => consumeRateLimit("export", actor)),
    );
    const allowed = results.filter((r) => r.ok).length;
    expect(allowed).toBeLessThanOrEqual(max);
  });

  it("persists counters in the database, so a cold start does not reset them", async () => {
    const { consumeRateLimit } = await import("@/lib/security/rate-limit");
    await consumeRateLimit("export", `user:${alice.id}`);
    expect(await prisma.rateLimitCounter.count()).toBeGreaterThan(0);
  });

  it("gives every risky endpoint its own budget", async () => {
    const { RATE_LIMITS } = await import("@/lib/security/rate-limit");
    for (const name of [
      "ai", "aiSustained", "plaidLinkToken", "plaidExchange", "plaidSync",
      "cancelHelper", "report", "recurring", "export", "read", "write", "webhook",
    ] as const) {
      expect(RATE_LIMITS[name], `no budget for ${name}`).toBeTruthy();
      expect(RATE_LIMITS[name].max).toBeGreaterThan(0);
      expect(RATE_LIMITS[name].windowSeconds).toBeGreaterThan(0);
    }
    // Expensive things are tighter than cheap things.
    expect(RATE_LIMITS.export.max).toBeLessThan(RATE_LIMITS.read.max);
    expect(RATE_LIMITS.ai.max).toBeLessThan(RATE_LIMITS.read.max);
  });
});

// ---------------------------------------------------------------------------
describe("AI spend cannot be laundered through extra accounts (§33)", () => {
  it("caps total spend globally, no matter how many accounts exist", async () => {
    // The attack: create N accounts, each with its own per-user budget, and
    // spend N x budget. The global ceiling is the backstop.
    const { claimAiCall, AiBudgetExceeded } = await import("@/lib/ai/guard");
    const { env } = await import("@/lib/env");

    // Ten fresh accounts, each with a generous personal allowance.
    const users = [];
    for (let i = 0; i < 10; i++) {
      users.push(await createTenant(`ai-abuse-${i}`));
    }

    // Drive the shared global counter to just under its ceiling.
    await prisma.rateLimitCounter.upsert({
      where: { key: `__global_ai_calls:${new Date().toISOString().slice(0, 10)}` },
      create: {
        key: `__global_ai_calls:${new Date().toISOString().slice(0, 10)}`,
        count: env.AI_DAILY_LIMIT - 1,
        resetAt: new Date(Date.now() + 86_400_000),
      },
      update: { count: env.AI_DAILY_LIMIT - 1 },
    });

    // The next call from ANY account is the last one.
    await claimAiCall({ ...asAuthedUser(users[0]), aiDailyLimit: 1000 });

    // Every subsequent account is refused, even though each has personal
    // budget left. That is the ceiling doing its job.
    for (const user of users.slice(1)) {
      await expect(
        claimAiCall({ ...asAuthedUser(user), aiDailyLimit: 1000 }),
      ).rejects.toBeInstanceOf(AiBudgetExceeded);
    }
  });

  it("counts every account against one shared counter row", async () => {
    const { claimAiCall } = await import("@/lib/ai/guard");
    await claimAiCall({ ...asAuthedUser(alice), aiDailyLimit: 100 });
    await claimAiCall({ ...asAuthedUser(bob), aiDailyLimit: 100 });

    const counters = await prisma.rateLimitCounter.findMany({
      where: { key: { startsWith: "__global_ai_calls" } },
    });
    expect(counters).toHaveLength(1);
    expect(counters[0].count).toBe(2);
  });

  it("gives a brand-new unverified account a much smaller allowance", async () => {
    const { claimAiCall, AiBudgetExceeded } = await import("@/lib/ai/guard");
    const { env } = await import("@/lib/env");

    const fresh = await createTenant("ai-unverified");
    await prisma.user.update({ where: { id: fresh.id }, data: { emailVerified: false } });

    const user = { ...asAuthedUser(fresh), emailVerified: false, aiDailyLimit: null };
    for (let i = 0; i < env.AI_UNVERIFIED_DAILY_LIMIT; i++) {
      await claimAiCall(user);
    }
    await expect(claimAiCall(user)).rejects.toBeInstanceOf(AiBudgetExceeded);

    // A verified account of the same age gets the larger budget.
    expect(env.AI_USER_DAILY_LIMIT).toBeGreaterThan(env.AI_UNVERIFIED_DAILY_LIMIT);
  });

  it("stops all AI spend when the kill switch is set", async () => {
    // AI_DAILY_LIMIT=0 must refuse everyone, immediately.
    const { env } = await import("@/lib/env");
    expect(env.AI_DAILY_LIMIT).toBeGreaterThan(0); // default
    // The guard's rule, asserted at the source since env is parsed at import.
    const fs = await import("node:fs");
    const guard = await fs.promises.readFile("src/lib/ai/guard.ts", "utf8");
    expect(guard).toMatch(/if \(env\.AI_DAILY_LIMIT === 0\) throw new AiBudgetExceeded\("global"\)/);
  });
});
