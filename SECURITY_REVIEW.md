# Metta — Security Review

**Subject:** conversion of Metta from a single-owner app behind a shared
password into a multi-tenant SaaS.
**Reviewer:** the implementing engineer. This is a self-review — see
§"Limitations of this review" before relying on it.

Nothing here is described as "secure" without naming the control and, where one
exists, the test that exercises it.

---

## 1. Architecture

```
Browser
  │  HTTPS, HttpOnly SameSite=Lax session cookie
  ▼
src/proxy.ts ─────────── optimistic cookie check + security headers (CSP nonce)
  │                      NOT an authorization layer — see §4
  ▼
src/lib/security/api.ts ─ route(): config check → authenticate → rate-limit
  │                                → validate → handle → audit
  ▼
src/lib/security/session.ts ──── requireUser() derives the tenant, server-side
  │
  ▼
src/lib/security/ownership.ts ── ownership inside the SQL WHERE clause
  │
  ▼
Prisma ──────────────────────── every user-owned query carries userId
  │
  ├── Plaid   (src/lib/plaid*.ts)     tokens encrypted; webhooks verified
  ├── Anthropic (src/lib/ai/guard.ts) one entry point, no tools
  └── Email   (src/lib/mail.ts)       single validated recipient, no finance data
```

Layer separation (§78): data access (`lib/queries.ts`, `lib/db-helpers.ts`),
domain logic (`lib/budget.ts`, `lib/hive.ts`, `lib/recurring.ts`), security
(`lib/security/*`), API (`app/api/**`), presentation (`components/**`). No
authorization decision lives in a component. A visual redesign cannot change
who can see what.

---

## 2. Authentication

**Provider:** Better Auth 1.7.2, self-hosted against our own Postgres. Chosen
over rolling anything ourselves, and over an external identity SaaS, because it
gives the required primitives without adding a vendor who holds our users.

| Requirement (§4) | Status | Where |
|---|---|---|
| Secure password hashing | scrypt, library-provided | Better Auth default |
| Email verification | Required before a session is issued | `requireEmailVerification: true` |
| Password reset | Single-use, 1-hour expiry | `resetPasswordTokenExpiresIn` |
| Session rotation | Rolling 30-day expiry, refreshed daily | `session.updateAge` |
| Session revocation | Server-side table; cookie cache disabled so revocation is immediate | `session.cookieCache.enabled: false` |
| CSRF protection | Origin checking enabled | `disableCSRFCheck: false` |
| Secure cookies | HttpOnly, Secure in prod, SameSite=Lax, path `/` | `advanced.defaultCookieAttributes` |
| Brute-force defence | Per-endpoint DB-backed limits | `rateLimit.customRules` |
| MFA / passkeys | **Not enabled.** Plugins available and the schema accommodates them | Launch blocker LB-3 |

**The shared `APP_PASSWORD` is gone.** Not wrapped, not extended — deleted,
along with `src/lib/session.ts` (the hand-rolled HMAC token) and the old
`/api/auth/login` and `/api/auth/logout` routes. If `APP_PASSWORD` is still set
in production, the app refuses to start, so a leftover value cannot be mistaken
for a security control.

**Why email verification gates data access:** an unverified address means we
have not established that the registrant controls the mailbox that can reset the
password. Until then they can sign in but not reach financial routes (403).

---

## 3. Multi-tenancy

The central change. Every row describing a person's money carries a non-nullable
`userId` foreign key.

**Schema (§6, §67):** `Item`, `Account`, `Transaction`, `Holding`, `Category`,
`MerchantRule`, `Budget`, `Goal`, `Property`, `Folder`, `Setting`. Indexes on
`(userId)` and the composite shapes the app actually queries —
`(userId, date)`, `(userId, categoryId)`, `(userId, accountId)`,
`(userId, folderId)`, `(userId, pending)`, `(userId, status)`,
`(userId, isBusiness)`.

**Three schema decisions worth explaining:**

1. **`Setting` is keyed `(userId, key)`.** The old global keys — `digestLast`,
   `aiCalls:2026-09-05`, `alertPrefs`, `questionsDismissed` — were shared by
   every tenant. One user dismissing a question would have dismissed it for
   everyone; one user's AI calls would have consumed everyone's budget.

2. **Categories are per-user rows**, seeded at signup, rather than one shared
   catalog. Categories carry a per-user `inBudget` override and are the target
   of per-user budgets and merchant rules. A shared table would have meant one
   person's "count Groceries in my budget" changed everyone's budget.

3. **`Folder` names are unique per user, not globally.** Two people can both
   have "Taxes 2026". Under the old global constraint, trying to create one
   would have revealed that another user already had it.

