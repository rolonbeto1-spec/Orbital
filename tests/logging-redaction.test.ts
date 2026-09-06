import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDatabase, createTenant, type TestUser } from "./fixtures";

/**
 * Logging audit by planted canary (§11 of the follow-up brief; §12, §40, §73).
 *
 * Reading `redact()` proves that redaction is implemented. It does not prove
 * that the values which actually reach a log line pass through it. So this
 * suite does the opposite: it plants distinctive, unmistakable fake values in
 * the database and in request bodies, drives the real code paths — including
 * the failure paths, which is where careless logging lives — captures every
 * byte written to stdout and stderr, and then asserts that not one canary
 * appears anywhere in it.
 *
 * A canary is chosen so that a match cannot be a coincidence. If
 * "CanaryFirstNationalBankOfNowhere" shows up in a log line, something logged
 * an account name, and there is no other explanation.
 */

// --- The canaries ----------------------------------------------------------
const CANARY = {
  plaidToken: "access-production-CANARY0000-1111-2222-3333-444444444444",
  publicToken: "public-production-CANARY0000-1111-2222-3333-444444444444",
  bankAccountName: "CanaryFirstNationalBankOfNowhere",
  institution: "CanaryInstitutionZzyzx",
  transactionName: "CANARY MERCHANT QUUXFROBNITZ",
  merchantName: "CanaryMerchantQuuxfrobnitz",
  notes: "CanaryPrivateNoteAboutTherapyAppointment",
  balanceCents: 123_456_789, // $1,234,567.89 — distinctive in either form
  balanceDollars: "1234567.89",
  email: "canary.person.zzyzx@example.invalid",
  authCookie: "better-auth.session_token=CANARYSESSIONCOOKIEVALUE0123456789",
  sessionToken: "CANARYSESSIONCOOKIEVALUE0123456789",
  resetToken: "CANARYPASSWORDRESETTOKEN9876543210abcdef",
  anthropicKey: "sk-ant-api03-CANARYANTHROPICKEY0123456789abcdefghij",
  databaseUrl: "postgresql://canaryuser:CanaryDbPassword@db.example.invalid:5432/metta",
} as const;

/** Every canary that must never be logged, with the reason it matters. */
const FORBIDDEN: Array<[label: string, value: string]> = [
  ["Plaid access token", CANARY.plaidToken],
  ["Plaid public token", CANARY.publicToken],
  ["bank account name", CANARY.bankAccountName],
  ["institution name", CANARY.institution],
  ["transaction description", CANARY.transactionName],
  ["merchant name", CANARY.merchantName],
  ["private note", CANARY.notes],
  ["exact balance (cents)", String(CANARY.balanceCents)],
  ["exact balance (dollars)", CANARY.balanceDollars],
  ["email address", CANARY.email],
  ["auth cookie", CANARY.sessionToken],
  ["password reset token", CANARY.resetToken],
  ["Anthropic API key", CANARY.anthropicKey],
  ["database URL password", "CanaryDbPassword"],
];

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

// The AI client throws with the API key embedded in the message, which is a
// realistic SDK failure and the exact way a key reaches a log line.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        throw new Error(
          `401 Unauthorized: invalid x-api-key ${CANARY.anthropicKey} for ${CANARY.databaseUrl}`,
        );
      },
    };
  },
}));

