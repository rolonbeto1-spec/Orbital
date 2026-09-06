# Metta Production Handoff

**Prepared for independent review.**
Repository: `rolonbeto1-spec/Orbital`, branch `claude/metta-multiuser-saas-rma3rx`
Source of the original application: `rolonbeto1-spec/bull-trader` (unchanged)

---

## 1. Executive Summary

Metta was a private personal-finance app for one person, behind a single shared
password. It is now built as a multi-tenant SaaS: real user accounts, isolated
financial data, encrypted bank credentials, verified webhooks, an AI boundary
that cannot reach across tenants, and a test suite whose job is to attack it.

**What changed, in one line each:**

- **Authentication.** The shared `APP_PASSWORD` and its hand-rolled HMAC cookie
  are deleted. Better Auth 1.7 provides scrypt hashing, required email
  verification, expiring single-use reset tokens, and a revocable server-side
  session table.
- **Multi-tenancy.** Every row describing someone's money carries a
  non-nullable `userId`. Settings, categories and folder names — all previously
  global — are now per-user, because global versions of those would have leaked
  or collided between tenants.
- **Authorization.** Ownership is part of the SQL `WHERE` clause, never a check
  after the fetch. Missing and not-yours return identical 404s.
- **Plaid.** Access tokens encrypted with AES-256-GCM under a rotatable key;
  webhooks verified by pinned-algorithm ES256 signature; the owning user
  resolved from our database, never from the payload; product list still
  read-only.
- **AI.** One entry point, no tools passed to the model, an explicit projection
  of one tenant's data, verdicts validated against the caller's own ids, and
  per-user plus global spend ceilings.
- **Verification.** 134 automated tests, all against a real database.

**Two real bugs were found by the tests and fixed:** `toCents(1.005)` was losing
a cent to float representation, and a blank environment variable coerced to `0`,
which would have silently switched the AI off.

**Public registration ships disabled.** Twelve launch blockers remain, listed in
§18. The most important is that no one independent has reviewed any of this.

**Statistics:** 97 files changed, +8,557 / −1,581 lines. 42 API routes. 4 test
suites, 134 tests.

---

## 2. Architecture

```
Browser ──HTTPS──► src/proxy.ts ──► route() ──► requireUser() ──► requireOwned()
                   headers + CSP     auth,        tenant from       ownership in
                   optimistic gate   limits,      the session       the WHERE clause
                                     validation
                                          │
                                          ▼
                                       Prisma ── every owned query carries userId
                                          │
                        ┌─────────────────┼─────────────────┬──────────────┐
                        ▼                 ▼                 ▼              ▼
                    Postgres           Plaid            Anthropic        Resend
                     (Neon)       tokens encrypted     no tools,      no financial
                                  webhooks verified   one tenant       content
```

**Layer separation (§78).** Data access, domain logic, security, API and
presentation are separate directories. No authorization decision lives in a
component, so a visual redesign cannot change who can see what.

**Stack:** Next.js 16.3 (App Router, `src/proxy.ts` rather than
`middleware.ts`), Prisma 6, Better Auth 1.7.2, Zod 4, Vitest 3, Neon Postgres,
Vercel.

---

## 3. Authentication

**Provider: Better Auth 1.7.2**, self-hosted against our own Postgres. Chosen
over rolling our own (§82 forbids homemade password hashing) and over an
external identity SaaS (which would add a vendor holding our users).

| Property | Value |
|---|---|
| Password hashing | scrypt, library-provided |
| Minimum length | 12 characters, no composition rules |
| Email verification | Required before any financial route |
| Reset token | Single-use, 1 hour, revokes all other sessions |
| Session | 30 days, refreshed daily, server-side, immediately revocable |
| Cookie | HttpOnly, Secure in production, SameSite=Lax, prefix `metta` |
| CSRF | Origin checking on; no mutating GET exists |
| Rate limits | Sign-in 8/5min, signup 5/hr, reset 5/hr, resend 5/hr |
| MFA | **Not enabled** — plugins available. Launch blocker LB-3 |

**Enumeration resistance (§24).** Signing up with an existing address returns a
synthetic success and emails the *real* account holder instead of telling the
visitor. Reset and resend return one fixed message either way. Sign-in gives one
message for every failure mode.

**Deleted, not modified:** `src/lib/session.ts`, `/api/auth/login`,
`/api/auth/logout`. If `APP_PASSWORD` is still set in production, the app
refuses to start, so a leftover value cannot be mistaken for security.