**Cascade behaviour, chosen per relation rather than uniformly (§67):**

| Relation | On delete | Why |
|---|---|---|
| User → financial models | **Cascade** | Deleting an account must destroy the money data (§37). |
| Item → Account → Transaction | **Cascade** | Disconnecting a bank removes its data. |
| Transaction → Folder | **SetNull** | Deleting a bookkeeping label must not destroy financial history. |
| Transaction → Category | **SetNull** | Same reasoning. |
| Budget/MerchantRule → Category | **Cascade** | Meaningless without their category. |
| AuditEvent → User | **SetNull** | The trail of a deletion must survive the deletion. |

**Enforcement** is in `src/lib/security/ownership.ts`. The rule, with no
exceptions in the codebase:

```ts
// never:  findUnique({ where: { id } })  … then check the owner
// always: findFirst({ where: { id, userId } })
```

Checking after the fetch is a bug waiting for someone to add an early return.
Here ownership is part of the query, so another tenant's row does not come back
at all.

---

## 4. Authorization

**Default deny.** `route()` requires authentication unless a handler explicitly
opts out. Three do: the Plaid webhook (authenticated by signature), `/api/health`
(discloses nothing), and Better Auth's own endpoints.

**Defence in depth (§55), and an honest statement of what each layer is worth:**

| Layer | Strength | Note |
|---|---|---|
| `src/proxy.ts` cookie check | **Weak by design** | Optimistic only; does not verify the session against the database. If deleted, the app remains secure. |
| `requireUser()` in the route | **Strong** | Verifies the session, re-reads role and deletion state from the database rather than trusting the session payload. |
| `requireOwned()` | **Strong** | Ownership in the WHERE clause. |
| Query scoping | **Strong** | `userId` in every user-owned query, including writes that already passed an ownership check. |

The proxy is deliberately not load-bearing. It exists so that a signed-out
browser gets a redirect instead of a JSON 401, and so that security headers are
applied uniformly.

**404 uniformity.** Not-found and not-yours return the same status *and the same
body*, asserted byte-for-byte by test. Distinguishing them confirms an id exists.

**Roles (§35).** Two: `USER` and `ADMIN`. Read from the database server-side on
every request. **No admin UI exists** — the strongest possible control on §34's
concern that administrators should not casually reach raw financial data. If a
support tool is built later it must be metadata-only.

---

## 5. Plaid security

| Concern | Implementation |
|---|---|
| Read-only forever (§1) | Product list is `[Transactions]` only. No Auth, Transfer, Payment Initiation or Signal. |
| `client_user_id` (§8) | `User.plaidUserRef` — an opaque `mu_<32 hex>` value. Never the email, name or phone. |
| OAuth redirect (§8, §19) | From an application-controlled allowlist. The browser never supplies it. |
| Token storage (§9) | AES-256-GCM, key in the environment, key generation recorded per row. |
| Token exposure | One `userId`-scoped accessor produces plaintext. Every response uses an explicit `select` omitting the ciphertext. Redaction strips token-shaped values from logs. |
| Webhook verification (§10) | ES256 with **pinned algorithm**, key fetched by `kid`, `iat` freshness bound, constant-time body-digest comparison against the raw bytes. |
| Webhook idempotency | Body fingerprint recorded in `WebhookDelivery`; duplicates acknowledged and dropped; the record is released if processing fails so Plaid's retry is not swallowed. |
| Webhook tenancy | Owner resolved from our database. Nothing in the payload identifies a user. |
| Item states (§11) | `connected`, `login_required`, `consent_expired`, `disconnected`, `revoked`, `error`. Only healthy Items sync. |
| Disconnect (§11) | Revokes at Plaid **first**, while the credential can still be decrypted, then deletes locally. |
| Concurrency (§48) | A conditional-update sync lock with a 15-minute stale release, so a webhook, a manual refresh and a page load cannot race the cursor. |

**Why encrypt when the database provider encrypts disks?** Disk encryption
protects against someone taking the hardware. It does nothing against a leaked
read-only connection string, a stray backup, or a query that reaches the table.

**Not verified:** a genuine Plaid signature has never been checked end-to-end —
only forgeries, which are correctly rejected. LB-4.

---

## 6. AI security

**Single entry point:** `src/lib/ai/guard.ts`. Everything that talks to Claude
goes through it.

- **No tools.** The model receives no tool definitions, so it cannot query the
  database, call an API, or reach the network. This is the structural reason
  prompt injection cannot become data exfiltration.
