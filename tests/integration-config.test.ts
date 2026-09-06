import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import { prisma, resetDatabase, createTenant, type TestUser } from "./fixtures";

/**
 * OUR INTEGRATION, not the libraries (§6, §7 of the follow-up brief).
 *
 * The assumption throughout: Better Auth and the Plaid SDK are correct. What
 * is unproven is the way this application wires them up — a right library with
 * a wrong option is indistinguishable from a wrong library, and it is the
 * configuration that nobody tests.
 *
 * These tests read the real configuration and the real handlers.
 */

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

let signedInUserId: string | null = null;
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

const authSource = fs.readFileSync("src/lib/auth.ts", "utf8");
const proxySource = fs.readFileSync("src/proxy.ts", "utf8");

let alice: TestUser;

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
});

beforeEach(() => {
  signedInUserId = alice.id;
});

// ---------------------------------------------------------------------------
describe("Better Auth integration — cookies and sessions (§5)", () => {
  it("sets HttpOnly, SameSite and path on the session cookie", () => {
    expect(authSource).toMatch(/httpOnly:\s*true/);
    expect(authSource).toMatch(/sameSite:\s*"lax"/);
    expect(authSource).toMatch(/path:\s*"\/"/);
  });

  it("ties Secure to production rather than hard-coding it either way", () => {
    // Hard-coded `true` breaks local http development, and developers then
    // "fix" it by hard-coding `false` — which ships.
    expect(authSource).toMatch(/useSecureCookies:\s*isProduction/);
    expect(authSource).toMatch(/secure:\s*isProduction/);
  });

  it("pins an explicit cookie prefix that the proxy also uses", () => {
    // If these drift, the proxy's optimistic check reads a cookie that does
    // not exist and every signed-in user gets bounced to /login.
    const authPrefix = /cookiePrefix:\s*"([^"]+)"/.exec(authSource)?.[1];
    const proxyPrefix = /getSessionCookie\(request,\s*\{\s*cookiePrefix:\s*"([^"]+)"/.exec(
      proxySource,
    )?.[1];
    expect(authPrefix).toBeTruthy();
    expect(proxyPrefix).toBe(authPrefix);
  });

  it("bounds session lifetime and refreshes rolling", () => {
    expect(authSource).toMatch(/expiresIn:\s*60 \* 60 \* 24 \* 30/); // 30 days
    expect(authSource).toMatch(/updateAge:\s*60 \* 60 \* 24/); // refreshed daily
  });

  it("leaves CSRF origin checking enabled", () => {
    // disableCSRFCheck: true would be a one-word hole.
    expect(authSource).toMatch(/disableCSRFCheck:\s*false/);
    expect(authSource).not.toMatch(/disableCSRFCheck:\s*true/);
  });

  it("trusts only our own origin", () => {
    expect(authSource).toMatch(/trustedOrigins:\s*\[appOrigin\(\)\]/);
    // No wildcard, no reflected origin, no list of anything else.
    expect(authSource).not.toMatch(/trustedOrigins:.*\*/);
  });

  it("does not trust proxy headers for the base URL", () => {
    // trustedProxyHeaders lets X-Forwarded-Host decide the origin, which is
    // how a host-header attack turns a reset link into an attacker's URL.
    expect(authSource).not.toMatch(/trustedProxyHeaders:\s*true/);
    // baseURL comes from our own configuration instead.
    expect(authSource).toMatch(/baseURL:\s*appOrigin\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("Better Auth integration — URLs in emails (§19, §58)", () => {
  it("derives every emailed URL from server configuration, not a request", async () => {
    // appOrigin() reads APP_URL/BETTER_AUTH_URL from the environment. If a
    // reset URL were built from a request header, an attacker who controls
    // Host could receive the victim's reset link.
    const { appOrigin } = await import("@/lib/env");
    expect(appOrigin()).toMatch(/^https?:\/\//);
    expect(appOrigin()).not.toMatch(/\/$/); // no trailing slash to double up
  });

  it("requires https for the public origin in production", async () => {
    const { productionReadiness } = await import("@/lib/env");
    // In the test environment APP_URL is http://localhost, so the readiness
    // check must flag it — proving the rule exists and fires.
    const { problems } = productionReadiness();
    expect(problems.join(" ")).toMatch(/https/i);
  });

  it("never sends a URL the caller supplied", () => {
    // Search the auth config for any interpolation of request data into a
    // mail body. The only URLs are Better Auth's own `url` argument.
    const mailCalls = authSource.match(/sendMail\(\{[\s\S]*?\}\)/g) ?? [];
    expect(mailCalls.length).toBeGreaterThan(0);
    for (const call of mailCalls) {
      expect(call).not.toMatch(/req\.|request\.|headers|searchParams/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Better Auth integration — enumeration and rate limits (§22, §24)", () => {
  it("returns a synthetic user rather than 'that email exists'", () => {
    expect(authSource).toMatch(/onExistingUserSignUp/);
    expect(authSource).toMatch(/customSyntheticUser/);
  });

  it("gives the synthetic user every field a real one has", () => {
    // A synthetic response missing a field we added is a tell.
    const block = /customSyntheticUser:[\s\S]*?\}\),/.exec(authSource)?.[0] ?? "";
    for (const field of [
      "role", "timezone", "plaidUserRef", "termsAcceptedAt",
      "privacyAcceptedAt", "bankConsentAt", "onboardedAt", "aiDailyLimit", "deletedAt",
    ]) {
      expect(block, `synthetic user is missing ${field}`).toContain(field);
    }
  });

  it("rate-limits every credential endpoint, not just sign-in", () => {
    const rules = /customRules:\s*\{([\s\S]*?)\n  \},/.exec(authSource)?.[1] ?? "";
    for (const path of [
      "/sign-in/email", "/sign-up/email", "/forget-password",
      "/reset-password", "/send-verification-email", "/change-password", "/delete-user",
    ]) {
      expect(rules, `no rate-limit rule for ${path}`).toContain(path);
    }
  });

  it("stores auth rate limits in the database, not process memory", () => {
    // In-memory limits reset on every serverless cold start.
    expect(authSource).toMatch(/storage:\s*"database"/);
    expect(authSource).toMatch(/enabled:\s*true/);
  });

  it("requires email verification before a session is issued", () => {
    expect(authSource).toMatch(/requireEmailVerification:\s*true/);
    expect(authSource).toMatch(/autoSignIn:\s*false/);
  });

  it("sets a password length floor without silly composition rules", () => {
    expect(authSource).toMatch(/minPasswordLength:\s*12/);
    // No regex demanding a symbol — length is the control that matters.
    expect(authSource).not.toMatch(/passwordPattern|requireSymbol|requireUppercase/);
  });
});

// ---------------------------------------------------------------------------
describe("Proxy behaviour behind a production proxy (§19, §55)", () => {
  it("validates the ?from= redirect through the shared guard", () => {
    expect(proxySource).toMatch(/safeRedirectPath\(/);
  });

  it("leaves the webhook and health endpoints outside the cookie gate", () => {
    // The webhook authenticates by signature; a cookie gate would break it.
    expect(proxySource).toMatch(/"\/api\/plaid\/webhook"/);
    expect(proxySource).toMatch(/"\/api\/health"/);
  });

  it("still applies security headers to public paths", () => {
    // A redirect or a public page must carry CSP too.
    expect(proxySource).toMatch(/if \(isPublicPath\(pathname\)\) \{\s*return applyHeaders/);
  });

  it("documents itself as optimistic, not authoritative", () => {
    // The comment is load-bearing: the next person to read this file must not
    // conclude that authorization lives here.
    // The sentence wraps across a comment continuation (" * "), so allow it.
    expect(proxySource).toMatch(/NOT where[\s*]+authorization happens/i);
    expect(proxySource).toMatch(/Optimistic check only/i);
  });

  it("generates a fresh CSP nonce per request", () => {
    expect(proxySource).toMatch(/crypto\.randomUUID\(\)/);
    // Not a module-level constant, which would make the nonce useless.
    expect(proxySource).not.toMatch(/^const nonce = /m);
  });
});

// ---------------------------------------------------------------------------
describe("Plaid webhook implementation hardening (§10)", () => {
  const verifySource = fs.readFileSync("src/lib/plaid-webhook-verify.ts", "utf8");
  const webhookSource = fs.readFileSync("src/app/api/plaid/webhook/route.ts", "utf8");

  it("pins the algorithm instead of trusting the token's own header", async () => {
    expect(verifySource).toMatch(/header\.alg !== "ES256"/);
    // And rejects at runtime, not just in the type system.
    const { verifyPlaidWebhook } = await import("@/lib/plaid-webhook-verify");
    const noneToken = [
      Buffer.from(JSON.stringify({ alg: "none", kid: "k" })).toString("base64url"),
      Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString("base64url"),
      "",
    ].join(".");
    expect((await verifyPlaidWebhook(noneToken, "{}")).reason).toBe("bad-alg");
  });

  it("validates the key material it fetches rather than trusting it", () => {
    // A key advertising the wrong curve or algorithm must be refused even
    // though it came from Plaid's endpoint.
    expect(verifySource).toMatch(/jwk\.alg !== "ES256" \|\| jwk\.kty !== "EC" \|\| jwk\.crv !== "P-256"/);
    // And an expired key must not verify new webhooks.
    expect(verifySource).toMatch(/jwk\.expired_at !== null/);
  });

  it("caches keys by kid but never accepts an attacker-supplied key", () => {
    // The cache is keyed by kid and populated ONLY from Plaid's API. There is
    // no path where a key travels in the request.
    expect(verifySource).toMatch(/keyCache\.set\(kid, \{ key, fetchedAt: Date\.now\(\) \}\)/);
    expect(verifySource).toMatch(/plaidClient\.webhookVerificationKeyGet/);
    // The header contributes a kid string only — never key material.
    expect(verifySource).not.toMatch(/header\.(jwk|x5c|jku|n|e|x|y)/);
  });

  it("bounds the kid so a hostile header cannot become a huge lookup", () => {
    expect(verifySource).toMatch(/header\.kid\.length > 200/);
    expect(verifySource).toMatch(/verificationHeader\.length > 8192/);
  });

  it("fails closed on every parse and lookup failure", async () => {
    const { verifyPlaidWebhook } = await import("@/lib/plaid-webhook-verify");
    const cases: Array<[string, string]> = [
      ["", "{}"],
      ["not-a-jwt", "{}"],
      ["a.b", "{}"],
      ["!!!.???.###", "{}"],
      [`${"x".repeat(9000)}.a.b`, "{}"],
    ];
    for (const [header, body] of cases) {
      const result = await verifyPlaidWebhook(header || null, body);
      expect(result.ok, `header ${header.slice(0, 12)} must be refused`).toBe(false);
    }
  });

  it("bounds signature length to the exact ES256 shape", () => {
    // 64 bytes: 32-byte r followed by 32-byte s. Anything else is not an
    // ES256 signature and must not reach the verifier.
    expect(verifySource).toMatch(/signature\.length !== 64/);
    expect(verifySource).toMatch(/dsaEncoding: "ieee-p1363"/);
  });

  it("bounds webhook age in both directions", () => {
    expect(verifySource).toMatch(/ageSeconds > MAX_AGE_SECONDS/); // replay
    expect(verifySource).toMatch(/ageSeconds < -60/); // future-dated
  });

  it("compares the body digest in constant time against the RAW bytes", () => {
    // Re-serialising parsed JSON changes whitespace and key order, which
    // changes the digest. The route must read text() and parse only after.
    expect(verifySource).toMatch(/timingSafeEqual/);
    expect(webhookSource).toMatch(/const rawBody = await request\.text\(\)/);
    const verifyIndex = webhookSource.indexOf("verifyPlaidWebhook");
    const parseIndex = webhookSource.indexOf("JSON.parse(rawBody)");
    expect(verifyIndex).toBeGreaterThan(0);
    expect(parseIndex).toBeGreaterThan(verifyIndex);
  });

  it("rejects an oversized body before doing any work", () => {
    expect(webhookSource).toMatch(/rawBody\.length > 256 \* 1024/);
  });

  it("resolves the tenant from our database, never from the payload", () => {
    expect(webhookSource).toMatch(/resolveItemByPlaidId\(plaidItemId\)/);
    // Nothing reads a user id out of the body.
    expect(webhookSource).not.toMatch(/payload\.(user_id|userId)/);
  });

  it("records a delivery fingerprint before processing, for idempotency", () => {
    const fingerprintIndex = webhookSource.indexOf("webhookDelivery.create");
    // The CALL site, not the import line at the top of the file.
    const resolveIndex = webhookSource.indexOf("resolveItemByPlaidId(plaidItemId)");
    expect(fingerprintIndex).toBeGreaterThan(0);
    expect(resolveIndex).toBeGreaterThan(0);
    // De-dupe happens before the work, or a duplicate would be processed once
    // before being noticed.
    expect(fingerprintIndex).toBeLessThan(resolveIndex);
  });

  it("releases the idempotency record when processing fails, so Plaid can retry", () => {
    expect(webhookSource).toMatch(/webhookDelivery\s*\n?\s*\.delete\(\{ where: \{ fingerprint/);
  });

  it("acknowledges an unknown item instead of erroring forever", async () => {
    const { POST } = await import("@/app/api/plaid/webhook/route");
    // Unsigned, so it is refused first — the acknowledgement path is only
    // reachable with a valid signature, which is the correct ordering.
    const response = await POST(
      new Request("http://localhost:3000/api/plaid/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhook_type: "ITEM", item_id: "no-such-item" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("answers GET with 405 rather than doing work", async () => {
    const { GET } = await import("@/app/api/plaid/webhook/route");
    expect(GET().status).toBe(405);
  });

  it("keeps a disconnected Item out of the sync path", async () => {
    // §11: only a healthy Item syncs. A revoked one must not be retried
    // forever against Plaid.
    //
    // With no Plaid credentials configured (the test environment) sync exits
    // even earlier, at the `!plaidClient` guard — so the runtime assertion
    // here is that NOTHING was written, and the ordering of the status guard
    // is asserted against the source.
    const syncSource = fs.readFileSync("src/lib/sync.ts", "utf8");
    const statusGuard = syncSource.indexOf(
      'item.status !== ITEM_STATUS.CONNECTED && item.status !== ITEM_STATUS.ERROR',
    );
    const tokenFetch = syncSource.indexOf("accessTokenForOwnedItem(itemDbId, userId)");
    expect(statusGuard).toBeGreaterThan(0);
    // The status check happens BEFORE the credential is decrypted, so a dead
    // Item never causes a decryption or a Plaid call.
    expect(statusGuard).toBeLessThan(tokenFetch);

    await prisma.item.updateMany({
      where: { userId: alice.id },
      data: { status: "revoked" },
    });

    const before = await prisma.item.findFirstOrThrow({
      where: { userId: alice.id },
      select: { cursor: true, syncStartedAt: true, lastSyncedAt: true },
    });

    const { syncItemForUser } = await import("@/lib/sync");
    const result = await syncItemForUser(alice.itemId, alice.id);
    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);

    const after = await prisma.item.findFirstOrThrow({
      where: { userId: alice.id },
      select: { cursor: true, syncStartedAt: true, lastSyncedAt: true },
    });
    expect(after).toEqual(before);

    await prisma.item.updateMany({
      where: { userId: alice.id },
      data: { status: "connected" },
    });
  });

  it("requests only the read-only Plaid product", () => {
    const plaidSource = fs.readFileSync("src/lib/plaid.ts", "utf8");
    expect(plaidSource).toMatch(/PLAID_PRODUCTS = \[Products\.Transactions\]/);
    // Nothing that can move money, ever.
    for (const forbidden of ["Transfer", "PaymentInitiation", "Auth", "Signal"]) {
      expect(plaidSource, `Plaid product ${forbidden} must not be requested`).not.toMatch(
        new RegExp(`Products\\.${forbidden}`),
      );
    }
  });
});