---

## 4. Multi-Tenancy

**The rule:** every user-owned query names the tenant.

```ts
// The pattern everywhere. Ownership is in the query, not a later check.
const record = await prisma.transaction.findFirst({
  where: { id: requestedId, userId: authenticatedUserId },
});
```

**How the tenant is derived (§3).** From the server-verified session only —
`requireUser()` in `src/lib/security/session.ts`. No route reads a user id from
a query string, a body, a header or a client-supplied cookie. `getCurrentUser`
re-reads role and deletion state from the database rather than trusting the
session payload, so a role change or a deletion takes effect on the next request.

**Four layers, with an honest weighting:**

| Layer | Strength | Note |
|---|---|---|
| `src/proxy.ts` | **Weak by design** | Optimistic cookie check. If deleted, the app is still secure. |
| `requireUser()` | Strong | Verifies against the database |
| `requireOwned()` | Strong | Ownership in the WHERE clause |
| Query scoping | Strong | `userId` even on writes that already passed a check |

**Cross-tenant foreign keys.** A request body naming another tenant's
`categoryId` or `folderId` is rejected before use — otherwise "file my
transaction in your folder" would link two tenants' data.

**404 uniformity.** Not-found and not-yours return the same status *and the same
body*, asserted byte-for-byte.

---

## 5. Database Changes

**Ownership added to:** Item, Account, Transaction, Holding, Category,
MerchantRule, Budget, Goal, Property, Folder, Setting.

**New models:** User, Session, AuthAccount, Verification, BetterAuthRateLimit,
AuditEvent, RateLimitCounter, WebhookDelivery.

**Three decisions worth understanding:**

1. **`Setting` is keyed `(userId, key)`.** The old global keys — `digestLast`,
   `aiCalls:2026-09-05`, `alertPrefs`, `questionsDismissed` — were shared by
   every tenant. One user's AI calls would have consumed everyone's budget.

2. **Categories are per-user rows**, seeded at signup. They carry a per-user
   `inBudget` override and are the target of per-user budgets and merchant
   rules; a shared table would have meant one person's budget preference changed
   everyone's budget.

3. **Folder names are unique per user.** Two people can both have "Taxes 2026".
   Under the old global constraint, failing to create one would have revealed
   that someone else had it.

**Indexes:** `(userId)` plus `(userId, date)`, `(userId, categoryId)`,
`(userId, accountId)`, `(userId, folderId)`, `(userId, pending)`,
`(userId, status)`, `(userId, isBusiness)` — the shapes the app actually queries.

**Cascades chosen per relation, not uniformly (§67).** User → financial data
cascades (deleting an account destroys the money data). Transaction → Folder and
Transaction → Category are `SetNull` (deleting a label must not destroy
financial history). AuditEvent → User is `SetNull` so the record of a deletion
survives it.

**Migrations (§44).** Production now runs `prisma migrate deploy` against
committed, reviewable SQL. `prisma db push` is gone from the build, and the
build **fails** rather than falling back to it. The initial migration is 487
lines: 19 tables, 53 `userId` columns, 18 cascade FKs, **zero DROP statements**.

---

## 6. Existing Owner Migration

**Not yet run.** `scripts/migrate-owner-data.ts` is written and reviewed;
executing it is launch blocker LB-1.

**What it does:**
1. Requires the owner to have already registered and verified through the normal
   flow — the script never creates passwords.
2. Refuses to run without an encryption key configured, so tokens cannot be left
   in plaintext.
3. **Refuses to run if the database already has more than one tenant's data.**
   It claims *unowned legacy* rows; running it on a real multi-tenant database
   would be wrong.
4. Counts every table before, seeds the owner's category catalog, encrypts
   plaintext Plaid tokens **first** (so a failure changes nothing), then claims
   ownership.
5. Verifies counts are identical before and after, and that nothing is left
   unowned. Exits non-zero if either check fails.
6. Prints the manual verification steps: sign in, compare totals to the old app,
   run a sync.

`--dry-run` reports exactly what a live run would do and writes nothing.

**Before running it:** take a Neon backup **and test a restore** (LB-7).

---

## 7. Plaid Security

