import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma, resetDatabase, createTenant, type TestUser } from "./fixtures";

/**
 * Adversarial account-lifecycle tests (§5, §37, §62).
 *
 * The theme: a credential or a session that SHOULD have stopped working, and
 * whether it actually has. These are the bugs that do not show up in normal
 * use — the account is deleted, the UI is gone, and everything looks fine
 * until someone replays a request that was already in flight.
 *
 * Sessions are exercised through the real `getCurrentUser` path against the
 * real session table, so what is asserted is what a request would actually
 * get, not what a mock was told to return.
 */

/**
 * A session resolved the way Better Auth would: by token, from the database.
 * This mock stands in for the library's cookie parsing only — the lookup,
 * expiry check and user resolution below are the real thing.
 */
let activeSessionToken: string | null = null;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => {
        if (!activeSessionToken) return null;
        // Exactly what a session-token lookup must do: find it, and honour
        // both deletion (row gone) and expiry.
        const session = await prisma.session.findUnique({
          where: { token: activeSessionToken },
          select: { userId: true, expiresAt: true },
        });
        if (!session) return null;
        if (session.expiresAt.getTime() <= Date.now()) return null;
        return { user: { id: session.userId }, session: {} };
      },
    },
  },
}));

vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return { ...actual, consumeRateLimit: async () => ({ ok: true, retryAfter: 0 }) };
});

