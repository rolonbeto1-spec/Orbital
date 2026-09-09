/**
 * A stand-in for the Plaid API.
 *
 * This machine has no route to Plaid (the network policy answers 403 to
 * CONNECT for plaid.com), so the only way to exercise the real link ->
 * exchange -> sync code path is to answer it locally. Responses follow the
 * shapes plaid-node expects for the eight endpoints the application calls.
 *
 * Each linked Item gets its own institution and its own transactions, so two
 * users linking "a bank" end up with genuinely different data — which is what
 * makes it useful for the isolation checks.
 *
 * Run: node plaid-mock.mjs [port]
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.argv[2] ?? 4599);

/** Distinct fake institutions, handed out per link so tenants differ. */
const INSTITUTIONS = [
  { id: "ins_mock_1", name: "Northwind Savings" },
  { id: "ins_mock_2", name: "Cascadia Credit Union" },
  { id: "ins_mock_3", name: "Meridian Bank" },
];

const MERCHANTS = [
  ["WHOLE FOODS MARKET", "Whole Foods", 84.21],
  ["NETFLIX.COM", "Netflix", 15.49],
  ["SHELL OIL 573", "Shell", 52.3],
  ["STARBUCKS STORE 118", "Starbucks", 6.75],
  ["UBER TRIP", "Uber", 23.4],
  ["TRADER JOES #451", "Trader Joe's", 61.08],
  ["RENT PAYMENT", "Landlord", 1850.0],
  ["ACME PAYROLL", "Acme Corp", -3200.0],
  ["AMAZON MKTPLACE", "Amazon", 37.99],
  ["CHIPOTLE 2244", "Chipotle", 14.85],
];

/** access_token -> the world behind it. */
const items = new Map();
let linkCounter = 0;

function makeItem() {
  const n = linkCounter++;
  const inst = INSTITUTIONS[n % INSTITUTIONS.length];
  const itemId = `item_mock_${n}_${randomUUID().slice(0, 8)}`;
  const suffix = String(1000 + n);

  const accounts = [
    {
      account_id: `acc_${itemId}_chk`,
      name: `${inst.name} Checking`,
      official_name: `${inst.name} Everyday Checking`,
      mask: suffix.slice(-4),
      type: "depository",
      subtype: "checking",
      balances: {
        current: 4210.55 + n * 137.4,
        available: 4100.55 + n * 137.4,
        iso_currency_code: "USD",
      },
    },
    {
      account_id: `acc_${itemId}_sav`,
      name: `${inst.name} Savings`,
      official_name: null,
      mask: String(2000 + n).slice(-4),
      type: "depository",
      subtype: "savings",
      balances: { current: 15250.0 + n * 900, available: 15250.0 + n * 900, iso_currency_code: "USD" },
    },
    {
      account_id: `acc_${itemId}_cc`,
      name: `${inst.name} Rewards Card`,
      official_name: null,
      mask: String(3000 + n).slice(-4),
      type: "credit",
      subtype: "credit card",
      // Plaid reports a credit balance as the amount OWED, positive.
      balances: { current: 1234.56 + n * 44.1, available: null, iso_currency_code: "USD" },
    },
  ];

  const today = new Date();
  const added = [];
  for (let i = 0; i < 40; i++) {
    const [name, merchant, base] = MERCHANTS[i % MERCHANTS.length];
    const date = new Date(today.getTime() - i * 36e5 * 20);
    const amount = Number((base * (1 + ((i % 5) - 2) * 0.07)).toFixed(2));
    added.push({
      transaction_id: `txn_${itemId}_${i}`,
      account_id: accounts[i % 2 === 0 ? 0 : 2].account_id,
      amount, // Plaid: positive = money out
      date: date.toISOString().slice(0, 10),
      authorized_date: date.toISOString().slice(0, 10),
      name: `${name} #${n}`,
      merchant_name: merchant,
      pending: i < 2,
      iso_currency_code: "USD",
      personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" },
      logo_url: null,
      website: null,
    });
  }

  return { itemId, inst, accounts, added };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error_code: "INVALID_INPUT", error_message: "bad json" });
    }

    const path = req.url.split("?")[0];
    const request_id = randomUUID().slice(0, 12);
    console.log(`  plaid-mock ${req.method} ${path}`);

    switch (path) {
      case "/link/token/create":
        return send(res, 200, {
          link_token: `link-sandbox-${randomUUID()}`,
          expiration: new Date(Date.now() + 30 * 60000).toISOString(),
          request_id,
        });

      case "/item/public_token/exchange": {
        const world = makeItem();
        const access_token = `access-sandbox-${randomUUID()}`;
        items.set(access_token, { ...world, cursorAt: 0 });
        return send(res, 200, { access_token, item_id: world.itemId, request_id });
      }

      case "/accounts/get": {
        const w = items.get(body.access_token);
        if (!w) return send(res, 400, { error_code: "INVALID_ACCESS_TOKEN", error_message: "unknown token", request_id });
        return send(res, 200, {
          accounts: w.accounts,
          item: { item_id: w.itemId, institution_id: w.inst.id, error: null },
          request_id,
        });
      }

      case "/item/get": {
        const w = items.get(body.access_token);
        if (!w) return send(res, 400, { error_code: "INVALID_ACCESS_TOKEN", error_message: "unknown token", request_id });
        return send(res, 200, {
          item: {
            item_id: w.itemId,
            institution_id: w.inst.id,
            webhook: null,
            error: null,
            available_products: ["transactions"],
            billed_products: ["transactions"],
          },
          request_id,
        });
      }

      case "/institutions/get_by_id": {
        const inst = INSTITUTIONS.find((i) => i.id === body.institution_id) ?? INSTITUTIONS[0];
        return send(res, 200, {
          institution: { institution_id: inst.id, name: inst.name, products: ["transactions"], country_codes: ["US"] },
          request_id,
        });
      }

      case "/transactions/sync": {
        const w = items.get(body.access_token);
        if (!w) return send(res, 400, { error_code: "INVALID_ACCESS_TOKEN", error_message: "unknown token", request_id });
        // One page, then done — the cursor makes a second call a no-op, which
        // is what lets the "sync twice, no duplicates" check mean something.
        const first = !body.cursor;
        return send(res, 200, {
          added: first ? w.added : [],
          modified: [],
          removed: [],
          next_cursor: `cursor_${w.itemId}_1`,
          has_more: false,
          accounts: w.accounts,
          request_id,
        });
      }

      case "/item/remove": {
        items.delete(body.access_token);
        return send(res, 200, { request_id });
      }

      case "/webhook_verification_key/get":
        return send(res, 400, {
          error_code: "INVALID_INPUT",
          error_message: "mock does not sign webhooks",
          request_id,
        });

      default:
        return send(res, 404, { error_code: "NOT_FOUND", error_message: path, request_id });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`plaid-mock listening on http://127.0.0.1:${PORT}`));
