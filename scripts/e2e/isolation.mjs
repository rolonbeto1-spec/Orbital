/**
 * Two real accounts, each with their own linked bank, attacking each other.
 *
 * Unlike the unit-level isolation tests, this runs against the live server
 * over HTTP with real sessions and real synced Plaid data, so it exercises
 * the proxy, the route wrapper, the session lookup and the queries together.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = "correct-horse-battery-staple-1";

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASS }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return cookie;
}

const call = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, "content-type": "application/json", origin: BASE, ...(init.headers ?? {}) },
  });

const json = async (cookie, path) => {
  const r = await call(cookie, path);
  return r.ok ? r.json() : { __status: r.status };
};

let pass = 0;
let fail = 0;
function check(ok, label, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? " -> " + detail : ""}`);
  }
}

const alice = await signIn("alice@example.test");
const bob = await signIn("bob@example.test");

// ---- what each user legitimately has -------------------------------------
const aAcc = await json(alice, "/api/accounts");
const bAcc = await json(bob, "/api/accounts");
const aTx = await json(alice, "/api/transactions?limit=200");
const bTx = await json(bob, "/api/transactions?limit=200");

console.log("\n== each user sees their own bank ==");
const aBanks = (aAcc.items ?? []).map((i) => i.institutionName);
const bBanks = (bAcc.items ?? []).map((i) => i.institutionName);
console.log(`  alice: ${aBanks.join(", ")} | ${aTx.total} transactions | net ${aAcc.netWorth}`);
console.log(`  bob:   ${bBanks.join(", ")} | ${bTx.total} transactions | net ${bAcc.netWorth}`);
check(aBanks.length > 0 && bBanks.length > 0, "both users have a linked bank");
check(
  aBanks.every((n) => !bBanks.includes(n)),
  "the two users' banks are different institutions",
  `${aBanks} vs ${bBanks}`,
);
check(aAcc.netWorth !== bAcc.netWorth, "their totals differ");

// ---- no overlap in any identifier ----------------------------------------
console.log("\n== no shared rows ==");
const aTxIds = new Set((aTx.transactions ?? []).map((t) => t.id));
const bTxIds = new Set((bTx.transactions ?? []).map((t) => t.id));
check([...aTxIds].every((id) => !bTxIds.has(id)), "no transaction id appears in both accounts");
const aAccIds = new Set((aAcc.accounts ?? []).map((a) => a.id));
const bAccIds = new Set((bAcc.accounts ?? []).map((a) => a.id));
check([...aAccIds].every((id) => !bAccIds.has(id)), "no account id appears in both accounts");

// ---- direct object access across tenants ---------------------------------
console.log("\n== alice reaching for bob's objects ==");
const bobTxId = [...bTxIds][0];
const bobAccId = [...bAccIds][0];
const bobItemId = (bAcc.items ?? [])[0]?.id;

for (const [label, path, init] of [
  // No GET on a single transaction by design, so 405 is also a refusal.
  ["GET bob's transaction", `/api/transactions/${bobTxId}`, {}],
  ["PATCH bob's transaction", `/api/transactions/${bobTxId}`, { method: "PATCH", body: JSON.stringify({ notes: "pwned" }) }],
  ["PATCH bob's account", `/api/accounts/${bobAccId}`, { method: "PATCH", body: JSON.stringify({ isBusiness: true }) }],
  ["DELETE bob's bank", `/api/items/${bobItemId}`, { method: "DELETE" }],
]) {
  const r = await call(alice, path, init);
  check([403, 404, 405].includes(r.status), `${label} is refused (got ${r.status})`);
}

// ---- sync must not touch another tenant's item ---------------------------
const syncOther = await call(alice, "/api/plaid/sync", {
  method: "POST",
  body: JSON.stringify({ itemId: bobItemId }),
});
check([403, 404, 400].includes(syncOther.status), `syncing bob's bank as alice is refused (got ${syncOther.status})`);

// ---- collection endpoints must never carry the other tenant's data -------
console.log("\n== collection endpoints leak nothing ==");
const bobMarkers = [...bBanks, ...(bTx.transactions ?? []).slice(0, 10).map((t) => t.name)].filter(Boolean);
for (const path of [
  "/api/dashboard", "/api/hive", "/api/insights", "/api/report", "/api/recurring",
  "/api/reimbursements", "/api/nudges", "/api/questions", "/api/digest",
  "/api/budget-overview", "/api/business", "/api/holdings", "/api/account/export",
]) {
  const body = JSON.stringify(await json(alice, path));
  const leaked = bobMarkers.filter((m) => body.includes(m));
  check(leaked.length === 0, `${path} contains nothing of bob's`, leaked.slice(0, 3).join(", "));
}

// ---- bob's data must survive alice's attempts ----------------------------
console.log("\n== bob is untouched ==");
const bAfter = await json(bob, "/api/accounts");
const bTxAfter = await json(bob, "/api/transactions?limit=200");
check(bAfter.netWorth === bAcc.netWorth, "bob's net worth unchanged");
check(bTxAfter.total === bTx.total, "bob's transaction count unchanged");
check(
  (bAfter.items ?? []).length === (bAcc.items ?? []).length,
  "bob still has all his banks",
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
