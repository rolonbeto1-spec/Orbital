/**
 * Exercise every feature the way the app does: create, read back, edit,
 * delete. A feature that returns 200 but does not persist is still broken, so
 * each step verifies the effect rather than the status code alone.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = "correct-horse-battery-staple-1";

let pass = 0;
let fail = 0;
const broken = [];
function check(ok, label, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    broken.push(`${label}${detail ? " — " + detail : ""}`);
    console.log(`  FAIL ${label}${detail ? " -> " + detail : ""}`);
  }
}

const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ email: "bob@example.test", password: PASS }),
});
const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const api = async (method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json", origin: BASE },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
};

const stamp = Date.now();

// ------------------------------------------------------------------ goals ----
console.log("\n== goals ==");
{
  const created = await api("POST", "/api/goals", { name: `Trip ${stamp}`, targetAmount: 5000 });
  check(created.status === 200, `create a goal (${created.status})`, JSON.stringify(created.json)?.slice(0, 120));
  const list = await api("GET", "/api/goals");
  const mine = (list.json?.goals ?? []).find((g) => g.name === `Trip ${stamp}`);
  check(Boolean(mine), "the goal comes back in the list");
  if (mine) {
    check(mine.targetAmount === 5000, `target stored as dollars (${mine.targetAmount})`);
    const patched = await api("PATCH", `/api/goals/${mine.id}`, { currentAmount: 1200 });
    check(patched.status === 200, `update the goal (${patched.status})`);
    const after = await api("GET", "/api/goals");
    const upd = (after.json?.goals ?? []).find((g) => g.id === mine.id);
    check(upd?.currentAmount === 1200, `the update persisted (${upd?.currentAmount})`);
    const removed = await api("DELETE", `/api/goals/${mine.id}`);
    check(removed.status === 200, `delete the goal (${removed.status})`);
    const gone = await api("GET", "/api/goals");
    check(!(gone.json?.goals ?? []).some((g) => g.id === mine.id), "the goal is gone");
  }
}

// ---------------------------------------------------------------- folders ----
console.log("\n== folders ==");
let folderId = null;
{
  const created = await api("POST", "/api/folders", { name: `Receipts ${stamp}` });
  check(created.status === 200, `create a folder (${created.status})`, JSON.stringify(created.json)?.slice(0, 120));
  const list = await api("GET", "/api/folders");
  const mine = (list.json?.folders ?? []).find((f) => f.name === `Receipts ${stamp}`);
  folderId = mine?.id ?? null;
  check(Boolean(folderId), "the folder comes back in the list");
}

// ----------------------------------------------------------- transactions ----
console.log("\n== transactions ==");
{
  const list = await api("GET", "/api/transactions?limit=5");
  const tx = list.json?.transactions?.[0];
  check(Boolean(tx), `transactions load (${list.json?.total} total)`);
  if (tx) {
    const cats = await api("GET", "/api/categories");
    const target = (cats.json?.categories ?? []).find((c) => c.name === "Transportation");

    const patched = await api("PATCH", `/api/transactions/${tx.id}`, {
      notes: `note-${stamp}`,
      owedBack: true,
      ...(target ? { categoryId: target.id } : {}),
      ...(folderId ? { folderId } : {}),
    });
    check(patched.status === 200, `edit a transaction (${patched.status})`, JSON.stringify(patched.json)?.slice(0, 140));

    const after = await api("GET", "/api/transactions?limit=200");
    const upd = (after.json?.transactions ?? []).find((t) => t.id === tx.id);
    check(upd?.notes === `note-${stamp}`, `the note persisted (${upd?.notes})`);
    check(upd?.owedBack === true, "owed-back persisted");
    if (target) check(upd?.category?.name === "Transportation", `recategorised (${upd?.category?.name})`);

    // Search must find it by the note.
    const searched = await api("GET", `/api/transactions?search=${encodeURIComponent(`note-${stamp}`)}`);
    check((searched.json?.transactions ?? []).some((t) => t.id === tx.id), "search finds it by note");

    // Reimbursements should now see an outstanding item.
    const reimb = await api("GET", "/api/reimbursements");
    check(typeof reimb.json?.totalOwed === "number", `reimbursements report dollars (${reimb.json?.totalOwed})`);
  }
}

// ---------------------------------------------------------------- budgets ----
console.log("\n== budgets ==");
{
  const cats = await api("GET", "/api/categories");
  const cat = (cats.json?.categories ?? []).find((c) => c.group === "expense");
  const created = await api("POST", "/api/budgets", { categoryId: cat.id, amount: 400 });
  check(created.status === 200, `set a budget (${created.status})`, JSON.stringify(created.json)?.slice(0, 120));
  const overview = await api("GET", "/api/budget-overview");
  const all = [...(overview.json?.inBudget ?? []), ...(overview.json?.outOfBudget ?? [])];
  const row = all.find((r) => r.categoryId === cat.id);
  check(row?.limit === 400, `the budget shows on the overview (${row?.limit})`);
  check(typeof overview.json?.totals?.limit === "number", "totals are present for the screen");
}

// ------------------------------------------------------------- properties ----
console.log("\n== properties ==");
{
  const created = await api("POST", "/api/properties", {
    name: `Maple St ${stamp}`,
    rentIncome: 2200,
    mortgage: 1450,
    utilities: 180,
    hoa: 95,
  });
  check(created.status === 200, `create a property (${created.status})`, JSON.stringify(created.json)?.slice(0, 140));
  const list = await api("GET", "/api/properties");
  const mine = (list.json?.properties ?? []).find((p) => p.name === `Maple St ${stamp}`);
  check(Boolean(mine), "the property comes back");
  if (mine) {
    check(mine.rentIncome === 2200, `rent stored as dollars (${mine.rentIncome})`);
    const removed = await api("DELETE", `/api/properties/${mine.id}`);
    check(removed.status === 200, `delete the property (${removed.status})`);
  }
}

// ------------------------------------------------------------- categories ----
console.log("\n== categories ==");
{
  const cats = await api("GET", "/api/categories");
  const cat = (cats.json?.categories ?? [])[0];
  const patched = await api("PATCH", `/api/categories/${cat.id}`, { inBudget: !cat.inBudget });
  check(patched.status === 200, `toggle a category in/out of budget (${patched.status})`);
  const after = await api("GET", "/api/categories");
  const upd = (after.json?.categories ?? []).find((c) => c.id === cat.id);
  check(upd?.inBudget === !cat.inBudget, "the toggle persisted");
}

// -------------------------------------------------------------- assistant ----
console.log("\n== assistant ==");
{
  const asked = await api("POST", "/api/assistant", { question: "how much did I spend this month?" });
  check(asked.status === 200, `the assistant answers (${asked.status})`, JSON.stringify(asked.json)?.slice(0, 140));
  check(typeof asked.json?.answer === "string" && asked.json.answer.length > 0, "the answer is non-empty text");
  check(!/<script|<img|onerror=/i.test(asked.json?.answer ?? ""), "the answer carries no markup");
}

// ------------------------------------------------------------ derived views ----
console.log("\n== derived views ==");
for (const [path, key] of [
  ["/api/dashboard", "netWorth"],
  ["/api/hive", "branches"],
  ["/api/insights", "cashflow"],
  ["/api/report", "spending"],
  ["/api/digest", "spending"],
  ["/api/nudges", "nudges"],
  ["/api/questions", "questions"],
  ["/api/business", "accounts"],
  ["/api/holdings", "holdings"],
  ["/api/account/profile", "email"],
  ["/api/account/audit", "events"],
  ["/api/account/export", "transactions"],
]) {
  const r = await api("GET", path);
  check(r.status === 200 && r.json && key in r.json, `${path} returns ${key} (${r.status})`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (broken.length) {
  console.log("\nBROKEN:");
  broken.forEach((b) => console.log(`  - ${b}`));
}
process.exit(fail ? 1 : 0);