// --- Output capture --------------------------------------------------------
let captured: string[] = [];
const realConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function record(...args: unknown[]): void {
  captured.push(args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

beforeEach(() => {
  captured = [];
  console.log = record;
  console.warn = record;
  console.error = record;
  console.debug = record;
});

afterEach(() => {
  Object.assign(console, realConsole);
});

function loggedOutput(): string {
  return captured.join("\n");
}

/** Assert no canary is present, naming which one leaked and where. */
function expectNoCanaries(where: string): void {
  const output = loggedOutput();
  const leaked = FORBIDDEN.filter(([, value]) => output.includes(value));
  const detail = leaked
    .map(([label, value]) => {
      const line = captured.find((l) => l.includes(value)) ?? "";
      return `  ${label} leaked in: ${line.slice(0, 300)}`;
    })
    .join("\n");
  expect(leaked.map(([label]) => label), `${where} leaked:\n${detail}`).toEqual([]);
}

function request(method: string, url: string, body?: unknown, headers?: HeadersInit): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

let alice: TestUser;

beforeAll(async () => {
  Object.assign(console, realConsole);
  await resetDatabase();
  alice = await createTenant("alice");

  // Plant the canaries in real rows.
  await prisma.item.update({
    where: { id: alice.itemId },
    data: { institutionName: CANARY.institution },
  });
  await prisma.account.update({
    where: { id: alice.accountId },
    data: {
      name: CANARY.bankAccountName,
      currentBalanceCents: CANARY.balanceCents,
      availableBalanceCents: CANARY.balanceCents,
    },
  });
  await prisma.transaction.update({
    where: { id: alice.transactionId },
    data: {
      name: CANARY.transactionName,
      merchantName: CANARY.merchantName,
      notes: CANARY.notes,
      amountCents: CANARY.balanceCents,
    },
  });
  await prisma.user.update({ where: { id: alice.id }, data: { email: CANARY.email } });
});

describe("Redaction unit behaviour on each canary shape (§12)", () => {
  it("scrubs every credential-shaped canary out of free text", async () => {
    const { scrubString } = await import("@/lib/security/redact");
    for (const value of [
      CANARY.plaidToken,
      CANARY.publicToken,
      CANARY.anthropicKey,
      CANARY.databaseUrl,
      CANARY.email,
    ]) {
      const scrubbed = scrubString(`something failed with ${value} attached`);
      expect(scrubbed, `${value} survived scrubString`).not.toContain(value);
    }
  });

  it("never emits a value held under a secret-named key", async () => {
    const { redact } = await import("@/lib/security/redact");
    const out = redact({
      accessToken: CANARY.plaidToken,
      cookie: CANARY.authCookie,
      token: CANARY.resetToken,
      apiKey: CANARY.anthropicKey,
      databaseUrl: CANARY.databaseUrl,
    });
    expect(JSON.stringify(out)).not.toMatch(/CANARY/);
  });

  it("reduces a financial value to a type marker, not a number", async () => {
    const { redact } = await import("@/lib/security/redact");
    const out = redact({
      amountCents: CANARY.balanceCents,
      currentBalance: CANARY.balanceCents,
      merchantName: CANARY.merchantName,
      notes: CANARY.notes,
    }) as Record<string, unknown>;
    expect(out.amountCents).toBe("[number]");
    expect(out.currentBalance).toBe("[number]");
    expect(out.merchantName).toBe("[string]");
    expect(out.notes).toBe("[string]");
    expect(JSON.stringify(out)).not.toContain(String(CANARY.balanceCents));
  });

  it("scrubs a stack trace, which is where tokens usually hide", async () => {
    const { redact } = await import("@/lib/security/redact");
    const error = new Error(`sync failed for ${CANARY.plaidToken}`);
    error.stack = `Error: sync failed for ${CANARY.plaidToken}\n    at f (/app/x.ts:1:1)`;
    expect(JSON.stringify(redact({ error }))).not.toContain(CANARY.plaidToken);
  });

  it("keeps tokens out of a logged URL's query string", async () => {
    const { redactUrl } = await import("@/lib/security/redact");
    const out = redactUrl(`/api/plaid/callback?public_token=${CANARY.publicToken}&state=x`);
    expect(out).not.toContain(CANARY.publicToken);
  });
});

describe("Nothing sensitive reaches the log stream (§40)", () => {
  it("logs no canary while serving an authenticated data request", async () => {
    signedInUserId = alice.id;
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions?search=canary"));
    expect(response.status).toBe(200);
    // The response body legitimately contains the data; the LOG must not.
    expectNoCanaries("GET /api/transactions");
  });

  it("logs no canary while serving accounts and balances", async () => {
    signedInUserId = alice.id;
    const { GET } = await import("@/app/api/accounts/route");
    await GET(request("GET", "/api/accounts"));
    expectNoCanaries("GET /api/accounts");
  });

  it("logs no canary when a route throws", async () => {
    // The unhandled-route-error path logs the error object itself, which is
    // the single most likely place for a balance or a token to escape.
    signedInUserId = alice.id;
    const { log } = await import("@/lib/security/logger");
    log.error("Unhandled route error", {
      route: "/api/transactions",
      error: new Error(
        `failed writing ${CANARY.bankAccountName} balance ${CANARY.balanceCents} ` +
          `for ${CANARY.email} with ${CANARY.plaidToken}`,
      ),
      account: { name: CANARY.bankAccountName, currentBalance: CANARY.balanceCents },
      accessToken: CANARY.plaidToken,
    });
    expectNoCanaries("unhandled route error");
  });

  it("logs no canary when the AI call fails with the key in the message", async () => {
    signedInUserId = alice.id;
    const { POST } = await import("@/app/api/assistant/route");
    await POST(request("POST", "/api/assistant", { question: "how much did I spend?" }));
    expectNoCanaries("assistant AI failure");
  });

  it("logs no canary when a Plaid webhook is rejected", async () => {
    const { POST } = await import("@/app/api/plaid/webhook/route");
    await POST(
      request(
        "POST",
        "/api/plaid/webhook",
        { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "x" },
        { "plaid-verification": `bogus.${CANARY.plaidToken}.sig`, cookie: CANARY.authCookie },
      ),
    );
    expectNoCanaries("Plaid webhook rejection");
  });

  it("logs no canary when a sync fails", async () => {
    const { log } = await import("@/lib/security/logger");
    // Mirrors src/lib/sync.ts's failure log, with a Plaid client error whose
    // message carries the token, as the Plaid SDK's errors do.
    log.warn("Plaid sync failed", {
      itemId: alice.itemId,
      code: "ITEM_LOGIN_REQUIRED",
      error: new Error(`request failed: token=${CANARY.plaidToken}`),
    });
    expectNoCanaries("sync failure");
  });

  it("logs no canary from an auth failure or a reset token", async () => {
    const { log } = await import("@/lib/security/logger");
    log.warn("Auth API error", {
      error: new Error(`reset token ${CANARY.resetToken} rejected for ${CANARY.email}`),
      email: CANARY.email,
      cookie: CANARY.authCookie,
      token: CANARY.resetToken,
    });
    expectNoCanaries("auth failure");
  });

  it("logs no canary in a metric's tags", async () => {
    const { metric } = await import("@/lib/security/logger");
    metric("http.request", 1, {
      route: "/api/transactions",
      merchantName: CANARY.merchantName,
      email: CANARY.email,
    });
    expectNoCanaries("metric tags");
  });

  it("logs no canary when the audit trail records an event", async () => {
    const { recordAudit } = await import("@/lib/security/audit");
    await recordAudit({
      type: "account.updated",
      userId: alice.id,
      meta: {
        account: CANARY.bankAccountName,
        balance: CANARY.balanceCents,
        accessToken: CANARY.plaidToken,
      },
    });
    expectNoCanaries("audit record");
  });

  it("stores no canary in the audit table itself", async () => {
    // The audit trail is durable and widely readable; it is a log too.
    const rows = await prisma.auditEvent.findMany();
    const serialized = JSON.stringify(rows);
    const leaked = FORBIDDEN.filter(([, value]) => serialized.includes(value));
    expect(leaked.map(([label]) => label), "AuditEvent rows contain raw data").toEqual([]);
  });

  it("produced real log output, so the assertions were not vacuous", async () => {
    // Guards against the whole suite passing because nothing logged at all.
    const { log } = await import("@/lib/security/logger");
    log.error("canary suite self-check", { ok: true });
    expect(loggedOutput().length).toBeGreaterThan(0);
    expect(loggedOutput()).toContain("canary suite self-check");
  });
});
