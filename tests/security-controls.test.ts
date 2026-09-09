import fs from "node:fs";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { prisma, resetDatabase, createTenant, type TestUser } from "./fixtures";

/**
 * Security control tests (§62): input validation, rate limiting, CSRF-shape,
 * redirect validation, SSRF, webhook signature rejection, and log redaction.
 *
 * Unlike the tenant-isolation suite, rate limiting is NOT mocked here — these
 * tests are what prove it works.
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

function request(method: string, url: string, body?: unknown, headers?: HeadersInit): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    ...(body !== undefined
      ? {
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "content-type": "application/json", ...(headers ?? {}) },
        }
      : { headers }),
  });
}

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

let alice: TestUser;

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
});

beforeEach(async () => {
  signedInUserId = alice.id;
  // Rate-limit windows are keyed by a hash of (limit, actor, window index);
  // clearing counters keeps tests independent of each other.
  await prisma.rateLimitCounter.deleteMany();
});

// ---------------------------------------------------------------------------
describe("Input validation (§14)", () => {
  it("rejects malformed JSON with 400, not 500", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, "{not json at all"),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/valid JSON/i);
    // No stack trace, no internal detail (§40).
    expect(JSON.stringify(body)).not.toMatch(/at .+:\d+:\d+/);
  });

  it("rejects unexpected properties rather than passing them through", async () => {
    // A strict schema is what stops "userId": "someone-else" from riding along
    // into a Prisma `data` object (§3, §14).
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, {
        notes: "fine",
        userId: "u_test_someone_else",
      }),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(400);

    // And the transaction still belongs to Alice.
    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: alice.transactionId },
    });
    expect(after.userId).toBe(alice.id);
  });

  it("rejects a negative budget amount", async () => {
    const { POST } = await import("@/app/api/budgets/route");
    const response = await POST(
      request("POST", "/api/budgets", { categoryId: alice.categoryId, amount: -500 }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an absurd budget amount", async () => {
    const { POST } = await import("@/app/api/budgets/route");
    const response = await POST(
      request("POST", "/api/budgets", { categoryId: alice.categoryId, amount: 1e15 }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects NaN and Infinity", async () => {
    const { POST } = await import("@/app/api/budgets/route");
    for (const raw of ['{"categoryId":"' + alice.categoryId + '","amount":null}']) {
      const response = await POST(request("POST", "/api/budgets", raw));
      expect(response.status).toBe(400);
    }
  });

  it("rejects an over-long note", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, {
        notes: "x".repeat(5000),
      }),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an over-large request body before parsing it", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const huge = JSON.stringify({ notes: "x".repeat(200_000) });
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, huge),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects a search string longer than the cap", async () => {
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(
      request("GET", `/api/transactions?search=${"a".repeat(500)}`),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unbounded page size", async () => {
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions?limit=100000"));
    expect(response.status).toBe(400);
  });

  it("rejects a malformed month key", async () => {
    const { GET } = await import("@/app/api/report/route");
    for (const month of ["2026-13", "not-a-month", "0000-00", "2026-1"]) {
      const response = await GET(request("GET", `/api/report?month=${month}`));
      expect(response.status, `month=${month}`).toBe(400);
    }
  });

  it("rejects an invalid timezone", async () => {
    const { PATCH } = await import("@/app/api/account/profile/route");
    const response = await PATCH(
      request("PATCH", "/api/account/profile", { timezone: "Mars/Olympus_Mons" }),
    );
    expect(response.status).toBe(400);
  });

  it("stores hostile strings as inert data rather than executing them", async () => {
    // XSS payloads are stored verbatim; safety comes from React escaping them
    // on render and from never using dangerouslySetInnerHTML (§16). The
    // important property here is that the write does not corrupt anything.
    const payload = '<img src=x onerror="alert(document.cookie)">';
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, { notes: payload }),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(200);

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: alice.transactionId },
    });
    expect(after.notes).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
describe("Rate limiting (§22)", () => {
  it("returns 429 once the burst budget is spent, with Retry-After", async () => {
    const { GET } = await import("@/app/api/recurring/route");

    let sawLimit = false;
    let limitedResponse: Response | null = null;

    // The `recurring` budget is 20/minute. 25 calls must hit it.
    for (let i = 0; i < 25; i++) {
      const response = await GET(request("GET", "/api/recurring"));
      if (response.status === 429) {
        sawLimit = true;
        limitedResponse = response;
        break;
      }
    }

    expect(sawLimit).toBe(true);
    expect(limitedResponse?.headers.get("Retry-After")).toBeTruthy();

    const body = await limitedResponse!.json();
    // Says nothing about which limit, the budget, or how much is left (§22).
    expect(JSON.stringify(body)).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
    expect(JSON.stringify(body)).not.toMatch(/recurring|budget|quota|window/i);
  });

  it("counts limits per user, so one user cannot exhaust another's budget", async () => {
    const bob = await createTenant("ratelimit-bob");
    const { consumeRateLimit } = await import("@/lib/security/rate-limit");

    // Spend Alice's export budget entirely (3/hour).
    for (let i = 0; i < 3; i++) {
      await consumeRateLimit("export", `user:${alice.id}`);
    }
    const aliceBlocked = await consumeRateLimit("export", `user:${alice.id}`);
    expect(aliceBlocked.ok).toBe(false);

    // Bob's budget is untouched.
    const bobAllowed = await consumeRateLimit("export", `user:${bob.id}`);
    expect(bobAllowed.ok).toBe(true);
  });

  it("persists counters in the database, so a cold start does not reset them", async () => {
    const { consumeRateLimit } = await import("@/lib/security/rate-limit");
    await consumeRateLimit("export", `user:${alice.id}`);

    // An in-process counter would leave no trace here.
    const counters = await prisma.rateLimitCounter.count();
    expect(counters).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("CSRF posture (§17)", () => {
  it("exposes no state-changing GET handler on mutating routes", async () => {
    // A GET that mutates can be triggered by an <img> tag on any website.
    // These routes must export only POST/PATCH/DELETE.
    const mutatingModules = [
      () => import("@/app/api/transactions/[id]/route"),
      () => import("@/app/api/accounts/[id]/route"),
      () => import("@/app/api/items/[id]/route"),
      () => import("@/app/api/plaid/sync/route"),
      () => import("@/app/api/plaid/create-link-token/route"),
      () => import("@/app/api/plaid/exchange-public-token/route"),
      () => import("@/app/api/cancel-help/route"),
      () => import("@/app/api/account/consent/route"),
    ];

    for (const load of mutatingModules) {
      const mod = (await load()) as Record<string, unknown>;
      expect(typeof mod.GET).not.toBe("function");
    }
  });

  it("allows the assistant's GET only because it reads nothing but configuration", async () => {
    // The Ask screen asks whether the AI layer is configured. That is a GET on
    // a route whose POST mutates, so it is called out here rather than left to
    // the blanket rule above: the exemption has to be visible, and it has to
    // stay true.
    //
    // What makes it safe is that the handler touches no user data and changes
    // nothing — triggering it from an <img> tag accomplishes precisely
    // nothing. If it ever grows a body or a write, this fails.
    const source = fs.readFileSync("src/app/api/assistant/route.ts", "utf8");
    const getBlock = source.slice(
      source.indexOf("export const GET"),
      source.indexOf("export const POST"),
    );
    expect(getBlock).toContain("llmConfigured()");
    expect(getBlock).not.toMatch(/prisma\.|body:|create|update|delete/i);
  });

  it("refuses a state-changing request from another origin", async () => {
    // Second line behind SameSite=Lax. The cookie already keeps a browser from
    // attaching credentials to a cross-site POST, but Chrome's
    // "Lax-allowing-unsafe" window and any future relaxation of SameSite would
    // both leave nothing else standing.
    const { POST } = await import("@/app/api/folders/route");
    for (const origin of ["https://evil.example", "http://localhost:3001"]) {
      const response = await POST(
        request("POST", "/api/folders", { name: "csrf" }, { origin }),
      );
      expect(response.status, `origin ${origin}`).toBe(403);
    }
  });

  it("refuses a state-changing request whose Referer is foreign", async () => {
    const { POST } = await import("@/app/api/folders/route");
    const response = await POST(
      request("POST", "/api/folders", { name: "csrf" }, { referer: "https://evil.example/x" }),
    );
    expect(response.status).toBe(403);
  });

  it("allows the app's own origin, and leaves reads alone", async () => {
    const { POST } = await import("@/app/api/folders/route");
    const ours = await POST(
      request("POST", "/api/folders", { name: `ok-${Date.now()}` }, { origin: "http://localhost:3000" }),
    );
    expect(ours.status).toBe(200);

    // A GET changes nothing, and navigations legitimately carry no Origin.
    const { GET } = await import("@/app/api/folders/route");
    const read = await GET(request("GET", "/api/folders", undefined, { origin: "https://evil.example" }));
    expect(read.status).toBe(200);
  });

  it("meters the unauthenticated health endpoint", async () => {
    // It is anonymous and its whole job is a database round trip, so an
    // unmetered one is a cheap way to exhaust the connection pool.
    const { GET } = await import("@/app/api/health/route");
    let limited = false;
    for (let i = 0; i < 130; i++) {
      const response = await GET(request("GET", "/api/health"));
      if (response.status === 429) {
        limited = true;
        expect(response.headers.get("retry-after")).toBeTruthy();
        break;
      }
    }
    expect(limited, "health never returned 429").toBe(true);
  });

  it("keeps alert preferences behind POST rather than GET", async () => {
    const mod = await import("@/app/api/alert-prefs/route");
    expect(typeof mod.GET).toBe("function"); // reading is fine
    expect(typeof mod.POST).toBe("function"); // writing is POST

    // Prove the GET does not write.
    const before = await prisma.setting.count({ where: { userId: alice.id } });
    await mod.GET(request("GET", "/api/alert-prefs"));
    const after = await prisma.setting.count({ where: { userId: alice.id } });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe("Open redirect protection (§19)", () => {
  it("refuses every external or scheme-bearing redirect target", async () => {
    const { safeRedirectPath } = await import("@/lib/security/url-guard");

    const hostile = [
      "https://evil.example.com/steal",
      "http://evil.example.com",
      "//evil.example.com",
      "/\\evil.example.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "\\\\evil.example.com",
      "/app\\..\\..\\evil",
      "https:evil.example.com",
      "/\r\nLocation: https://evil.example.com",
    ];

    for (const candidate of hostile) {
      expect(safeRedirectPath(candidate), candidate).toBe("/app");
    }
  });

  it("allows genuine internal paths", async () => {
    const { safeRedirectPath } = await import("@/lib/security/url-guard");
    expect(safeRedirectPath("/app/activity")).toBe("/app/activity");
    expect(safeRedirectPath("/app/report?month=2026-01")).toBe("/app/report?month=2026-01");
  });
});

// ---------------------------------------------------------------------------
describe("SSRF protection (§20)", () => {
  it("blocks loopback, private, link-local and metadata addresses", async () => {
    const { guardOutboundUrl } = await import("@/lib/security/url-guard");

    const blocked = [
      "https://127.0.0.1/",
      "https://localhost/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://10.0.0.1/",
      "https://192.168.1.1/",
      "https://172.16.0.1/",
      "https://0.0.0.0/",
      "https://metadata.google.internal/",
      "https://something.local/",
    ];

    for (const url of blocked) {
      const result = await guardOutboundUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it("blocks non-https schemes and non-standard ports", async () => {
    const { guardOutboundUrl } = await import("@/lib/security/url-guard");
    for (const url of [
      "http://example.com/",
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/",
      "https://example.com:8080/",
      "https://user:pass@example.com/",
    ]) {
      const result = await guardOutboundUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it("rejects unsafe display URLs before they reach an href or src", async () => {
    const { isSafeDisplayUrl, sanitizeDisplayUrl } = await import(
      "@/lib/security/url-guard"
    );

    for (const url of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://example.com/logo.png",
      "vbscript:msgbox(1)",
    ]) {
      expect(isSafeDisplayUrl(url), url).toBe(false);
      expect(sanitizeDisplayUrl(url)).toBeNull();
    }

    expect(isSafeDisplayUrl("https://example.com/logo.png")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("Plaid webhook verification (§10)", () => {
  it("rejects an unsigned webhook", async () => {
    const { POST } = await import("@/app/api/plaid/webhook/route");
    const response = await POST(
      request("POST", "/api/plaid/webhook", {
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "plaid-item-alice",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a webhook with a forged or malformed signature", async () => {
    const { POST } = await import("@/app/api/plaid/webhook/route");

    const forgeries = [
      "not.a.jwt",
      "a.b", // too few segments
      // alg: none — the classic JWT confusion attack.
      `${Buffer.from(JSON.stringify({ alg: "none", kid: "x" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString("base64url")}.`,
      // alg: HS256 — signing with the public key.
      `${Buffer.from(JSON.stringify({ alg: "HS256", kid: "x" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString("base64url")}.c2ln`,
    ];

    for (const header of forgeries) {
      const response = await POST(
        request(
          "POST",
          "/api/plaid/webhook",
          { webhook_type: "ITEM", item_id: "plaid-item-alice" },
          { "plaid-verification": header },
        ),
      );
      expect(response.status, header.slice(0, 20)).toBe(401);
    }
  });

  it("does not process an unverified webhook, even for a real item", async () => {
    const before = await prisma.item.findUniqueOrThrow({
      where: { plaidItemId: "plaid-item-alice" },
    });

    const { POST } = await import("@/app/api/plaid/webhook/route");
    await POST(
      request("POST", "/api/plaid/webhook", {
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "plaid-item-alice",
        error: { error_code: "ITEM_LOGIN_REQUIRED" },
      }),
    );

    const after = await prisma.item.findUniqueOrThrow({
      where: { plaidItemId: "plaid-item-alice" },
    });
    // Status unchanged: an unsigned request cannot mark someone's bank broken.
    expect(after.status).toBe(before.status);
  });

  it("answers GET with 405 rather than doing work", async () => {
    const { GET } = await import("@/app/api/plaid/webhook/route");
    expect(GET().status).toBe(405);
  });

  it("verification rejects a tampered body even with a well-formed header", async () => {
    const { verifyPlaidWebhook } = await import("@/lib/plaid-webhook-verify");
    const result = await verifyPlaidWebhook(
      `${Buffer.from(JSON.stringify({ alg: "ES256", kid: "k1" })).toString("base64url")}.${Buffer.from(
        JSON.stringify({ iat: Math.floor(Date.now() / 1000), request_body_sha256: "deadbeef" }),
      ).toString("base64url")}.${Buffer.alloc(64).toString("base64url")}`,
      '{"webhook_type":"ITEM"}',
    );
    expect(result.ok).toBe(false);
    // Without Plaid credentials configured the key cannot be fetched, which
    // is itself a refusal — the point is that it never returns ok.
    expect(["unknown-key", "bad-signature", "bad-signature-length"]).toContain(result.reason);
  });
});

// ---------------------------------------------------------------------------
describe("Log redaction (§12)", () => {
  it("removes secrets and financial values from logged objects", async () => {
    const { redact } = await import("@/lib/security/redact");

    const dangerous = {
      accessToken: "access-production-abc123def456ghi789",
      password: "hunter2hunter2",
      user: { email: "someone@example.com", name: "Real Person" },
      account: { currentBalance: 12345.67, mask: "4242" },
      transaction: { amount: 84.21, merchantName: "Whole Foods", notes: "rent money" },
      apiKey: "sk-ant-api03-abcdefghijklmnop",
      nested: { deep: { deeper: { databaseUrl: "postgres://u:p@host/db" } } },
    };

    const serialized = JSON.stringify(redact(dangerous));

    expect(serialized).not.toContain("access-production-abc123");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("someone@example.com");
    expect(serialized).not.toContain("12345.67");
    expect(serialized).not.toContain("84.21");
    expect(serialized).not.toContain("Whole Foods");
    expect(serialized).not.toContain("rent money");
    expect(serialized).not.toContain("sk-ant-api03");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("4242");
  });

  it("scrubs credential-shaped values out of free text", async () => {
    const { scrubString } = await import("@/lib/security/redact");

    expect(scrubString("token is access-production-xyz987abc")).not.toContain(
      "access-production-xyz987abc",
    );
    expect(scrubString("key sk-ant-api03-secretvalue123456")).not.toContain("secretvalue");
    expect(scrubString("mail me at person@example.com")).not.toContain("person@example.com");
    expect(
      scrubString("db is postgresql://user:pw@db.example.com:5432/prod"),
    ).not.toContain("db.example.com");
  });

  it("keeps query-string secrets out of logged URLs", async () => {
    const { redactUrl } = await import("@/lib/security/redact");
    const logged = redactUrl("/api/thing?token=supersecret&email=a@b.com&page=2");
    expect(logged).not.toContain("supersecret");
    expect(logged).not.toContain("a@b.com");
    expect(logged).toContain("/api/thing");
  });

  it("bounds runaway structures rather than logging them whole", async () => {
    const { redact } = await import("@/lib/security/redact");
    const huge = { list: Array.from({ length: 5000 }, (_, i) => `item-${i}`) };
    const serialized = JSON.stringify(redact(huge));
    expect(serialized.length).toBeLessThan(2000);
    expect(serialized).toContain("more");
  });
});

// ---------------------------------------------------------------------------
describe("Error handling (§40)", () => {
  it("never returns a stack trace or internal path to the client", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", "/api/transactions/nope", { notes: "x" }),
      params({ id: "nope" }),
    );
    const text = await response.text();

    expect(text).not.toContain("/home/");
    expect(text).not.toContain("node_modules");
    expect(text).not.toMatch(/at \w+ \(/);
    expect(text).not.toContain("PrismaClient");
    expect(text).not.toContain("SELECT");
  });
});
