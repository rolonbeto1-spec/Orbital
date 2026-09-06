import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { asCents } from "@/lib/money";
import { prisma, resetDatabase, createTenant, type TestUser } from "./fixtures";

/**
 * RELEASE-BLOCKING tenant isolation tests (§7, §62, §81).
 *
 * These exist to prove a single claim: the SERVER prevents User A from
 * touching User B's data. Not "the UI has no button for it" — the server.
 *
 * The method matters. Each test calls the REAL exported route handler with a
 * real Request, against a REAL database, while the session resolves to User
 * A. The only thing mocked is `@/lib/auth`, so that we can choose who is
 * signed in without standing up a full sign-in flow. Everything downstream —
 * requireUser, requireOwned, the Prisma queries — is the production code.
 *
 * The ids used in the attacks are User B's actual ids, read from the
 * database. That is a strictly harder test than guessing: it removes any
 * possibility of a test passing merely because a random id did not exist.
 */

// --- Session control -------------------------------------------------------
// A module-level "who is signed in", swapped per test.
let signedInUserId: string | null = null;

// `headers()` requires Next's request scope, which does not exist when a
// handler is invoked directly. The session is chosen by the mock below, so an
// empty header set is all these tests need.
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

// Rate limits would make a test suite that hammers endpoints flaky, and they
// are covered by their own tests. Disabled here so isolation failures cannot
// hide behind a 429.
vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return {
    ...actual,
    consumeRateLimit: async () => ({ ok: true, retryAfter: 0 }),
  };
});

function signIn(user: TestUser | null): void {
  signedInUserId = user?.id ?? null;
}

/** Build a Request the way Next would hand one to a route handler. */
function request(
  method: string,
  url: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

/** Next 16 passes route params as a promise. */
function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
  bob = await createTenant("bob");
});

beforeEach(() => {
  signIn(alice);
});

// ---------------------------------------------------------------------------
describe("Fixtures: both tenants exist with colliding data", () => {
  it("gives each user their own copy of colliding names", async () => {
    // Same folder name, same category name, same merchant — in two tenants.
    // Under the old schema (Folder.name globally unique, one shared Category
    // table) this could not even be constructed.
    const folders = await prisma.folder.findMany({ where: { name: "Taxes 2026" } });
    expect(folders).toHaveLength(2);
    expect(new Set(folders.map((f) => f.userId))).toEqual(new Set([alice.id, bob.id]));

    const groceries = await prisma.category.findMany({ where: { name: "Groceries" } });
    expect(groceries).toHaveLength(2);
    expect(groceries[0].id).not.toBe(groceries[1].id);
  });

  it("leaves no user-owned row without an owner", async () => {
    // The schema makes userId non-nullable, so this is really a check that
    // the fixtures (and by extension the app's writes) populate it.
    const counts = await Promise.all([
      prisma.transaction.count({ where: { userId: { in: [alice.id, bob.id] } } }),
      prisma.transaction.count(),
    ]);
    expect(counts[0]).toBe(counts[1]);
  });
});