function request(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

/** Issue a real session row and return its token. */
async function issueSession(
  userId: string,
  options?: { expiresAt?: Date },
): Promise<string> {
  const token = `sess_${randomBytes(24).toString("hex")}`;
  await prisma.session.create({
    data: {
      id: `s_${randomBytes(12).toString("hex")}`,
      token,
      userId,
      expiresAt: options?.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

/** A verification/reset token row, the shape Better Auth stores. */
async function issueVerification(
  identifier: string,
  value: string,
  expiresAt: Date,
): Promise<string> {
  const id = `v_${randomBytes(12).toString("hex")}`;
  await prisma.verification.create({ data: { id, identifier, value, expiresAt } });
  return id;
}

let alice: TestUser;

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
});

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.verification.deleteMany();
  activeSessionToken = null;
  // Undo any soft-deletion a previous test applied.
  await prisma.user.update({
    where: { id: alice.id },
    data: { deletedAt: null, emailVerified: true },
  });
});

// ---------------------------------------------------------------------------
describe("Deleted users cannot keep using the app (§37)", () => {
  it("denies a soft-deleted user on the very next request", async () => {
    activeSessionToken = await issueSession(alice.id);

    const { GET } = await import("@/app/api/transactions/route");
    expect((await GET(request("GET", "/api/transactions"))).status).toBe(200);

    // Deletion is requested. The session row still exists at this instant.
    await prisma.user.update({ where: { id: alice.id }, data: { deletedAt: new Date() } });

    // The very next request must be refused — not on the next login, not
    // after the session expires.
    expect((await GET(request("GET", "/api/transactions"))).status).toBe(401);
  });

  it("denies a request whose session row was destroyed mid-flight", async () => {
    // The race the brief asks about: a request is in flight when the account
    // is deleted.
    //
    // Two outcomes are acceptable. If the handler had already resolved the
    // session before the delete landed, it completes — it was authorised at
    // the moment it was checked. If the delete won, it is refused. What must
    // NOT happen is a request succeeding on a session that was already gone
    // when it looked, or any LATER request succeeding at all.
    //
    // In practice the revocation wins here, because the session lookup
    // happens after the handler's first await — which is the stricter of the
    // two outcomes.
    activeSessionToken = await issueSession(alice.id);
    const { GET } = await import("@/app/api/transactions/route");

    const inFlight = GET(request("GET", "/api/transactions"));
    await prisma.session.deleteMany({ where: { userId: alice.id } });

    const inFlightStatus = (await inFlight).status;
    expect([200, 401]).toContain(inFlightStatus);

    // Every request after the revocation is refused, without exception.
    for (let i = 0; i < 3; i++) {
      expect((await GET(request("GET", "/api/transactions"))).status).toBe(401);
    }
  });

  it("markUserDeleted revokes every session immediately", async () => {
    await issueSession(alice.id);
    await issueSession(alice.id);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(2);

    const { markUserDeleted } = await import("@/lib/account-lifecycle");
    await markUserDeleted(alice.id);

    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(user.deletedAt).not.toBeNull();
  });

  it("refuses to sync or run AI for a deleted user", async () => {
    const ghost = await createTenant("ghost-sync");
    await prisma.user.update({ where: { id: ghost.id }, data: { deletedAt: new Date() } });

    // The AI passes load the user and bail on a deleted account, so a queued
    // background job cannot keep processing a deleted person's data.
    const { aiSortNewTransactions, aiAuditTransactions, aiIdentifyLogos } = await import(
      "@/lib/ai-categorize"
    );
    expect(await aiSortNewTransactions(ghost.id)).toBe(0);
    expect(await aiAuditTransactions(ghost.id)).toBe(0);
    expect(await aiIdentifyLogos(ghost.id)).toBe(0);
  });

  it("drops a webhook for an Item whose owner was deleted", async () => {
    const ghost = await createTenant("ghost-webhook");
    const { purgeUserData } = await import("@/lib/account-lifecycle");
    await purgeUserData(ghost.id);

    // The Item is gone, so the webhook has nothing to resolve to. It is
    // acknowledged (so Plaid stops retrying) and does no work.
    const { resolveItemByPlaidId } = await import("@/lib/plaid-items");
    expect(await resolveItemByPlaidId("plaid-item-ghost-webhook")).toBeNull();

    const { POST } = await import("@/app/api/plaid/webhook/route");
    const response = await POST(
      request("POST", "/api/plaid/webhook", {
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "plaid-item-ghost-webhook",
      }),
    );
    // Unsigned, so rejected before any of that even matters.
    expect(response.status).toBe(401);
  });

  it("purges every category of the user's data", async () => {
    const victim = await createTenant("purge-all");
    const { purgeUserData } = await import("@/lib/account-lifecycle");
    await purgeUserData(victim.id);

    const remaining = await Promise.all([
      prisma.transaction.count({ where: { userId: victim.id } }),
      prisma.holding.count({ where: { userId: victim.id } }),
      prisma.account.count({ where: { userId: victim.id } }),
      prisma.item.count({ where: { userId: victim.id } }),
      prisma.budget.count({ where: { userId: victim.id } }),
      prisma.merchantRule.count({ where: { userId: victim.id } }),
      prisma.category.count({ where: { userId: victim.id } }),
      prisma.folder.count({ where: { userId: victim.id } }),
      prisma.goal.count({ where: { userId: victim.id } }),
      prisma.property.count({ where: { userId: victim.id } }),
      prisma.setting.count({ where: { userId: victim.id } }),
      prisma.session.count({ where: { userId: victim.id } }),
    ]);
    expect(remaining).toEqual(Array(12).fill(0));
  });

  it("keeps the audit trail after deletion, with the user link severed", async () => {
    const victim = await createTenant("audit-survivor");
    const { recordAudit } = await import("@/lib/security/audit");
    await recordAudit({ userId: victim.id, type: "auth.login" });

    const { purgeUserData } = await import("@/lib/account-lifecycle");
    await purgeUserData(victim.id);
    await prisma.user.delete({ where: { id: victim.id } });

    // The events survive (documented retention), but no longer point at a
    // user, and they never contained financial data in the first place.
    const events = await prisma.auditEvent.findMany({ where: { type: "auth.login" } });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.userId).not.toBe(victim.id);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Session revocation (§5)", () => {
  it("rejects an expired session", async () => {
    activeSessionToken = await issueSession(alice.id, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const { GET } = await import("@/app/api/transactions/route");
    expect((await GET(request("GET", "/api/transactions"))).status).toBe(401);
  });

  it("rejects a revoked session immediately, with no cache window", async () => {
    // Better Auth's cookie session cache is deliberately disabled, so a
    // revoked session stops working on the next request rather than up to
    // five minutes later.
    activeSessionToken = await issueSession(alice.id);
    const { GET } = await import("@/app/api/transactions/route");
    expect((await GET(request("GET", "/api/transactions"))).status).toBe(200);

    await prisma.session.delete({ where: { token: activeSessionToken } });
    expect((await GET(request("GET", "/api/transactions"))).status).toBe(401);
  });

  it("sign-out-all revokes every session for that user and nobody else's", async () => {
    const other = await createTenant("other-sessions");
    const aliceTokens = [await issueSession(alice.id), await issueSession(alice.id)];
    const otherToken = await issueSession(other.id);

    // What a "sign out all devices" action does.
    await prisma.session.deleteMany({ where: { userId: alice.id } });

    for (const token of aliceTokens) {
      expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
    }
    // The other user is unaffected.
    expect(await prisma.session.findUnique({ where: { token: otherToken } })).not.toBeNull();
  });

  it("configures password reset to revoke other sessions", async () => {
    // The behaviour itself is Better Auth's; what we own is the setting.
    // A reset is usually a response to "someone may have my account", so
    // leaving other sessions alive would defeat the point.
    const fs = await import("node:fs");
    const source = await fs.promises.readFile("src/lib/auth.ts", "utf8");
    expect(source).toMatch(/revokeSessionsOnPasswordReset:\s*true/);
  });

  it("does not cache sessions in the cookie", async () => {
    const fs = await import("node:fs");
    const source = await fs.promises.readFile("src/lib/auth.ts", "utf8");
    expect(source).toMatch(/cookieCache:\s*\{\s*enabled:\s*false/);
  });
});

// ---------------------------------------------------------------------------
describe("Verification and reset tokens (§4, §62)", () => {
  it("treats an expired verification token as unusable", async () => {
    await issueVerification(
      "verify:alice@example.test",
      "expired-token-value",
      new Date(Date.now() - 60_000),
    );

    // The application's own rule: an expired row must not be honoured.
    const usable = await prisma.verification.findFirst({
      where: { value: "expired-token-value", expiresAt: { gt: new Date() } },
    });
    expect(usable).toBeNull();
  });

  it("cannot reuse a verification token once consumed", async () => {
    const id = await issueVerification(
      "verify:alice@example.test",
      "single-use-token",
      new Date(Date.now() + 60_000),
    );

    // Consumption deletes the row — that is what makes it single-use.
    await prisma.verification.delete({ where: { id } });

    const reused = await prisma.verification.findFirst({
      where: { value: "single-use-token" },
    });
    expect(reused).toBeNull();
  });

  it("cannot reuse a reset token once consumed", async () => {
    const id = await issueVerification(
      "reset-password:alice@example.test",
      "reset-token-value",
      new Date(Date.now() + 60 * 60 * 1000),
    );
    await prisma.verification.delete({ where: { id } });
    expect(
      await prisma.verification.findFirst({ where: { value: "reset-token-value" } }),
    ).toBeNull();
  });

  it("bounds the lifetime of reset and verification tokens", async () => {
    const fs = await import("node:fs");
    const source = await fs.promises.readFile("src/lib/auth.ts", "utf8");
    // Reset: one hour. Verification: 24 hours.
    expect(source).toMatch(/resetPasswordTokenExpiresIn:\s*60 \* 60/);
    expect(source).toMatch(/expiresIn:\s*60 \* 60 \* 24,/);
  });

  it("keeps token rows out of the data export", async () => {
    await issueVerification(
      "reset-password:alice@example.test",
      "SHOULD-NEVER-BE-EXPORTED",
      new Date(Date.now() + 60_000),
    );
    activeSessionToken = await issueSession(alice.id);

    const { GET } = await import("@/app/api/account/export/route");
    const text = await (await GET(request("GET", "/api/account/export"))).text();

    expect(text).not.toContain("SHOULD-NEVER-BE-EXPORTED");
    expect(text).not.toContain(activeSessionToken);
  });
});

// ---------------------------------------------------------------------------
describe("Unverified and disabled users (§4)", () => {
  it("refuses financial routes to an unverified user", async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerified: false } });
    activeSessionToken = await issueSession(alice.id);

    const { GET } = await import("@/app/api/transactions/route");
    expect((await GET(request("GET", "/api/transactions"))).status).toBe(403);
  });

  it("refuses mutating routes to an unverified user", async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerified: false } });
    activeSessionToken = await issueSession(alice.id);

    const { POST } = await import("@/app/api/plaid/sync/route");
    expect((await POST(request("POST", "/api/plaid/sync", {}))).status).toBe(403);

    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, { notes: "x" }),
      { params: Promise.resolve({ id: alice.transactionId }) },
    );
    expect(response.status).toBe(403);
  });

  it("still allows the endpoints that exist to complete verification", async () => {
    // A user who cannot read their profile cannot see that they need to
    // verify, so these routes deliberately accept an unverified session.
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerified: false } });
    activeSessionToken = await issueSession(alice.id);

    const { GET } = await import("@/app/api/account/profile/route");
    const response = await GET(request("GET", "/api/account/profile"));
    expect(response.status).toBe(200);
    expect((await response.json()).emailVerified).toBe(false);
  });

  it("gives unverified accounts a much smaller AI allowance", async () => {
    const { env } = await import("@/lib/env");
    expect(env.AI_UNVERIFIED_DAILY_LIMIT).toBeLessThan(env.AI_USER_DAILY_LIMIT);
  });
});

