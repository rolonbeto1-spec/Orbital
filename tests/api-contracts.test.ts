import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { prisma, resetDatabase, createTenant, type TestUser } from "./fixtures";

/**
 * The response an endpoint returns must contain the fields the screen reads.
 *
 * This suite exists because that was not true four separate times, and none
 * of the failures was visible to the compiler. Screens fetch through
 * `useApi<T>(url)`, which ASSERTS a type rather than checking one — so when a
 * route's shape drifted from the page's declaration, TypeScript stayed happy
 * and the browser showed "$NaN", a blank screen, or nothing at all:
 *
 *   * /api/accounts returned `{ items }` while the Accounts screen read
 *     `netWorth`, `assets` and `liabilities` — three "$NaN"s at the top of
 *     the page.
 *   * /api/budget-overview returned `{ inBudget, outOfBudget, totals }` while
 *     the Budgets screen destructured `{ wants, fixed }` — a crash to a blank
 *     page on every visit.
 *   * /api/reimbursements returned `totalOwedCents` while the banner read
 *     `totalOwed` — the "you are owed" card never rendered.
 *   * /api/recurring returned `amountCents` and no `monthlyTotal` at all,
 *     while the panel rendered both.
 *
 * Each case below names the screen that consumes the endpoint, so a future
 * change to either side has to come here and decide deliberately.
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

function request(method: string, url: string): Request {
  return new Request(`http://localhost:3000${url}`, { method });
}

let alice: TestUser;

beforeAll(async () => {
  await resetDatabase();
  alice = await createTenant("alice");
});

beforeEach(async () => {
  signedInUserId = alice.id;
  await prisma.rateLimitCounter.deleteMany();
});

/** Every key a screen reads from the top level of a response. */
const CONTRACTS: Array<{
  endpoint: string;
  screen: string;
  load: () => Promise<{ GET: (r: Request) => Promise<Response> }>;
  requires: string[];
}> = [
  {
    endpoint: "/api/accounts",
    screen: "src/app/(app)/accounts/page.tsx",
    load: () => import("@/app/api/accounts/route") as never,
    requires: ["items", "accounts", "netWorth", "assets", "liabilities", "plaidConfigured"],
  },
  {
    endpoint: "/api/budget-overview",
    screen: "src/app/(app)/budgets/page.tsx",
    load: () => import("@/app/api/budget-overview/route") as never,
    requires: ["inBudget", "outOfBudget", "totals", "month"],
  },
  {
    endpoint: "/api/reimbursements",
    screen: "src/components/ReimbursementsBanner.tsx",
    load: () => import("@/app/api/reimbursements/route") as never,
    requires: ["totalOwed", "outstanding", "possibleRepayments"],
  },
  {
    endpoint: "/api/recurring",
    screen: "src/components/RecurringPanel.tsx",
    load: () => import("@/app/api/recurring/route") as never,
    requires: ["recurring", "monthlyTotal"],
  },
  {
    endpoint: "/api/alert-prefs",
    screen: "src/app/(app)/budgets/page.tsx (RemindersCard)",
    load: () => import("@/app/api/alert-prefs/route") as never,
    requires: ["half", "full", "weekly"],
  },
  {
    endpoint: "/api/assistant",
    screen: "src/app/(app)/chat/page.tsx",
    load: () => import("@/app/api/assistant/route") as never,
    requires: ["llm"],
  },
];

describe("Endpoints return what their screens read", () => {
  for (const contract of CONTRACTS) {
    it(`${contract.endpoint} satisfies ${contract.screen}`, async () => {
      const mod = await contract.load();
      const response = await mod.GET(request("GET", contract.endpoint));
      expect(response.status, `${contract.endpoint} did not answer 200`).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      const missing = contract.requires.filter((key) => !(key in body));
      expect(
        missing,
        `${contract.endpoint} is missing ${missing.join(", ")} — ${contract.screen} reads it`,
      ).toEqual([]);
    });
  }
});

describe("No endpoint hands the browser raw cents", () => {
  // `serializeMoneyFields` renames `amountCents` to `amount` and divides by
  // 100. A response still carrying a `*Cents` key means a screen somewhere is
  // reading the dollar name and getting undefined, which formats as "$NaN".
  const MONEY_ENDPOINTS: Array<[string, () => Promise<{ GET: (r: Request) => Promise<Response> }>]> = [
    ["/api/accounts", () => import("@/app/api/accounts/route") as never],
    ["/api/dashboard", () => import("@/app/api/dashboard/route") as never],
    ["/api/hive", () => import("@/app/api/hive/route") as never],
    ["/api/transactions", () => import("@/app/api/transactions/route") as never],
    ["/api/budget-overview", () => import("@/app/api/budget-overview/route") as never],
    ["/api/insights", () => import("@/app/api/insights/route") as never],
    ["/api/reimbursements", () => import("@/app/api/reimbursements/route") as never],
    ["/api/recurring", () => import("@/app/api/recurring/route") as never],
    ["/api/goals", () => import("@/app/api/goals/route") as never],
    ["/api/properties", () => import("@/app/api/properties/route") as never],
    ["/api/holdings", () => import("@/app/api/holdings/route") as never],
    ["/api/budgets", () => import("@/app/api/budgets/route") as never],
  ];

  function centsKeys(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      value.forEach((v) => centsKeys(v, found));
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (/Cents$/.test(key)) found.add(key);
        centsKeys(inner, found);
      }
    }
    return found;
  }

  for (const [endpoint, load] of MONEY_ENDPOINTS) {
    it(`${endpoint} emits dollars, not cents`, async () => {
      const mod = await load();
      const response = await mod.GET(request("GET", endpoint));
      expect(response.status).toBe(200);
      const leaked = [...centsKeys(await response.json())];
      expect(leaked, `${endpoint} still returns ${leaked.join(", ")}`).toEqual([]);
    });
  }
});
