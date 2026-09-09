# Live verification

`npm test` runs the application's functions against a real database. These
scripts run the **whole application over HTTP** — proxy, session, route
wrapper, rate limiter and queries together — against a server you have
started. They are what proved the app worked, and they exist because several
defects were invisible to the unit suite:

* four screens read fields their endpoint never returned (`useApi<T>` asserts
  a type rather than checking one, so the compiler was satisfied and the
  browser showed `$NaN` or a blank page);
* the Ask screen posted `{ question }` to a schema expecting `{ message }`,
  so every question came back 400;
* account creation was impossible, because a required field could never be
  supplied.

None of those fail a function-level test. All of them fail here.

## Running them

Start a server and a database first, then:

```bash
BASE=http://localhost:3000 node scripts/e2e/features.mjs        # every feature, end to end
BASE=http://localhost:3000 node scripts/e2e/isolation.mjs       # two tenants attacking each other
BASE=http://localhost:3000 node scripts/e2e/vuln-hunt.mjs       # adversarial pass
BASE=http://localhost:3000 node scripts/e2e/limit-enforce.mjs   # rate limits actually refuse
node scripts/e2e/limit-audit.mjs                                # static: every handler names a bucket
```

They need two verified accounts, `alice@example.test` and `bob@example.test`,
with the password `correct-horse-battery-staple-1`. Sign both up through the
normal flow.

Rate limits are real, so a repeated run will lock itself out. Clear the
counters between runs:

```sql
DELETE FROM better_auth_rate_limit;
DELETE FROM "RateLimitCounter";
```

## What each one checks

| Script | Checks |
|---|---|
| `features.mjs` | Every feature creates, reads back, edits and deletes. A 200 that does not persist still fails. |
| `isolation.mjs` | Two accounts with different linked banks. Object access, mutation, deletion and cross-tenant sync are refused; thirteen collection endpoints carry nothing of the other tenant's; neither account is altered by the attempt. |
| `vuln-hunt.mjs` | Anonymous access, forged cookies, session revocation, mass assignment, SQL and prototype-pollution payloads, stored XSS, cross-site writes, open redirects, account enumeration, oversized and malformed bodies, and cache headers on authenticated responses. |
| `limit-enforce.mjs` | Each bucket refuses at exactly its stated maximum, returns `Retry-After`, and reveals nothing about the budget in the body. |
| `limit-audit.mjs` | Every exported handler names a rate-limit bucket. Reads the source; needs no server. |

## Testing the Plaid path without Plaid

`plaid-mock.mjs` answers the eight Plaid endpoints the app calls, giving each
linked Item its own institution and transactions — so two users linking "a
bank" end up with genuinely different data.

```bash
node scripts/e2e/plaid-mock.mjs 4599
# then, in the app's environment:
PLAID_CLIENT_ID=mock PLAID_SECRET=mock PLAID_API_BASE_URL=http://127.0.0.1:4599
```

`PLAID_API_BASE_URL` is ignored when `NODE_ENV=production`: a variable that
can redirect bank credentials to another host must not be one a production
environment can switch on.

**This is not a substitute for Plaid Sandbox.** It exercises our code, not
Plaid's responses. Before launch, run the real Link flow against Sandbox with
real credentials — a browser loading `cdn.plaid.com`, a real `public_token`,
and a real webhook.