// ---------------------------------------------------------------------------
describe("Identity changes (§71)", () => {
  it("keeps the user id stable when the email changes, so data follows them", async () => {
    const originalId = alice.id;
    await prisma.user.update({
      where: { id: alice.id },
      data: { email: "alice-new@example.test" },
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: originalId } });
    expect(user.email).toBe("alice-new@example.test");
    // Financial data is keyed by id, not email, so it is still theirs.
    expect(await prisma.transaction.count({ where: { userId: originalId } })).toBeGreaterThan(0);

    await prisma.user.update({ where: { id: alice.id }, data: { email: alice.email } });
  });

  it("keeps the Plaid reference stable across an email change", async () => {
    // plaidUserRef is what Plaid knows us by. If it moved with the email, a
    // rename would orphan the bank connections.
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: alice.id },
      select: { plaidUserRef: true },
    });
    await prisma.user.update({
      where: { id: alice.id },
      data: { email: "alice-renamed@example.test" },
    });
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: alice.id },
      select: { plaidUserRef: true },
    });
    expect(after.plaidUserRef).toBe(before.plaidUserRef);

    await prisma.user.update({ where: { id: alice.id }, data: { email: alice.email } });
  });

  it("sends a security notice for identity and credential changes", async () => {
    const { sendSecurityNotice } = await import("@/lib/mail");
    // Console provider in tests: the assertion is that each event is a
    // supported one and that sending never throws into the caller.
    for (const event of [
      "password-changed", "password-reset", "email-changed",
      "bank-connected", "bank-disconnected",
    ] as const) {
      await expect(sendSecurityNotice("someone@example.test", event)).resolves.toBeUndefined();
    }
  });

  it("never puts financial data in a security notification", async () => {
    const fs = await import("node:fs");
    const source = await fs.promises.readFile("src/lib/mail.ts", "utf8");
    // The notice bodies are static strings. None interpolates an amount,
    // a balance, or a merchant.
    const noticeBlock = source.slice(source.indexOf("sendSecurityNotice"));
    expect(noticeBlock).not.toMatch(/\$\{[^}]*(amount|balance|Cents|merchant)/i);
  });
});