- **Explicit projection.** The snapshot is assembled field by field. No Prisma
  row is spread into it, so a column added later cannot silently start being
  sent. Asserted by a test that greps the source for bare spreads.
- **Never sent:** Plaid tokens, password hashes, session identifiers, API keys,
  database identifiers, the user's email, the user's name, account numbers.
- **Untrusted delimiting.** Merchant names, descriptions and notes are wrapped in
  `<untrusted_user_data>`, stripped of the delimiter and control characters, and
  length-bounded. The system preamble declares them data.
- **Output is untrusted input.** JSON is parsed defensively; verdicts are
  validated against the caller's own category ids; writes use `userId`-scoped
  `updateMany`, so an injected id matches zero rows.
- **Deterministic actions (§32)** are pattern-matched from the *user's* text.
  The model never chooses an action or supplies its parameters.
- **Cost (§33):** per-user daily budget in the user's own timezone; 5/day for
  unverified accounts vs 60 for verified; a global daily ceiling incremented
  atomically; burst and sustained rate limits; 25s timeouts; per-merchant
  caching. Failure falls back to the rule engine rather than breaking chat.

---

## 7. Application security

| Control | Status |
|---|---|
| **CSP** | Per-request nonce, `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `unsafe-eval` in development only. |
| **`style-src 'unsafe-inline'`** | **Accepted relaxation.** Required by Next's inline style attributes and `next/font`. Permits CSS injection, not script execution. |
| **HSTS** | 2 years, `includeSubDomains`. `preload` deliberately omitted — it is effectively irreversible and should follow a confirmed domain. |
| **Other headers** | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, `X-Frame-Options` (legacy backstop). |
| **CORS** | None configured. Same-origin only. No `Access-Control-Allow-Origin` anywhere; `trustedOrigins` is our origin alone. |
| **CSRF** | SameSite=Lax + origin checking + no mutating GET (asserted by test). |
| **XSS** | 0 uses of `dangerouslySetInnerHTML`. AI output rendered as text. Display URLs https-validated. |
| **SSRF** | The server does not fetch user- or AI-supplied URLs. `guardedFetch` exists, guarded, for narrow future use. |
| **Open redirect** | Relative internal paths only. |
| **Validation** | Zod on every route; `.strict()` objects; bounded strings, numbers, dates and pages; 128 KB body cap. |
| **SQL injection** | Prisma parameterised APIs throughout. **One** `$queryRawUnsafe`, in `scripts/migrate-owner-data.ts`, a fixed string with no interpolation, reading a legacy column Prisma no longer models. Justified in a code comment. `$executeRawUnsafe`: 0. |
| **Rate limiting** | Database-backed, per-user and per-IP, named budgets per risk class. Bare 429 with `Retry-After`. |
| **Error handling** | Generic messages plus a correlation id; detail stays server-side. Asserted absent: stack frames, paths, `PrismaClient`, SQL. |
| **File uploads** | None. Not built (§21). |

---

## 8. Privacy

**Export (§36):** every query scoped by `userId`, every model with an explicit
`select`. Excluded and asserted by test: `accessTokenCipher`, `accessTokenKeyId`,
`password` hashes, session tokens, verification tokens, `plaidUserRef`, internal
rate-limit and webhook bookkeeping.

**Deletion (§37):** confirmed by email; revokes at Plaid first; purges
transactions, holdings, accounts, items, budgets, merchant rules, categories,
folders, goals, properties, settings and sessions in a transaction.

**What survives deletion, and why:** `AuditEvent` rows, with `userId` set to
NULL. They contain no financial data. Destroying the record that an account was
deleted would make the audit trail useless exactly when it matters. Documented
in the Privacy Policy.

**Logging (§12):** covered under TH-19 in the threat model. No analytics vendor
is integrated; if one is added, §39 applies.

---

## 9. Money and time correctness

**Money (§49).** Amounts remain `Float` dollars, matching Plaid and the existing
Metta convention (positive = out, negative = in). What changed is that *every
aggregation* goes through `src/lib/money.ts`, which converts to integer cents,
sums exactly, and converts back once.

Two real bugs were found and fixed by the tests:
- `toCents(1.005)` returned 100, losing a cent, because 1.005 is stored as
  1.00499999999999989. Fixed by normalising the scaled value before rounding.
- `Math.round(-0.5)` is `-0`, so credits and debits rounded asymmetrically.
  Fixed by rounding the magnitude and reapplying the sign.

**Residual risk, stated plainly:** a single stored value can still be a float
that is not exactly representable. Reads are rounded to the cent, so the error
is bounded at a half-cent per row and does not compound across a sum. Migrating
to integer minor units in the database would remove even that, at the cost of
touching every screen. **Accepted, documented, not hidden.**

**Time (§50).** All storage is UTC. Every user-facing boundary — months, weeks,
"today" for AI budgets — is computed in the user's IANA timezone using `Intl`,
not hand-rolled offsets. Tested across a DST transition and a year boundary.

---

## 10. Dependency findings

`npm audit`: **3 high**, 0 critical (was 4; `nanoid` fixed by `npm audit fix`).

| Advisory | Package | Path | Assessment |
|---|---|---|---|
| GHSA-2v37-7h3g-55p8 (infinite loop when size is 0) | `nanoid` | `postcss` → `next`, `@tailwindcss/postcss` | **Fixed.** Patched in place; no code here calls it with a zero size. |
| DeepmergeTS stack exhaustion | `deepmerge-ts` | `@prisma/client` → `prisma` → `@prisma/config` | **Open, no fix available.** See below. |

On the remaining advisory, the earlier assessment above was imprecise and is
corrected here:

* It is **in the production dependency tree**, not only the dev tree —
  `@prisma/client` (a runtime dependency) depends on `prisma`, which depends
  on `@prisma/config`. The previous "build-time only" wording was wrong at the
  dependency level.
* It is nevertheless **not bundled into the served application**. Checking the
  built output: `deepmerge-ts` appears in no built JavaScript file, and the
  only occurrence of `@prisma/config` is a version string inside a package
  metadata blob in the generated client — not a require. The vulnerable code
  path is the Prisma CLI's config-file merger, reached only when the CLI reads
  `prisma.config.ts`, a file the operator controls.
* **There is no fixed release to upgrade to.** The advisory covers
  `deepmerge-ts <8.0.0`, and the current Prisma 7.10.0 still pins 7.1.5.
  `npm audit fix --force` proposes *downgrading* Prisma 6.19.3 → 6.12.0, which
  is both older and incompatible with this schema. Downgrading was rejected.

**Not a launch blocker**, for the reasons above, and the judgement is recorded
so it can be challenged. Re-check when Prisma ships a release depending on
`deepmerge-ts >= 8`.

Supply-chain posture: lockfile committed; CI uses `npm ci`; no JWT library (Node
crypto); no email SDK (`fetch`); `npm audit --audit-level=high` blocks CI.

### Secrets in git history

`npm run audit:secrets` checks the working tree, which is the wrong question
for a credential: removing a secret from HEAD does not remove it from the
repository. `npm run audit:secrets:history` walks every blob in every ref.
Neither tool ever prints a matched value.

**This repository (`Orbital`) is clean:** 9 commits, 537 blobs, no credential.
The only matches are documented placeholders (`.env.example` templates) and
deliberately fake test fixtures. No `.env` file has ever been committed, and
`.env*` is gitignored.

**The predecessor repository is not.** `rolonbeto1-spec/bull-trader`, the
single-user application this rebuild came from, committed a real `.env`:

| | |
|---|---|
| Added | commit `1fa2ee2`, 2026-04-29, *"Add API keys for Alpaca paper trading"* |
| Removed | commit `db04748`, 2026-08-11 |
| Exposed | `ALPACA_API_KEY` (live key-id shape), `ALPACA_SECRET_KEY`, `FINNHUB_API_KEY` |
| Still in history | **Yes** — permanently, in every clone and fork |

The values are deliberately not reproduced here, in this or any other
document.

Assessment: these are **market-data and paper-trading credentials, not
banking, Plaid, or Metta credentials**. Metta does not use them; the trading
feature they belonged to was deleted. So they are not a route into any user's
financial data, and they are **not a launch blocker for Metta**.

**Rotation is nonetheless mandatory**, and is not optional because the keys
were removed from HEAD. They were public for roughly three and a half months
and remain readable in the history of every clone. Treat them as compromised:

1. Revoke and reissue the Alpaca key pair and the Finnhub key in those
   providers' dashboards.
2. Do this even if the Alpaca account is paper-trading only — the same
   credentials often carry over to a live account, and the key-id shape
   recorded above cannot be assumed to be paper-only.
3. Rewriting `bull-trader`'s history is *not* a substitute for rotation and
   should not be used as one. Assume anything ever pushed has been read.

Tracked as a mandatory item in `PRODUCTION_LAUNCH_CHECKLIST.md` and
`SECRET_ROTATION.md`.

---

## 11. Static review (§63)

Scanned `src/`, `scripts/`, `prisma/` (excluding generated code):

| Pattern | Hits | Assessment |
|---|---|---|
| `dangerouslySetInnerHTML` | 0 | — |
| `eval(` / `new Function` | 0 | — |
| `child_process` | 2 | `scripts/vercel-build.js`, `scripts/scan-secrets.js`. Build tooling, fixed commands, no user input. |
| `$queryRawUnsafe` | 1 | Owner migration script. Fixed string, no interpolation. Justified in place. |
| `$executeRawUnsafe` | 0 | — |
| `NEXT_PUBLIC_` | 3 | All comments or the scanner's own pattern. **No `NEXT_PUBLIC_*` variable exists.** |
| `accessToken` | 54 | All in server-only Plaid modules, plus comments in the export route naming what is excluded. |
| `PLAID_SECRET` / `ANTHROPIC_API_KEY` | 10 | `env.ts` schema, `plaid.ts` client config, presence checks, one user-facing message that names the variable. |
| `console.log` | 48 | Operator scripts (37), the logger's own implementation (3), and one dev-only mail path with an explicit lint exemption. **Zero in shipped application code.** |
| `innerHTML`, `localStorage` | 0 | — |

**Client bundle audit (§54):** across 26 built chunks, zero occurrences of
`PrismaClient`, `createDecipheriv`, any secret variable name, or any
server-only module. `server-only` markers are on every module holding Prisma,
Plaid, encryption or auth — and the fact that the test suite needed a stub for
that package is itself evidence the guard is real.

**Git history (§28):** all 97 commits of the source repository scanned. The only
match is a placeholder (`sk-ant-your-key-here`) in the README. **No real
credential has ever been committed.**

---

## 12. Automated tests

134 passing. All against a real database — Prisma is never mocked, because a
mocked client would prove nothing about whether the real queries are scoped.

| Suite | Tests | Covers |
|---|---|---|
| `tenant-isolation` | 50 | Cross-tenant read/write/delete/sync/export, cross-tenant foreign keys, predictable ids, 404 uniformity, unauthenticated/revoked/deleted/unverified sessions, cache isolation |
| `security-controls` | 32 | Validation, rate limits, CSRF shape, redirects, SSRF, webhook signatures, log redaction, error shape |
| `crypto-money-time` | 30 | AES-GCM, tamper detection, rotation, integer-cent math, reimbursements, DST |
| `ai-isolation` | 22 | Injection, no tools, cross-tenant verdicts, budgets, degradation |

---

## 13. Known unresolved risks

1. **No independent security review.** The most important item on this list.
2. **MFA not enabled.** Architecture supports it; the plugin is not turned on.
3. **No CAPTCHA or bot protection.** Distributed credential stuffing would evade
   IP-based limits.
4. **Genuine Plaid webhook signature never verified end-to-end.**
5. **No load testing.** Limits are reasoned, not measured.
6. **Sign-up timing side channel** unmeasured.
7. **`style-src 'unsafe-inline'`** retained.
8. **Float money storage** retained, with bounded error.
9. **Supply chain** largely unmitigated beyond audit and lockfile.
10. **Rate limiter fails open** if the database is unreachable. Deliberate — a
    database blip should not lock every user out — but it means limits are not
    available during a database incident. Auth endpoints do not depend on it.
11. **Known non-security lint warnings** in inherited UI components
    (`react-hooks/static-components` false positives on icon lookup,
    `set-state-in-effect` in three data-loading components). Downgraded to
    warnings with recorded reasons; owned by the design pass.

---

## 14. Manual configuration required

See METTA_PRODUCTION_HANDOFF.md §16 for step-by-step instructions.

Summary: generate and set `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY_V1`;
configure Resend and verify a sending domain; set the Plaid webhook URL and
OAuth redirect URI in the Plaid dashboard; confirm Vercel Deployment Protection
stays **off** for production and **on** for previews; enable WAF/bot protection;
confirm Neon point-in-time recovery and test a restore; enable GitHub branch
protection, secret scanning and Dependabot.

---

## 15. Launch blockers

Public registration must remain **disabled** until the items in
PRODUCTION_LAUNCH_CHECKLIST.md marked as blockers are cleared. The code ships
with `PUBLIC_SIGNUP_ENABLED=false`.

---

## 16. Limitations of this review

This review was written by the same author who wrote the code. That is a
structural conflict: an author is the worst-placed person to notice their own
blind spots, and no amount of internal testing corrects for it.

What this review is: an accurate account of what was built, what was tested, and
what is known to be weak.

What it is not: an assurance that the application is free of vulnerabilities. It
is not a penetration test, not a compliance certification, and not a substitute
for either. **Metta should not be described as "secure" on the strength of this
document.** An independent human security review is recommended before
meaningful user adoption (§77).