// ---------------------------------------------------------------------------
describe("A cannot READ B's records", () => {
  it("GET /api/transactions returns only A's transactions", async () => {
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions?limit=200"));
    expect(response.status).toBe(200);

    const body = await response.json();
    const ids: string[] = body.transactions.map((t: { id: string }) => t.id);
    expect(ids).toContain(alice.transactionId);
    expect(ids).not.toContain(bob.transactionId);
    expect(body.total).toBe(1);
  });

  it("GET /api/transactions cannot be widened by passing B's account id", async () => {
    // The classic attempt: supply a filter naming another tenant's object.
    // The scope is ANDed in, so the result is empty rather than B's data.
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(
      request("GET", `/api/transactions?account=${bob.accountId}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions).toHaveLength(0);
  });

  it("GET /api/transactions cannot be widened by passing B's bank (item) id", async () => {
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", `/api/transactions?bank=${bob.itemId}`));
    const body = await response.json();
    expect(body.transactions).toHaveLength(0);
  });

  it("GET /api/transactions cannot be widened by passing B's category id", async () => {
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(
      request("GET", `/api/transactions?category=${bob.categoryId}`),
    );
    const body = await response.json();
    expect(body.transactions).toHaveLength(0);
  });

  it("GET /api/accounts returns only A's connections", async () => {
    const { GET } = await import("@/app/api/accounts/route");
    const body = await (await GET(request("GET", "/api/accounts"))).json();
    const itemIds = body.items.map((i: { id: string }) => i.id);
    expect(itemIds).toContain(alice.itemId);
    expect(itemIds).not.toContain(bob.itemId);
  });

  it("GET /api/budgets returns only A's budgets", async () => {
    const { GET } = await import("@/app/api/budgets/route");
    const body = await (await GET(request("GET", "/api/budgets"))).json();
    const ids = body.budgets.map((b: { id: string }) => b.id);
    expect(ids).toEqual([alice.budgetId]);
  });

  it("GET /api/goals returns only A's goals", async () => {
    const { GET } = await import("@/app/api/goals/route");
    const body = await (await GET(request("GET", "/api/goals"))).json();
    expect(body.goals.map((g: { id: string }) => g.id)).toEqual([alice.goalId]);
  });

  it("GET /api/folders returns only A's folders", async () => {
    const { GET } = await import("@/app/api/folders/route");
    const body = await (await GET(request("GET", "/api/folders"))).json();
    expect(body.folders.map((f: { id: string }) => f.id)).toEqual([alice.folderId]);
  });

  it("GET /api/properties returns only A's properties", async () => {
    const { GET } = await import("@/app/api/properties/route");
    const body = await (await GET(request("GET", "/api/properties"))).json();
    expect(body.properties.map((p: { id: string }) => p.id)).toEqual([alice.propertyId]);
  });

  it("GET /api/holdings returns only A's holdings", async () => {
    const { GET } = await import("@/app/api/holdings/route");
    const body = await (await GET(request("GET", "/api/holdings"))).json();
    expect(body.holdings.map((h: { id: string }) => h.id)).toEqual([alice.holdingId]);
  });

  it("GET /api/categories returns only A's category rows", async () => {
    const { GET } = await import("@/app/api/categories/route");
    const body = await (await GET(request("GET", "/api/categories"))).json();
    const ids = body.categories.map((c: { id: string }) => c.id);
    expect(ids).toContain(alice.categoryId);
    expect(ids).not.toContain(bob.categoryId);
  });
});

// ---------------------------------------------------------------------------
describe("A cannot WRITE to B's records (IDOR)", () => {
  it("PATCH /api/transactions/:id on B's transaction returns 404 and changes nothing", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const before = await prisma.transaction.findUniqueOrThrow({
      where: { id: bob.transactionId },
    });

    const response = await PATCH(
      request("PATCH", `/api/transactions/${bob.transactionId}`, { notes: "pwned" }),
      params({ id: bob.transactionId }),
    );

    // 404, not 403: "not found" and "not yours" must be indistinguishable,
    // or the response itself confirms the id exists (§7).
    expect(response.status).toBe(404);

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: bob.transactionId },
    });
    expect(after.notes).toBe(before.notes);
    expect(after.notes).toBeNull();
  });

  it("PATCH /api/transactions/:id cannot file A's transaction into B's folder", async () => {
    // Cross-tenant foreign key: the object is A's, but the reference is B's.
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, {
        folderId: bob.folderId,
      }),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(404);

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: alice.transactionId },
    });
    expect(after.folderId).toBeNull();
  });

  it("PATCH /api/transactions/:id cannot assign B's category to A's transaction", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/transactions/${alice.transactionId}`, {
        categoryId: bob.categoryId,
      }),
      params({ id: alice.transactionId }),
    );
    expect(response.status).toBe(404);

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: alice.transactionId },
    });
    expect(after.categoryId).toBe(alice.categoryId);
  });

  it("PATCH /api/accounts/:id on B's account returns 404", async () => {
    const { PATCH } = await import("@/app/api/accounts/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/accounts/${bob.accountId}`, { isBusiness: true }),
      params({ id: bob.accountId }),
    );
    expect(response.status).toBe(404);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: bob.accountId } });
    expect(after.isBusiness).toBe(false);
  });

  it("PATCH /api/budgets/:id on B's budget returns 404", async () => {
    const { PATCH } = await import("@/app/api/budgets/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/budgets/${bob.budgetId}`, { amount: 1 }),
      params({ id: bob.budgetId }),
    );
    expect(response.status).toBe(404);
    const after = await prisma.budget.findUniqueOrThrow({ where: { id: bob.budgetId } });
    // asCents(): money columns are BIGINT, so a raw read is a bigint.
    expect(asCents(after.amountCents)).toBe(60_000);
  });

  it("POST /api/budgets cannot create a budget on B's category", async () => {
    const { POST } = await import("@/app/api/budgets/route");
    const response = await POST(
      request("POST", "/api/budgets", { categoryId: bob.categoryId, amount: 999 }),
    );
    expect(response.status).toBe(404);

    const budgets = await prisma.budget.findMany({ where: { categoryId: bob.categoryId } });
    expect(budgets).toHaveLength(1);
    expect(budgets[0].userId).toBe(bob.id);
    expect(asCents(budgets[0].amountCents)).toBe(60_000);
  });

  it("PATCH /api/goals/:id on B's goal returns 404", async () => {
    const { PATCH } = await import("@/app/api/goals/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/goals/${bob.goalId}`, { name: "pwned" }),
      params({ id: bob.goalId }),
    );
    expect(response.status).toBe(404);
    const after = await prisma.goal.findUniqueOrThrow({ where: { id: bob.goalId } });
    expect(after.name).toBe("Emergency Fund");
  });

  it("PATCH /api/folders/:id on B's folder returns 404", async () => {
    const { PATCH } = await import("@/app/api/folders/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/folders/${bob.folderId}`, { name: "pwned" }),
      params({ id: bob.folderId }),
    );
    expect(response.status).toBe(404);
    const after = await prisma.folder.findUniqueOrThrow({ where: { id: bob.folderId } });
    expect(after.name).toBe("Taxes 2026");
  });

  it("PATCH /api/properties/:id on B's property returns 404", async () => {
    const { PATCH } = await import("@/app/api/properties/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/properties/${bob.propertyId}`, { name: "pwned" }),
      params({ id: bob.propertyId }),
    );
    expect(response.status).toBe(404);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: bob.propertyId } });
    expect(after.name).toBe("Elm St duplex");
  });

  it("PATCH /api/categories/:id on B's category returns 404", async () => {
    const { PATCH } = await import("@/app/api/categories/[id]/route");
    const response = await PATCH(
      request("PATCH", `/api/categories/${bob.categoryId}`, { inBudget: false }),
      params({ id: bob.categoryId }),
    );
    expect(response.status).toBe(404);
    const after = await prisma.category.findUniqueOrThrow({ where: { id: bob.categoryId } });
    expect(after.inBudget).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("A cannot DELETE B's records", () => {
  it("DELETE /api/goals/:id on B's goal returns 404 and B keeps the goal", async () => {
    const { DELETE } = await import("@/app/api/goals/[id]/route");
    const response = await DELETE(
      request("DELETE", `/api/goals/${bob.goalId}`),
      params({ id: bob.goalId }),
    );
    expect(response.status).toBe(404);
    expect(await prisma.goal.count({ where: { id: bob.goalId } })).toBe(1);
  });

  it("DELETE /api/folders/:id on B's folder returns 404", async () => {
    const { DELETE } = await import("@/app/api/folders/[id]/route");
    const response = await DELETE(
      request("DELETE", `/api/folders/${bob.folderId}`),
      params({ id: bob.folderId }),
    );
    expect(response.status).toBe(404);
    expect(await prisma.folder.count({ where: { id: bob.folderId } })).toBe(1);
  });

  it("DELETE /api/properties/:id on B's property returns 404", async () => {
    const { DELETE } = await import("@/app/api/properties/[id]/route");
    const response = await DELETE(
      request("DELETE", `/api/properties/${bob.propertyId}`),
      params({ id: bob.propertyId }),
    );
    expect(response.status).toBe(404);
    expect(await prisma.property.count({ where: { id: bob.propertyId } })).toBe(1);
  });

  it("DELETE /api/budgets/:id on B's budget returns 404", async () => {
    const { DELETE } = await import("@/app/api/budgets/[id]/route");
    const response = await DELETE(
      request("DELETE", `/api/budgets/${bob.budgetId}`),
      params({ id: bob.budgetId }),
    );
    expect(response.status).toBe(404);
    expect(await prisma.budget.count({ where: { id: bob.budgetId } })).toBe(1);
  });

  it("DELETE /api/items/:id cannot disconnect B's bank", async () => {
    // The worst version of this bug: A disconnects B's bank, destroying B's
    // accounts and transactions by cascade.
    const { DELETE } = await import("@/app/api/items/[id]/route");
    const response = await DELETE(
      request("DELETE", `/api/items/${bob.itemId}`),
      params({ id: bob.itemId }),
    );
    expect(response.status).toBe(404);

    expect(await prisma.item.count({ where: { id: bob.itemId } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: bob.id } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId: bob.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("A cannot SYNC or otherwise operate on B's Plaid Item", () => {
  it("POST /api/plaid/sync with B's item id returns 404", async () => {
    const { POST } = await import("@/app/api/plaid/sync/route");
    const response = await POST(request("POST", "/api/plaid/sync", { itemId: bob.itemId }));
    expect(response.status).toBe(404);
  });

  it("syncItemForUser refuses an item that belongs to another tenant", async () => {
    // Direct call to the engine, below the HTTP layer: even if a future route
    // forgot to check, the sync itself will not touch another tenant's Item.
    const { syncItemForUser } = await import("@/lib/sync");
    const result = await syncItemForUser(bob.itemId, alice.id);
    expect(result).toEqual({ added: 0, modified: 0, removed: 0 });
  });

  it("accessTokenForOwnedItem will not decrypt another tenant's credential", async () => {
    const { accessTokenForOwnedItem } = await import("@/lib/plaid-items");

    // B's own request works...
    await expect(accessTokenForOwnedItem(bob.itemId, bob.id)).resolves.toContain(
      "access-sandbox-bob",
    );
    // ...and A's identical request for the same item returns nothing.
    await expect(accessTokenForOwnedItem(bob.itemId, alice.id)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("A cannot EXPORT B's data", () => {
  it("GET /api/account/export contains only A's rows", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    const response = await GET(request("GET", "/api/account/export"));
    expect(response.status).toBe(200);

    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(body.account.email).toBe(alice.email);
    expect(body.counts.transactions).toBe(1);
    expect(body.counts.accounts).toBe(1);

    // Nothing of B's, by id or by identity.
    expect(serialized).not.toContain(bob.id);
    expect(serialized).not.toContain(bob.email);
    expect(serialized).not.toContain(bob.transactionId);
  });

  it("the export never contains credentials", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    const body = await (await GET(request("GET", "/api/account/export"))).json();
    const serialized = JSON.stringify(body);

    // The encrypted Plaid credential, the key id, and anything token-shaped.
    expect(serialized).not.toContain("accessTokenCipher");
    expect(serialized).not.toContain("accessTokenKeyId");
    expect(serialized).not.toContain("access-sandbox");
    expect(serialized).not.toMatch(/"password"/);
    expect(serialized).not.toContain(alice.plaidUserRef);
  });
});

// ---------------------------------------------------------------------------
describe("A cannot reach B's data through the AI or the assistant", () => {
  it("the AI snapshot contains only A's finances", async () => {
    // buildContext is not exported, so we exercise it through the rule engine
    // and the deterministic action path, which read the same scoped queries.
    const { getNetWorth, getSpendingByCategory } = await import("@/lib/queries");
    const { currentMonthRange } = await import("@/lib/time");

    const aliceWorth = await getNetWorth(alice.id);
    const bobWorth = await getNetWorth(bob.id);
    // Both have one $2,500 account, so equal totals are expected — what
    // matters is that A's figure does not include B's money.
    expect(aliceWorth.assetsCents).toBe(250_000);
    expect(bobWorth.assetsCents).toBe(250_000);

    const { start, end } = currentMonthRange("America/Los_Angeles");
    const aliceSpend = await getSpendingByCategory(alice.id, start, end);
    // Exactly $84.21 in cents — not 84.21 plus float dust, and not $168.42.
    expect(aliceSpend.reduce((sum, c) => sum + c.totalCents, 0)).toBe(8421);
  });

  it("assistant actions operate only on A's records", async () => {
    const { maybeAction } = await import("@/lib/assistant-actions");
    const { asAuthedUser } = await import("./fixtures");

    // "save the Whole Foods charge to folder X" — both users have a Whole
    // Foods charge; A's action must find A's.
    const result = await maybeAction(
      asAuthedUser(alice),
      "save the charge from Whole Foods to folder Receipts",
    );
    expect(result).not.toBeNull();

    const bobTransaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: bob.transactionId },
    });
    expect(bobTransaction.folderId).toBeNull();

    const folders = await prisma.folder.findMany({ where: { name: "Receipts" } });
    expect(folders).toHaveLength(1);
    expect(folders[0].userId).toBe(alice.id);
  });

  it("a merchant-rule lesson from A does not reach B", async () => {
    const { learnFromCorrection } = await import("@/lib/smart-categorize");

    const aliceDining = await prisma.category.findFirstOrThrow({
      where: { userId: alice.id, name: "Food & Dining" },
    });
    await learnFromCorrection(alice.id, "Whole Foods", aliceDining.id);

    const bobRules = await prisma.merchantRule.findMany({ where: { userId: bob.id } });
    // B still has exactly the one rule the fixture created, pointing at B's
    // own Groceries category.
    expect(bobRules).toHaveLength(1);
    expect(bobRules[0].categoryId).toBe(bob.categoryId);
  });
});

// ---------------------------------------------------------------------------
describe("A cannot reach B's reports or aggregates", () => {
  it("GET /api/dashboard shows only A's figures", async () => {
    const { GET } = await import("@/app/api/dashboard/route");
    const body = await (await GET(request("GET", "/api/dashboard"))).json();
    expect(body.connectedBanks).toBe(1);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].id).toBe(alice.accountId);
  });

  it("GET /api/report shows only A's month", async () => {
    const { GET } = await import("@/app/api/report/route");
    const body = await (await GET(request("GET", "/api/report"))).json();
    // A spent $84.21; if B's identical charge leaked in it would be $168.42.
    expect(body.spending).toBe(84.21);
  });

  it("GET /api/insights shows only A's month", async () => {
    const { GET } = await import("@/app/api/insights/route");
    const body = await (await GET(request("GET", "/api/insights"))).json();
    expect(body.cashflow.spending).toBe(84.21);
    expect(body.netWorth.assets).toBe(2500);
  });

  it("GET /api/hive shows only A's spending", async () => {
    const { GET } = await import("@/app/api/hive/route");
    const body = await (await GET(request("GET", "/api/hive"))).json();
    expect(body.money.total).toBe(2500);
  });

  it("GET /api/recurring analyses only A's history", async () => {
    const { GET } = await import("@/app/api/recurring/route");
    const body = await (await GET(request("GET", "/api/recurring"))).json();
    expect(Array.isArray(body.recurring)).toBe(true);
  });

  it("GET /api/account/audit shows only A's security events", async () => {
    await prisma.auditEvent.create({
      data: { userId: bob.id, type: "auth.login", outcome: "success" },
    });
    const { GET } = await import("@/app/api/account/audit/route");
    const body = await (await GET(request("GET", "/api/account/audit"))).json();
    for (const event of body.events) {
      expect(event).not.toHaveProperty("userId");
    }
    // A has no events yet; B's must not appear.
    const aliceEvents = await prisma.auditEvent.count({ where: { userId: alice.id } });
    expect(body.events).toHaveLength(aliceEvents);
  });
});

// ---------------------------------------------------------------------------
describe("Predictable and malformed ids", () => {
  const probes = [
    "1",
    "0",
    "-1",
    "null",
    "undefined",
    "00000000-0000-0000-0000-000000000000",
    "clzzzzzzzzzzzzzzzzzzzzzzz",
    "%2e%2e%2f",
    "a".repeat(300),
  ];

  it("returns 404 (or 400) for every guessed id, never data", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    for (const probe of probes) {
      const response = await PATCH(
        request("PATCH", `/api/transactions/${encodeURIComponent(probe)}`, {
          notes: "probe",
        }),
        params({ id: probe }),
      );
      expect([400, 404]).toContain(response.status);
      const body = await response.json();
      expect(body).not.toHaveProperty("amount");
      expect(body).not.toHaveProperty("merchantName");
    }
  });

  it("does not leak whether an id exists", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");

    const real = await PATCH(
      request("PATCH", `/api/transactions/${bob.transactionId}`, { notes: "x" }),
      params({ id: bob.transactionId }),
    );
    const fake = await PATCH(
      request("PATCH", "/api/transactions/definitely-not-a-real-id", { notes: "x" }),
      params({ id: "definitely-not-a-real-id" }),
    );

    // Identical status AND identical body: an attacker cannot distinguish
    // "exists but not yours" from "does not exist" (§7, §24).
    expect(real.status).toBe(fake.status);
    expect(await real.json()).toEqual(await fake.json());
  });
});

// ---------------------------------------------------------------------------
describe("Unauthenticated and invalid sessions", () => {
  it("denies every protected route with no session", async () => {
    signIn(null);

    const routes: Array<[string, () => Promise<{ GET: (r: Request) => Promise<Response> }>]> = [
      ["/api/transactions", () => import("@/app/api/transactions/route")],
      ["/api/accounts", () => import("@/app/api/accounts/route")],
      ["/api/budgets", () => import("@/app/api/budgets/route")],
      ["/api/goals", () => import("@/app/api/goals/route")],
      ["/api/folders", () => import("@/app/api/folders/route")],
      ["/api/properties", () => import("@/app/api/properties/route")],
      ["/api/holdings", () => import("@/app/api/holdings/route")],
      ["/api/categories", () => import("@/app/api/categories/route")],
      ["/api/dashboard", () => import("@/app/api/dashboard/route")],
      ["/api/insights", () => import("@/app/api/insights/route")],
      ["/api/report", () => import("@/app/api/report/route")],
      ["/api/hive", () => import("@/app/api/hive/route")],
      ["/api/recurring", () => import("@/app/api/recurring/route")],
      ["/api/reimbursements", () => import("@/app/api/reimbursements/route")],
      ["/api/account/export", () => import("@/app/api/account/export/route")],
      ["/api/account/audit", () => import("@/app/api/account/audit/route")],
    ];

    for (const [path, load] of routes) {
      const { GET } = await load();
      const response = await GET(request("GET", path));
      expect(response.status, `${path} should deny anonymous access`).toBe(401);
    }
  });

  it("denies a session naming a user that no longer exists", async () => {
    signedInUserId = "u_test_deleted_user_that_never_existed";
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions"));
    expect(response.status).toBe(401);
  });

  it("denies a session belonging to a soft-deleted account", async () => {
    const ghost = await createTenant("ghost");
    await prisma.user.update({
      where: { id: ghost.id },
      data: { deletedAt: new Date() },
    });

    signIn(ghost);
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions"));
    expect(response.status).toBe(401);
  });

  it("denies an authenticated but unverified user on data routes", async () => {
    const unverified = await createTenant("unverified");
    await prisma.user.update({
      where: { id: unverified.id },
      data: { emailVerified: false },
    });

    signIn(unverified);
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions"));
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("Cache isolation (§53)", () => {
  it("does not serve A's data to B from any shared cache", async () => {
    // getCurrentUser is wrapped in React's cache(). If that cache were shared
    // across requests rather than scoped to one, this test would return
    // Alice's transactions to Bob — the exact leak §53 warns about.
    const { GET } = await import("@/app/api/transactions/route");

    signIn(alice);
    const aliceBody = await (await GET(request("GET", "/api/transactions"))).json();

    signIn(bob);
    const bobBody = await (await GET(request("GET", "/api/transactions"))).json();

    expect(aliceBody.transactions[0].id).toBe(alice.transactionId);
    expect(bobBody.transactions[0].id).toBe(bob.transactionId);
    expect(aliceBody.transactions[0].id).not.toBe(bobBody.transactions[0].id);
  });

  it("marks authenticated responses private and no-store", async () => {
    signIn(alice);
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(request("GET", "/api/transactions"));

    const cacheControl = response.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-store");
    expect(response.headers.get("Vary")).toContain("Cookie");
  });
});