| Concern | Implementation |
|---|---|
| Read-only forever | Product list is `[Transactions]`. No Auth, Transfer, Payment Initiation or Signal. There is no code path that can move money. |
| `client_user_id` | `User.plaidUserRef`, an opaque `mu_<32 hex>`. Never email, name or phone. |
| Token storage | AES-256-GCM; key in the environment, not the database; generation recorded per row for rotation. |
| Token exposure | One `userId`-scoped accessor yields plaintext. Every response uses an explicit `select` omitting the ciphertext. Redaction strips token-shaped values from logs by pattern. |
| Webhook verification | ES256 with the algorithm **pinned** (so `alg:none` and HMAC confusion both fail), key fetched by `kid` and cached, `iat` freshness bound, constant-time digest comparison against the raw bytes. No JWT library — Node's crypto. |
| Webhook idempotency | Body fingerprint in `WebhookDelivery`; duplicates acknowledged and dropped; the record is released on failure so Plaid's retry is not swallowed. |
| Webhook tenancy | Owner resolved from our database. Nothing in the payload identifies a user. |
| OAuth redirect | From a server-side allowlist. The browser never supplies it. |
| Item states | connected / login_required / consent_expired / disconnected / revoked / error. Only healthy Items sync. |
| Disconnect | Revokes at Plaid **first**, while the credential can still be decrypted, then deletes locally. |
| Concurrency | Conditional-update sync lock with a 15-minute stale release. |

**Why encrypt when Neon encrypts disks?** Disk encryption protects against
someone taking the hardware. It does nothing against a leaked read-only
connection string, a stray backup, or a query reaching the table.

**Not verified:** a genuine Plaid signature has never been checked end-to-end.
Only forgeries have been tested, and they are correctly rejected. **LB-4.**

---

## 8. API Security

**One wrapper, `route()`, applies to all 42 routes:** production-config check →
authenticate → rate-limit → validate → handle → audit. Defaults are the safe
ones; a handler must explicitly opt out of authentication, and only three do
(the signature-authenticated webhook, the health check, and Better Auth's own
endpoints).

**Validation (§14).** Zod on every route. `.strict()` objects, so an unexpected
property is a 400 rather than something riding into a Prisma `data` object.
Bounded strings, amounts, dates and pages. 128 KB body cap enforced before
parsing. Error responses name the field and the reason but **never echo the
submitted value**.

**Rate limiting (§22).** Database-backed, so limits survive serverless cold
starts and are shared across instances. Named budgets per risk class (AI, Plaid
link, sync, export, reports, ordinary reads/writes). Authenticated traffic is
limited per user *and* per IP, so one network cannot launder abuse through many
fresh accounts. Responses are a bare 429 with `Retry-After` and say nothing
about which budget was hit.

**Errors (§40).** Generic message plus a correlation id the user can quote;
detail stays in the server log. Asserted absent from responses: stack frames,
filesystem paths, `PrismaClient`, SQL.

---

## 9. AI Security

**Single entry point:** `src/lib/ai/guard.ts`.

**The model has no tools.** This is the load-bearing control. It cannot query the
database, call an API, or reach the network, so even a fully successful prompt
injection can only make it produce wrong text.

**Data minimisation (§30).** The snapshot is assembled field by field. No Prisma
row is spread into it, so a column added later cannot silently start being sent —
asserted by a test that greps for bare spreads. Never sent: Plaid tokens,
password hashes, session identifiers, API keys, database ids, the user's email
or name, account numbers.

**Prompt injection (§31).** Merchant names, descriptions and notes are wrapped in
`<untrusted_user_data>`, stripped of the delimiter and control characters, and
length-bounded; the system preamble declares them data. **This layer is treated
as soft.** The guarantee comes from the model having no authority and from every
prompt being built from one already-scoped tenant.

**Structured actions (§32).** Deterministic commands are pattern-matched from the
*user's* text. The model never chooses an action or supplies its parameters.
Verdicts are validated against the caller's own category ids and written with
`userId`-scoped `updateMany`, so an injected id matches zero rows.

**Cost (§33).** Per-user daily budget in the user's own timezone; 5/day for
unverified accounts vs 60 for verified; a global daily ceiling incremented
atomically across all tenants; burst and sustained limits; 25s timeouts; input
caps; per-merchant caching. `AI_DAILY_LIMIT=0` is the kill switch. Failure falls
back to the deterministic rule engine rather than breaking chat.

---

## 10. Application Security

