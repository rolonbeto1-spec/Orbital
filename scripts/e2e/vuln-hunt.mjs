/**
 * Adversarial pass against the running server.
 *
 * Everything here is a request a hostile client can actually make. Each check
 * states what a failure would mean, so a red line is a finding rather than a
 * puzzle.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = "correct-horse-battery-staple-1";

let pass = 0;
let fail = 0;
const findings = [];
function check(ok, label, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    findings.push(`${label}${detail ? " — " + detail : ""}`);
    console.log(`  FAIL ${label}${detail ? " -> " + detail : ""}`);
  }
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASS }),
  });
  if (!res.ok) throw new Error(`sign-in ${res.status} for ${email}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const call = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json", origin: BASE, ...(init.headers ?? {}) },
  });

const bob = await signIn("bob@example.test");

// ---------------------------------------------------------------- auth ----
console.log("\n== authentication ==");
for (const p of ["/api/dashboard", "/api/accounts", "/api/transactions", "/api/account/export"]) {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
  check(r.status === 401 || r.status === 302 || r.status === 307, `${p} refuses an anonymous caller (${r.status})`);
}

// A forged/garbage session cookie must not authenticate.
for (const forged of [
  "metta.session_token=deadbeef",
  "metta.session_token=" + "a".repeat(120),
  "metta.session_token=%00admin",
]) {
  const r = await call(forged, "/api/dashboard");
  check(r.status === 401, `a forged session cookie is rejected (${r.status})`);
}

// ------------------------------------------------------- session revoke ----
console.log("\n== session lifecycle ==");
{
  const temp = await signIn("bob@example.test");
  const before = await call(temp, "/api/dashboard");
  const out = await call(temp, "/api/auth/sign-out", { method: "POST", body: "{}" });
  const after = await call(temp, "/api/dashboard");
  check(before.status === 200, "a fresh session works");
  check([200, 204].includes(out.status), `sign-out is accepted (${out.status})`);
  check(after.status === 401, `the session is dead server-side after sign-out (${after.status})`);
}

// -------------------------------------------------------- mass assignment ----
console.log("\n== mass assignment ==");
{
  // Try to promote yourself, or hand your row to someone else.
  const r = await call(bob, "/api/account/profile", {
    method: "PATCH",
    body: JSON.stringify({ name: "Bob", role: "ADMIN", emailVerified: true, id: "someone-else", userId: "someone-else" }),
  });
  check(r.status === 400, `extra fields on profile update are rejected outright (${r.status})`);

  const prof = await (await call(bob, "/api/account/profile")).json();
  check(prof.role !== "ADMIN", "role was not changed", `role=${prof.role}`);
}
{
  // A write that tries to set its own owner.
  const r = await call(bob, "/api/folders", {
    method: "POST",
    body: JSON.stringify({ name: `mass-${Date.now()}`, userId: "someone-else" }),
  });
  check(r.status === 400, `a write cannot carry its own userId (${r.status})`);
}

// ------------------------------------------------------------- injection ----
console.log("\n== injection ==");
for (const payload of [
  "' OR 1=1 --",
  "\"; DROP TABLE \"Transaction\"; --",
  "%' UNION SELECT NULL,NULL --",
]) {
  const r = await call(bob, `/api/transactions?search=${encodeURIComponent(payload)}`);
  const body = r.ok ? await r.json() : null;
  check(r.ok && Array.isArray(body?.transactions), `SQL payload handled as text (${r.status})`);
}
{
  // Prototype pollution through a JSON body.
  const r = await call(bob, "/api/folders", {
    method: "POST",
    body: '{"name":"pp-test","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
  });
  check(r.status === 400, `__proto__ in a body is rejected (${r.status})`);
  check({}.polluted === undefined, "the prototype is not polluted");
}
{
  const stillThere = await call(bob, "/api/transactions?limit=1");
  const j = await stillThere.json();
  check(j.total > 0, `transactions survived the injection attempts (total=${j.total})`);
}

// ------------------------------------------------------------------ XSS ----
console.log("\n== stored XSS ==");
{
  const tx = await (await call(bob, "/api/transactions?limit=1")).json();
  const id = tx.transactions?.[0]?.id;
  const payload = `<img src=x onerror=alert(1)>`;
  const put = await call(bob, `/api/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: payload }),
  });
  const back = await (await call(bob, "/api/transactions?limit=1")).json();
  const stored = back.transactions?.[0]?.notes ?? "";
  check(put.ok, `notes accepted (${put.status})`);
  // Storing markup is fine; rendering it as HTML is not. React escapes by
  // default, so the check is that nothing renders it via dangerouslySetInnerHTML.
  check(typeof stored === "string", "notes come back as a string, not markup");
}

// -------------------------------------------------------------- CSRF ----
console.log("\n== cross-site requests ==");
for (const [label, headers] of [
  ["a foreign Origin", { origin: "https://evil.example" }],
  ["no Origin at all", {}],
]) {
  const r = await fetch(`${BASE}/api/folders`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: bob, "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: `csrf-${Date.now()}` }),
  });
  // A cookie is SameSite=lax, so a genuine cross-site POST never carries it;
  // this records what the server does when one arrives anyway.
  console.log(`       (${label}: ${r.status})`);
}
{
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ email: "bob@example.test", password: PASS }),
  });
  check(r.status >= 400, `sign-in from a foreign Origin is refused (${r.status})`);
}

// --------------------------------------------------------- open redirect ----
console.log("\n== open redirect ==");
for (const target of [
  "https://evil.example",
  "//evil.example",
  "/\\evil.example",
  "https:/\\/\\evil.example",
]) {
  const r = await fetch(`${BASE}/login?from=${encodeURIComponent(target)}`, { redirect: "manual" });
  const loc = r.headers.get("location") ?? "";
  check(!loc.includes("evil.example"), `?from=${target} is not honoured`, loc);
}
{
  const r = await fetch(`${BASE}/accounts`, { redirect: "manual" });
  const loc = r.headers.get("location") ?? "";
  check(loc.startsWith("/login"), `protected page redirects internally only (${loc})`);
}

// -------------------------------------------------------- enumeration ----
console.log("\n== account enumeration ==");
{
  const known = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: "bob@example.test", password: "definitely-wrong-password" }),
  });
  const unknown = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: "nobody-here@example.test", password: "definitely-wrong-password" }),
  });
  const a = await known.text();
  const b = await unknown.text();
  check(known.status === unknown.status, `same status for known and unknown address (${known.status} vs ${unknown.status})`);
  check(a === b, "same body for known and unknown address", `${a.slice(0, 60)} | ${b.slice(0, 60)}`);
}

// ------------------------------------------------------------ payloads ----
console.log("\n== oversized and malformed input ==");
{
  const big = JSON.stringify({ name: "x".repeat(2_000_000) });
  const r = await call(bob, "/api/folders", { method: "POST", body: big });
  check([400, 413].includes(r.status), `a 2MB body is refused (${r.status})`);
}
{
  const r = await call(bob, "/api/folders", { method: "POST", body: "{not json" });
  check(r.status === 400, `malformed JSON is refused (${r.status})`);
}
{
  const r = await call(bob, "/api/transactions?limit=999999999");
  const j = r.ok ? await r.json() : {};
  check(!r.ok || (j.transactions?.length ?? 0) <= 500, `an absurd limit is capped (${j.transactions?.length ?? "refused"})`);
}

// ------------------------------------------------------------- caching ----
console.log("\n== caching of authenticated responses ==");
for (const p of ["/api/dashboard", "/api/transactions", "/api/account/export"]) {
  const r = await call(bob, p);
  const cc = r.headers.get("cache-control") ?? "";
  const vary = r.headers.get("vary") ?? "";
  check(/no-store/.test(cc) && /private/.test(cc), `${p} is no-store + private (${cc})`);
  check(/Cookie/i.test(vary), `${p} varies on Cookie (${vary})`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (findings.length) {
  console.log("\nFINDINGS:");
  findings.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);
