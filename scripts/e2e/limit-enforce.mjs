/**
 * Prove the limits actually refuse, rather than merely being declared.
 *
 * For each bucket: call past its stated maximum and require a 429 with a
 * Retry-After header, and require that the refusal body says nothing about
 * budgets, counts or windows.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = "correct-horse-battery-staple-1";

const LIMITS = {
  export: { max: 3, path: "/api/account/export", method: "GET" },
  plaidSync: { max: 6, path: "/api/plaid/sync", method: "POST", body: "{}" },
  report: { max: 20, path: "/api/report", method: "GET" },
  recurring: { max: 20, path: "/api/recurring", method: "GET" },
  plaidLinkToken: { max: 10, path: "/api/plaid/create-link-token", method: "POST", body: "{}" },
  write: { max: 90, path: "/api/alert-prefs", method: "POST", body: '{"half":true,"full":true,"weekly":false}' },
  read: { max: 240, path: "/api/categories", method: "GET" },
};

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASS }),
  });
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const cookie = await signIn(process.argv[2] ?? "bob@example.test");
let pass = 0;
let fail = 0;

for (const [name, spec] of Object.entries(LIMITS)) {
  const attempts = spec.max + 6;
  let ok = 0;
  let limited = 0;
  let retryAfter = null;
  let body = "";

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${BASE}${spec.path}`, {
      method: spec.method,
      headers: { cookie, "content-type": "application/json", origin: BASE },
      ...(spec.body ? { body: spec.body } : {}),
    });
    if (res.status === 429) {
      limited++;
      retryAfter ??= res.headers.get("retry-after");
      if (!body) body = (await res.text()).slice(0, 200);
    } else if (res.ok) ok++;
  }

  const enforced = limited > 0;
  const withinBudget = ok <= spec.max;
  const hasRetry = Boolean(retryAfter);
  const quiet = !/\b(\d+\s*(requests|per|window|remaining)|max|budget|count)\b/i.test(body);

  const verdict = enforced && withinBudget && hasRetry && quiet;
  if (verdict) pass++;
  else fail++;
  console.log(
    `${verdict ? "ok  " : "FAIL"} ${name.padEnd(15)} allowed ${String(ok).padStart(3)}/${String(spec.max).padStart(3)}` +
      `  refused ${String(limited).padStart(3)}  retry-after ${retryAfter ?? "MISSING"}` +
      (quiet ? "" : `  LEAKY BODY: ${body}`),
  );
}

console.log(`\n=== ${pass} buckets enforce correctly, ${fail} do not ===`);
process.exit(fail ? 1 : 0);