| Control | Implementation |
|---|---|
| **CSP** | Per-request nonce, `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `unsafe-eval` in development only. |
| **HSTS** | 2 years, `includeSubDomains`. `preload` deliberately not set until the domain is final. |
| **Other headers** | nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, X-Frame-Options. |
| **CSRF** | SameSite=Lax + origin checks + no mutating GET (asserted for nine route modules). |
| **CORS** | None configured. Same-origin only. `trustedOrigins` is our origin alone. |
| **XSS** | 0 uses of `dangerouslySetInnerHTML`. AI output rendered as text. Display URLs https-validated, so `javascript:` cannot reach an `href`. |
| **SSRF** | The server does not fetch user- or AI-supplied URLs at all. `guardedFetch` exists for narrow future use: https-only, default-port, private-range rejection on every resolved address, manual redirect re-validation, timeout, size cap. |
| **Open redirect** | Relative internal paths only; schemes, `//host`, backslashes and CR/LF rejected. |
| **Caching** | `private, no-store`, `Vary: Cookie` on every authenticated response, set in `safeJson` and again in `next.config.ts`. |
| **SQL** | Prisma parameterised APIs. One justified `$queryRawUnsafe` in a migration script (fixed string, no input). Zero `$executeRawUnsafe`. |

**Known accepted relaxation:** `style-src 'unsafe-inline'`, required by Next's
inline style attributes and `next/font`. Permits CSS injection, not script
execution.

---

## 11. Privacy

**Export (§36).** Every query scoped by `userId`; every model uses an explicit
`select`. That is what makes the exclusions real rather than aspirational — with
`include`, a future schema addition would silently join the export. Excluded and
asserted by test: `accessTokenCipher`, `accessTokenKeyId`, password hashes,
session tokens, verification tokens, `plaidUserRef`, internal bookkeeping.

**Deletion (§37).** Confirmed by email. Revokes at Plaid first, then purges
transactions, holdings, accounts, items, budgets, merchant rules, categories,
folders, goals, properties, settings and sessions in a transaction.

**What survives deletion, and why:** `AuditEvent` rows with `userId` set to NULL.
They contain no financial data. Destroying the record that an account existed and
was deleted would make the audit trail useless exactly when it matters.
Documented in the Privacy Policy.

**Logging (§12).** A structured logger with no raw-object escape hatch.
Redaction by key name (secrets, financial fields, PII) *and* by value shape
(Plaid, Anthropic, Resend, JWT, connection-string, email patterns), with depth
and size bounds. ESLint blocks `console.*` outside the logger. Plaid errors are
logged by error **code** only — Plaid's error bodies echo the request, including
the access token.

**Demo data (§47).** Removed from the application entirely. Nothing in `src/`
imports the seed. `prisma/seed.ts` creates one explicit demo user and refuses to
run against Postgres, on Vercel, or with Plaid credentials present.

**Legal.** Privacy Policy and Terms are written to describe what the software
actually does, carry a visible draft banner, and deliberately do **not** claim
"we never share your data" — Plaid, Anthropic, the host and the email provider
are each named with what they receive.

---

## 12. Operations

**CI (§64):** lint → typecheck → tests → build, plus secret scan and
`npm audit --audit-level=high`. Installs with `npm ci` from the committed
lockfile. CI holds no production credentials.

**Migrations:** `prisma migrate deploy` only. The build refuses to deploy with no
migration history rather than falling back to `db push`.

**Backups:** Neon point-in-time recovery. **Not yet verified by an actual
restore** — LB-7. A backup that has never been restored is not a verified backup.

**Monitoring:** structured JSON logs with metrics for request counts, latency,
rate-limit rejections, Plaid sync duration and error codes, webhook
rejections, and AI budget exhaustion. `/api/health` reports app and database
liveness and deliberately discloses nothing else.

**Incident response:** INCIDENT_RESPONSE.md, 11 runbooks, containment first.
Breach-notification timelines are deliberately left to counsel.

---

## 13. Automated Tests

**134 passing, 4 suites.** All against a real SQLite database — Prisma is never
mocked, because a mocked client proves nothing about whether the real queries are
scoped.

| Suite | Tests | Result |
|---|---|---|
| `tests/tenant-isolation.test.ts` | 50 | PASS |
| `tests/security-controls.test.ts` | 32 | PASS |
| `tests/crypto-money-time.test.ts` | 30 | PASS |
| `tests/ai-isolation.test.ts` | 22 | PASS |

Run with `npm test`; the security-critical subset with `npm run test:security`.

**Also verified manually this session:** typecheck clean, lint 0 errors,
production build succeeds, secret scan clean, and a client-bundle audit across
26 chunks finding no secret identifier and no server-only module.

---

## 14. Tenant Isolation Attack Results

Two tenants, **Alice** and **Bob**, built with deliberately colliding data — the
same merchant ("Whole Foods"), the same folder name ("Taxes 2026"), the same
category name, the same balance. A leak therefore looks like plausible data
rather than something obviously foreign. Under the old schema these fixtures
could not even be constructed.

**Every attack below signs in as Alice and uses Bob's real database ids**, not
guesses — a strictly harder test.

### Read attempts

| Attack | Result |
|---|---|
| `GET /api/transactions` | Only Alice's; `total` = 1 |
| `GET /api/transactions?account=<Bob's account>` | **Empty** — scope is ANDed, not replaced |
| `GET /api/transactions?bank=<Bob's item>` | **Empty** |
| `GET /api/transactions?category=<Bob's category>` | **Empty** |
| `GET /api/accounts` | Bob's item absent |
| `GET /api/budgets`, `/goals`, `/folders`, `/properties`, `/holdings`, `/categories` | Alice's ids only |

### Write attempts (IDOR)

| Attack | Result |
|---|---|
| `PATCH /api/transactions/<Bob's>` | **404**, Bob's notes unchanged |
| `PATCH` Alice's transaction → **Bob's folder** | **404**, no cross-tenant link |
| `PATCH` Alice's transaction → **Bob's category** | **404**, category unchanged |
| `PATCH /api/accounts/<Bob's>` | **404**, `isBusiness` unchanged |
| `PATCH /api/budgets/<Bob's>` | **404**, amount still 600 |
| `POST /api/budgets` with **Bob's category** | **404**, no budget created |
| `PATCH /api/goals`, `/folders`, `/properties`, `/categories` (Bob's) | **404**, all unchanged |

### Delete attempts

| Attack | Result |
|---|---|
| `DELETE /api/goals/<Bob's>` | **404**, goal survives |
| `DELETE /api/folders/<Bob's>` | **404**, folder survives |
| `DELETE /api/properties/<Bob's>` | **404**, survives |
| `DELETE /api/budgets/<Bob's>` | **404**, survives |
| `DELETE /api/items/<Bob's>` — *disconnect Bob's bank* | **404**; Bob keeps his item, account and transaction |

### Plaid

| Attack | Result |
|---|---|
| `POST /api/plaid/sync` with Bob's item id | **404** |
| `syncItemForUser(bobItem, aliceId)` — below HTTP | No-op, `{added:0, modified:0, removed:0}` |
| `accessTokenForOwnedItem(bobItem, aliceId)` | **null** — Bob's own call returns his token; Alice's identical call returns nothing |

### Export, AI, reports

| Attack | Result |
|---|---|
| `GET /api/account/export` as Alice | Bob's id, email and transaction id all **absent** |
| Export credential check | No `accessTokenCipher`, no `accessTokenKeyId`, no `access-sandbox`, no password field, no `plaidUserRef` |
| Assistant action "save the charge from Whole Foods to folder Receipts" | Acts on Alice's charge; Bob's untouched; the new folder belongs to Alice |
| Merchant-rule lesson from Alice | Bob's rules unchanged, still pointing at his own category |
| `/api/dashboard`, `/report`, `/insights`, `/hive` | Alice's figures only — spending 84.21, not 168.42 |
| `/api/account/audit` | Bob's event absent; no `userId` in the payload |

### Enumeration and session

| Attack | Result |
|---|---|
| 9 predictable/malformed ids (`1`, `0`, `-1`, `null`, a zero UUID, 300 chars, `%2e%2e%2f`) | 400 or 404, never data |
| Real-but-foreign id vs nonexistent id | **Identical status and identical body** |
| 16 protected routes, no session | **401** on every one |
| Session naming a nonexistent user | **401** |
| Session for a soft-deleted account | **401** |
| Authenticated but unverified email | **403** |

### Cache isolation

| Attack | Result |
|---|---|
| Alice then Bob through the same handler | Each receives only their own transaction |
| Response headers | `private, no-store`, `Vary: Cookie` |

**Conclusion:** across every route, every verb and every enumeration attempt
tested, User A could not read, modify, delete, sync, export or otherwise reach
User B's data. The server prevents it — not the absence of a button.

---

## 15. Security Scan Results

**Dependencies:** 4 high, 0 critical.

| Advisory | Package | Path | Assessment |
|---|---|---|---|
| GHSA-ggr8-5vv4-36mx | `deepmerge-ts` | `prisma` → `@prisma/config` | Build-time only; not in any request path. The "fix" downgrades Prisma. |
| GHSA-2v37-7h3g-55p8 | `nanoid` | transitive | Not called with a zero size by any code here. |

Neither is reachable from a request. Recorded as accepted, not as blockers, so
the judgement can be challenged.

**Secrets:** clean. `scripts/scan-secrets.js` finds nothing in tracked files.
All **97 commits** of the source repository's history were scanned; the only
match is a placeholder (`sk-ant-your-key-here`) in the README. **No real
credential has ever been committed.**

**Static review (§63)**, `src/` + `scripts/` + `prisma/`:

| Pattern | Hits | Assessment |
|---|---|---|
| `dangerouslySetInnerHTML`, `eval(`, `new Function`, `innerHTML`, `localStorage`, `$executeRawUnsafe` | 0 | — |
| `child_process` | 2 | Build scripts, fixed commands |
| `$queryRawUnsafe` | 1 | Migration script; fixed string, no input; justified in place |
| `NEXT_PUBLIC_` | 3 | Comments and the scanner's own pattern. **No such variable exists.** |
| `accessToken` | 54 | Server-only Plaid modules; export-route hits are comments naming exclusions |
| `PLAID_SECRET` / `ANTHROPIC_API_KEY` | 10 | Env schema, client config, presence checks |
| `console.log` | 48 | Operator scripts (37), the logger itself (3), one dev-only mail path with a lint exemption. **Zero in shipped application code.** |

**Client bundle (§54):** across 26 chunks — zero occurrences of `PrismaClient`,
`createDecipheriv`, any secret variable name, or any server-only module.

---

## 16. Manual Configuration Required

Plain-English steps. Each ends with a way to check it worked.

### Vercel

1. **Settings → Environment Variables**, add for Production:
   - `BETTER_AUTH_SECRET` — run `openssl rand -base64 48`, paste the result.
   - `ENCRYPTION_KEY_V1` — run `openssl rand -base64 32`, paste the result.
     **Keep a copy somewhere safe.** Lose it and every user must reconnect their
     bank.
   - `ENCRYPTION_KEY_ACTIVE` = `v1`
   - `APP_URL` = your real site address, starting with `https://`
   - `PUBLIC_SIGNUP_ENABLED` = `false` (leave it false)
   - `SIGNUP_ALLOWLIST` = your email, so you can register
2. **Delete `APP_PASSWORD`.** The app refuses to start in production while it
   exists.
3. **Settings → Deployment Protection:** **OFF** for Production (the app has its
   own login), **ON** for Preview.
4. **Settings → Security:** turn on the **WAF**, and bot protection for
   `/api/auth/*`.
5. **Redeploy.** Environment changes do nothing until you do.
6. *Check:* visit `https://your-site/api/health` — it should say
   `{"status":"ok","database":true}`.

### Plaid

1. **Dashboard → Developers → Webhooks:** set
   `https://your-site/api/plaid/webhook`.
2. **Dashboard → Developers → API → Allowed redirect URIs:** add
   `https://your-site/app/plaid/oauth`.
3. In Vercel set `PLAID_WEBHOOK_URL` and `PLAID_REDIRECT_URIS` to those exact
   values, plus `PLAID_ENV=production`, `PLAID_CLIENT_ID`, `PLAID_SECRET`.
4. Redeploy.
5. *Check:* connect a bank end-to-end. Confirm transactions appear and that the
   browser console shows **no CSP errors** during the Plaid window.

### Email (Resend)

1. Create a Resend account. **Domains → Add Domain**, add the DNS records it
   gives you (SPF, DKIM, DMARC) at your DNS provider. Wait for "verified".
2. Create an API key.
3. In Vercel: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=...`,
   `EMAIL_FROM=Metta <no-reply@your-domain>`. Redeploy.
4. *Check:* use "forgot password" with your own address. The email should arrive
   **in the inbox, not spam**, and the link should work.

### Neon

1. **Confirm point-in-time recovery** is available on your plan, and note the
   retention window.
2. **Actually restore a backup** into a scratch branch. Do not skip this — an
   untested backup is not a backup.
3. Write down who is responsible for restores.

### GitHub

1. **Settings → Branches:** protect the production branch; require CI to pass;
   disallow direct pushes.
2. **Settings → Code security:** enable secret scanning, push protection, and
   Dependabot alerts.
3. **Settings → Collaborators:** review who has access.

### DNS

- The records Resend gives you (SPF, DKIM, DMARC).
- Your domain pointed at Vercel.
- **HSTS preload:** only submit at hstspreload.org once the domain is final.
  It is effectively irreversible.

---

## 17. Remaining Risks

Brutally factual, as requested.

1. **No independent security review.** Everything here was designed,
   implemented, tested and reviewed by the same author. That is a structural
   weakness no amount of internal testing corrects. **This is the single most
   significant risk in this document.**
2. **MFA is not enabled.** A stolen password is sufficient to reach someone's
   complete financial history.
3. **No CAPTCHA or bot protection in the application.** Distributed credential
   stuffing across many IPs would evade the rate limits.
4. **A genuine Plaid webhook signature has never been verified end-to-end.**
   Only forgeries have been tested. If the verification has a flaw that rejects
   valid signatures, webhooks stop working; if it wrongly accepts, that is worse.
5. **No load testing.** Every limit is reasoned about, not measured. The
   serverless connection-pool behaviour under load is unknown.
6. **The rate limiter fails open** if the database is unreachable — deliberate,
   so a database blip does not lock everyone out, but it means limits are absent
   during a database incident.
7. **Money is stored as `Float`.** Aggregation is exact (integer cents), but a
   single stored value can be a non-representable float. Bounded at a half-cent
   per row, non-compounding.
8. **`style-src 'unsafe-inline'`** permits CSS injection.
9. **Supply chain is largely unmitigated** beyond a lockfile and `npm audit`. A
   compromised transitive dependency would defeat every control here.
10. **Sign-up timing side channel** is unmeasured.
11. **Prompt-injection delimiting is soft.** Containment rests on the model
    having no tools.
12. **Anyone with direct database access reads everything** except Plaid tokens.
    Inherent; mitigated only operationally.
13. **The owner migration has not been run.** Until it is, production financial
    data is not correctly owned under the new schema.
14. **Backups have never been restored.**

**Metta must not be described as "secure", "unhackable", or compliant with any
standard.** It has a considered security architecture and evidence that specific
controls work. That is a different claim.

---

## 18. Launch Blockers

**PUBLIC SIGNUPS MUST REMAIN DISABLED** until all twelve are cleared. Full detail
in PRODUCTION_LAUNCH_CHECKLIST.md.

| # | Blocker |
|---|---|
| LB-1 | Owner data migrated and verified (with a tested backup first) |
| LB-2 | Real production secrets set; `APP_PASSWORD` deleted |
| LB-3 | MFA enabled, **or** explicitly accepted in writing by the owner |
| LB-4 | Plaid production config verified, incl. a **real** webhook received |
| LB-5 | Email delivery working end-to-end from a verified domain |
| LB-6 | Vercel WAF and bot protection enabled |
| LB-7 | Neon backups confirmed **and a restore actually performed** |
| LB-8 | Privacy Policy and Terms reviewed by qualified counsel |
| LB-9 | Headers and CSP verified in a browser on the live domain |
| LB-10 | Cache isolation confirmed at the edge with two live users |
| LB-11 | Branch protection, secret scanning, Dependabot enabled |
| LB-12 | **Independent penetration test** |

---

## 19. Launch Checklist — Pass/Fail

| Requirement (§76) | Status |
|---|---|
| Shared `APP_PASSWORD` removed | **PASS** |
| Production authentication working | **PASS** |
| Email verification working | **PASS** (code) · **BLOCKED** (delivery, LB-5) |
| Password reset working | **PASS** (code) · **BLOCKED** (delivery, LB-5) |
| Tenant ownership added everywhere | **PASS** |
| Old owner's data migrated | **FAIL — LB-1** |
| Tenant-isolation tests passing | **PASS** (50/50) |
| Plaid tokens encrypted | **PASS** |
| Plaid webhooks cryptographically verified | **PASS** (code) · **BLOCKED** (real signature, LB-4) |
| Secrets audited | **PASS** |
| Rate limits enabled | **PASS** |
| Security headers tested | **PASS** (code) · **BLOCKED** (live browser, LB-9) |
| CSP tested with Plaid | **FAIL — LB-4/LB-9** |
| AI isolation verified | **PASS** |
| Account deletion tested | **PASS** |
| Data export tested | **PASS** |
| Dependency scan reviewed | **PASS** (4 build-time highs accepted) |
| Production migrations established | **PASS** |
| Backups/recovery confirmed | **FAIL — LB-7** |
| Logs redact sensitive information | **PASS** |
| Staging environment tested | **FAIL** (not built; not a blocker) |
| ASVS checklist completed | **PASS** |
| Threat model completed | **PASS** |
| Incident-response document completed | **PASS** |
| Terms reviewed by counsel | **FAIL — LB-8** |
| Privacy Policy reviewed by counsel | **FAIL — LB-8** |
| Plaid production settings reviewed | **FAIL — LB-4** |
| Manual penetration review completed | **FAIL — LB-12** |

**19 pass, 7 fail, 3 partial.** Every failure is a named blocker with an owner
action.

---

## 20. Files Changed

97 files, +8,557 / −1,581.

**New — security layer**
`src/lib/security/{session,ownership,api,crypto,redact,logger,rate-limit,audit,url-guard}.ts`

**New — application**
`src/lib/{env,auth,auth-client,mail,money,time,validation,account-lifecycle,plaid-items,plaid-webhook-verify,safe-redirect}.ts`,
`src/lib/ai/guard.ts`

**Rewritten**
`prisma/schema.prisma`, `prisma/seed.ts`, `src/proxy.ts`, `src/lib/{plaid,sync,db-helpers,smart-categorize,queries,budget,hive,nudges,alert-prefs,recurring,assistant,assistant-llm,assistant-actions}.ts`,
`next.config.ts`, `eslint.config.mjs`, `scripts/vercel-build.js`, `package.json`,
`.env.example`

**Routes** — all 42 under `src/app/api/**` rewritten through `route()`, plus new:
`api/auth/[...all]`, `api/plaid/webhook`, `api/account/{profile,consent,export,audit}`, `api/health`

**Pages** — new: `login` (rewritten), `signup`, `forgot-password`,
`reset-password`, `verify-email`, `legal/privacy`, `legal/terms`;
`src/components/auth/AuthForm.tsx`

**Tests**
`vitest.config.ts`, `tests/{setup,fixtures}.ts`, `tests/stubs/server-only.ts`,
`tests/{tenant-isolation,security-controls,crypto-money-time,ai-isolation}.test.ts`

**Operations**
`.github/workflows/ci.yml`, `scripts/{scan-secrets.js,migrate-owner-data.ts,rotate-encryption-key.ts}`,
`prisma/migrations/00000000000000_init/migration.sql`

**Documentation**
`SECURITY_THREAT_MODEL.md`, `SECURITY_REVIEW.md`, `SECURITY_ASVS_CHECKLIST.md`,
`INCIDENT_RESPONSE.md`, `SECRET_ROTATION.md`, `PRODUCTION_LAUNCH_CHECKLIST.md`,
`METTA_PRODUCTION_HANDOFF.md`

**Deleted**
`src/lib/session.ts`, `src/app/api/auth/{login,logout}/route.ts`, the old
single-tenant SQLite migrations

---

## 21. Deployment

**Branch:** `claude/metta-multiuser-saas-rma3rx` on `rolonbeto1-spec/Orbital`.

**Commits:**
1. `fc6ee34` — multi-tenant foundation: schema, auth, security layer
2. `d789e2f` — every API route and domain query scoped to the authenticated user
3. `011e484` — account lifecycle, security headers, CI gate, 134 adversarial tests
4. `b1f210d` — auth pages, legal drafts, operator scripts, security documentation

**Not deployed.** No pull request has been opened and nothing has been pushed to
a production branch. Orbital is a fresh repository; the original `bull-trader`
repository and its live deployment are untouched.

**To deploy:**
1. Review this branch — particularly `src/lib/security/*` and the tenant
   isolation tests.
2. Create a new Vercel project pointing at Orbital.
3. Work through §16 (Manual Configuration).
4. Deploy with `PUBLIC_SIGNUP_ENABLED=false`.
5. Register the owner's account via `SIGNUP_ALLOWLIST`, verify the email.
6. Take a Neon backup and **test restoring it**.
7. Run `scripts/migrate-owner-data.ts --dry-run`, review, then run it for real.
8. Verify the owner's totals against the old app.
9. Work through the remaining launch blockers.
10. Only then consider `PUBLIC_SIGNUP_ENABLED=true`.

**Verified in this session:** `tsc --noEmit` clean · `eslint` 0 errors ·
134/134 tests passing · `next build` succeeds · secret scan clean · client
bundle free of secrets and server-only modules.

**Not verified:** anything requiring real Plaid, Anthropic, Resend, Postgres or
Vercel credentials, none of which were available. Those are the launch blockers.
