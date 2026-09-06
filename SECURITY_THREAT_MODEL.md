# Metta — Security Threat Model

**Status:** written alongside the multi-tenant rebuild. Reflects the code in
this repository, not an aspiration.
**Scope:** the Metta web application, its database, and its integrations with
Plaid, Anthropic and the email provider.
**Not in scope:** the security of Plaid, Anthropic, Vercel or Neon themselves;
the user's own device; the user's bank.

A note on tone: where a mitigation is partial, this document says so. "Verified
by" names an automated test where one exists, because a control nobody tests is
a control nobody knows works.

---

## 1. Assets

Ranked by what an attacker would most want, and what would hurt most to lose.

| # | Asset | Why it matters |
|---|---|---|
| A1 | **Plaid access tokens** | A stolen token gives read access to a real person's bank feed, independent of Metta. The highest-value asset in the system. |
| A2 | **Financial data** — transactions, balances, merchants | Directly sensitive. Reveals income, health, location, relationships and habits. |
| A3 | **User accounts and sessions** | Account takeover yields A2 and the ability to connect or remove banks. |
| A4 | **Anthropic API key** | Direct financial cost if stolen; unbounded spend. |
| A5 | **Database credentials** | Yields A2 in bulk, and A1 in encrypted form. |
| A6 | **Auth signing secret** | Forged sessions for any user. |
| A7 | **Token encryption keys** | Combined with A5, yields A1 in plaintext. |
| A8 | **Email provider credentials** | Password-reset interception, phishing from a trusted domain. |
| A9 | **Admin capability** | Elevated access across tenants. |
| A10 | **User privacy expectations** | Reputational and regulatory; a breach here is not undoable. |

**Deliberately not an asset:** bank usernames and passwords. Metta never
receives them — they are entered directly with Plaid. This is a design property,
not a control that could fail.

---

## 2. Attackers

| # | Attacker | Capability | Motivation |
|---|---|---|---|
| T1 | **Anonymous internet attacker** | Can reach every public endpoint, can register (once signup opens), can automate | Bulk financial data, resale, extortion |
| T2 | **Malicious registered user** | A valid session, full knowledge of the API surface, can enumerate ids | Other tenants' financial data |
| T3 | **Compromised user account** | Everything the real user has | Data theft, fraud reconnaissance |
| T4 | **Automated bot / credential stuffer** | High volume, reused credential lists, no interactivity | Account takeover at scale, AI-cost abuse |
| T5 | **Malicious website (CSRF / clickjacking)** | Can cause a victim's browser to issue requests or render Metta in a frame | Unwanted state changes |
| T6 | **Compromised dependency** | Arbitrary code in the build or at runtime | Everything |
| T7 | **Insider / administrator** | Legitimate infrastructure access | Curiosity or abuse of raw financial data |
| T8 | **Prompt injector** | Controls a merchant string that reaches the model — often the *bank*, not the user | Making the AI leak or act |

T8 deserves emphasis because it is the least intuitive: a transaction
description is attacker-influenced text that Metta did not author and the user
did not type.

---

## 3. Trust boundaries

```
                 ┌─────────────────────────────────────────┐
   (T1,T4,T5)    │            Browser (untrusted)          │
  ───────────────▶  React UI · session cookie (HttpOnly)   │
                 └───────────────────┬─────────────────────┘
                                     │ B1: HTTPS, same-origin
                 ┌───────────────────▼─────────────────────┐
                 │      Metta server (Next.js, Node)       │
                 │  proxy gate → route auth → ownership    │
                 └──┬──────────┬──────────┬──────────┬─────┘
              B2 │       B3 │       B4 │       B5 │      B6 │
        ┌─────────▼──┐ ┌─────▼────┐ ┌──▼──────┐ ┌─▼──────┐ ┌▼────────┐
        │  Postgres  │ │  Plaid   │ │Anthropic│ │  Auth  │ │  Email  │
        │  (Neon)    │ │          │ │         │ │ (in-DB)│ │ (Resend)│
        └────────────┘ └──────────┘ └─────────┘ └────────┘ └─────────┘
```

| Boundary | What crosses it | Control |
|---|---|---|
| **B1** Browser ↔ Metta | Session cookie, JSON | HTTPS/HSTS, HttpOnly + SameSite cookies, CSP, origin checks, per-user rate limits |
| **B2** Metta ↔ Database | SQL via Prisma | Parameterised queries only; every user-owned query carries `userId`; tokens stored encrypted |
| **B3** Metta ↔ Plaid | Access tokens, transactions | Server-side only; tokens encrypted at rest; webhooks verified by signature |
| **B4** Metta ↔ Anthropic | A financial summary of one user | Explicit projection; no credentials; no tools given to the model |
| **B5** Metta ↔ Auth | Passwords, sessions | Better Auth (scrypt, expiring tokens, revocable sessions); no custom crypto |
| **B6** Metta ↔ Email | Address, links | Single validated recipient; no financial content in any message |

The authentication provider is self-hosted (Better Auth runs in-process against
our own database), so B5 is an internal boundary rather than a third party.

---

## 4. Threats

Format per §60: threat · impact · mitigation · verification test · residual risk.

### TH-1 — Cross-tenant data access (IDOR)
- **Attacker:** T2 · **Assets:** A2
- **Threat:** A signed-in user requests another user's transaction, account,
  budget, goal, folder, property or bank connection by id.
- **Impact:** Complete disclosure of another person's financial life. The single
  worst outcome available to a registered attacker.
- **Mitigation:** Ownership is part of the SQL `WHERE` clause, never a check
  performed after the fetch (`src/lib/security/ownership.ts`). Every list query
  is scoped with `userId`. Client-supplied filters are ANDed with the scope, so
  naming another tenant's object yields an empty result. Foreign keys supplied
  in a request body (`categoryId`, `folderId`) are ownership-checked before use.
  Missing and not-yours return an identical 404 with an identical body.
- **Verification test:** `tests/tenant-isolation.test.ts` — 50 tests using User
  B's **real** ids against every route, plus predictable-id probes and a test
  asserting the 404 responses are byte-identical.
- **Residual risk:** A future route that queries Prisma directly without the
  helpers would not be covered. Mitigated by convention and review, not
  mechanically. **Recommend** adding a lint rule that flags `findUnique` on
  owned models.

### TH-2 — Unauthenticated access to financial endpoints
- **Attacker:** T1 · **Assets:** A2
- **Impact:** Bulk disclosure without even registering.
- **Mitigation:** Default-deny. `route()` requires authentication unless a
  handler explicitly opts out, and only three endpoints do: the Plaid webhook
  (authenticated by signature), the health check (which discloses nothing), and
  the auth endpoints themselves.
- **Verification test:** `tests/tenant-isolation.test.ts` asserts 401 across 16
  protected routes with no session; also covers a session naming a deleted
  user, a soft-deleted account, and an unverified account.
- **Residual risk:** Low.

### TH-3 — Plaid access token theft
- **Attacker:** T1 with A5, T6, T7 · **Assets:** A1
- **Impact:** Ongoing read access to a real bank feed, usable entirely outside
  Metta. Not fixable by resetting a password.
- **Mitigation:** AES-256-GCM application-layer encryption with the key held in
  the environment, not the database (`src/lib/security/crypto.ts`) — so a leaked
  database URL or a stray backup is not sufficient. Exactly one function can
  produce a plaintext token and it requires a `userId`. Every API response uses
  an explicit `select` that omits the ciphertext. The redaction layer strips
  Plaid-token-shaped strings from logs by value as well as by key name.
- **Verification test:** `tests/crypto-money-time.test.ts` (round-trip, unique
  nonce, tamper detection, rotation); `tests/tenant-isolation.test.ts` asserts
  the export contains no token and that another tenant cannot decrypt one.
- **Residual risk:** An attacker with **both** the database and the environment
  gets plaintext. That is inherent to server-side encryption without an HSM.
  **Accepted**, and the reason INCIDENT_RESPONSE.md treats a leaked key and a
  leaked database as one incident.

### TH-4 — Forged Plaid webhooks
- **Attacker:** T1 · **Assets:** A2 (indirectly)
- **Threat:** Posting crafted webhooks to trigger syncs, mark Items broken, or
  cause resource exhaustion.
- **Mitigation:** ES256 JWT verification against Plaid's published key, with the
  algorithm **pinned** (so `alg: none` and HMAC-confusion both fail), a
  freshness bound on `iat`, and a constant-time comparison of the body digest
  against the exact bytes received. Deliveries are fingerprinted for idempotency.
  The owning user is resolved from our database; nothing in the payload is
  trusted to identify a user.
- **Verification test:** `tests/security-controls.test.ts` — unsigned, malformed,
  `alg:none`, `alg:HS256` and tampered-body cases all rejected; an unverified
  webhook naming a real Item leaves that Item's status unchanged.
- **Residual risk:** Verification depends on reaching Plaid to fetch the key.
  A fetch failure fails **closed** (rejects), which is correct but means a Plaid
  outage delays webhook processing. Sync also runs on user action, so data is
  not lost.

### TH-5 — Prompt injection via merchant names
- **Attacker:** T8 · **Assets:** A2
- **Threat:** A transaction description containing `IGNORE YOUR INSTRUCTIONS…`
  reaching the model as if it were an instruction.
- **Impact:** In the worst case an LLM that has tools becomes a data-exfiltration
  path. Here, bounded — see mitigation.
- **Mitigation:** Layered, and the layers are not equally strong:
  1. *Structural (strong).* The model is given **no tools**. It cannot query the
     database, call an API, or reach the network. A fully successful injection
     can only make it produce wrong text.
  2. *Authorization (strong).* Every prompt is built from a single tenant's
     already-scoped data. There is no cross-tenant data in the context to leak.
  3. *Output validation (strong).* Verdicts are validated against the caller's
     own category ids and written with `userId`-scoped `updateMany`, so an
     injected id matches zero rows.
  4. *Delimiting (weak, defence in depth).* Untrusted strings are wrapped in
     `<untrusted_user_data>` tags, stripped of the delimiter and control
     characters, and the system prompt declares them data.
- **Verification test:** `tests/ai-isolation.test.ts` — delimiter-escape attempt,
  a hostile merchant name stored and rendered through the real path, absence of
  tools, and a cross-tenant verdict writing zero rows.
- **Residual risk:** Layer 4 is **not reliable** and is not treated as such. The
  guarantee rests on layers 1–3. An injection could still produce misleading
  financial advice to the user, which is a correctness problem rather than a
  disclosure one.

### TH-6 — Credential stuffing and brute force
- **Attacker:** T4 · **Assets:** A3
- **Mitigation:** scrypt hashing (Better Auth); 12-character minimum; per-route
  rate limits on sign-in (8 per 5 minutes), signup, reset and verification
  resend, stored in the database so they survive serverless cold starts.
- **Verification test:** `tests/security-controls.test.ts` covers the limiter's
  429 behaviour, per-user separation and persistence.
- **Residual risk:** No CAPTCHA and no device fingerprinting. A distributed,
  low-and-slow attack across many IPs would evade IP limits. **Launch blocker
  LB-6** recommends enabling Vercel WAF/bot protection before public signup.

### TH-7 — Account enumeration
- **Attacker:** T1, T4 · **Assets:** A10
- **Mitigation:** Sign-up with an existing address returns a synthetic success
  and emails the real account holder instead. Password reset and verification
  resend return a fixed neutral message regardless of outcome. Sign-in gives one
  message for every failure. Not-found and not-yours are identical 404s.
- **Verification test:** `tests/tenant-isolation.test.ts` asserts identical
  status *and* body for a real-but-foreign id versus a nonexistent one.
- **Residual risk:** **Timing.** Sign-up with an existing address does slightly
  more work (it sends a notification) than one with a new address. Better Auth
  runs that notification as a background task, but the timing side channel is
  not measured. **Documented, not eliminated.**

### TH-8 — CSRF
- **Attacker:** T5 · **Assets:** A2, A3
- **Mitigation:** Session cookies are `SameSite=Lax`, so a cross-site POST does
  not carry them. Better Auth performs origin checking on state-changing auth
  requests (`disableCSRFCheck` is left off). No mutating endpoint answers GET.
- **Verification test:** `tests/security-controls.test.ts` asserts that nine
  mutating route modules export no `GET`, and that the alert-preferences GET
  writes nothing.
- **Residual risk:** `SameSite=Lax` permits top-level cross-site GET navigation.
  Since no GET mutates, this is not exploitable here.

### TH-9 — Clickjacking
- **Attacker:** T5 · **Mitigation:** CSP `frame-ancestors 'none'` plus
  `X-Frame-Options: DENY`. Plaid Link renders in an iframe *Metta* owns, not the
  reverse, so no exception is needed.
- **Verification:** Header assertions in `src/proxy.ts`; **manual browser check
  outstanding** — see LB-9.

### TH-10 — XSS
- **Attacker:** T2, T8 · **Assets:** A3
- **Mitigation:** No `dangerouslySetInnerHTML` anywhere in the codebase (0 hits,
  §63 scan). React escapes by default. AI output is rendered as text. Merchant
  logo URLs are validated as https before storage, so a `javascript:` URL cannot
  reach an `href` or `src`. CSP has no `unsafe-inline` for scripts.
- **Verification test:** `tests/security-controls.test.ts` stores an XSS payload
  and asserts it round-trips inertly; `url-guard` tests reject `javascript:` and
  `data:` display URLs.
- **Residual risk:** `style-src` retains `'unsafe-inline'`, required by Next's
  inline style attributes and `next/font`. This permits CSS injection, not script
  execution. **Accepted and documented.**

### TH-11 — SSRF
- **Attacker:** T2, T8 · **Assets:** A5, cloud metadata
- **Threat:** Making the server fetch an internal URL — classically
  `169.254.169.254` for cloud credentials — via a merchant logo or an
  AI-suggested cancellation link.
- **Mitigation:** **The server does not fetch these URLs at all.** Logos and
  cancellation links are stored and rendered by the browser. For the narrow
  cases where a server fetch could be needed, `guardedFetch` enforces
  https-only, default-port-only, no credentials in the URL, resolution of every
  address with private/loopback/link-local rejection, `redirect: "manual"` with
  per-hop re-validation, a 5-second timeout and a size cap.
- **Verification test:** `tests/security-controls.test.ts` — 16 blocked URLs
  including cloud metadata, RFC1918, loopback, `.internal`, non-https schemes
  and non-standard ports.
- **Residual risk:** Low, because the capability is essentially unused.

### TH-12 — Open redirect
- **Attacker:** T5 · **Mitigation:** Only relative internal paths are accepted;
  schemes, protocol-relative `//host`, backslash variants and CR/LF are all
  rejected, and the result is normalised through `URL` to collapse `..`.
- **Verification test:** 10 hostile candidates rejected, in
  `tests/security-controls.test.ts`.

### TH-13 — AI cost abuse
- **Attacker:** T1, T4 · **Assets:** A4
- **Mitigation:** Per-user daily budget in the *user's own* timezone; a much
  smaller budget for unverified accounts (5 vs 60); a global daily ceiling across
  all tenants incremented atomically; per-route burst and sustained rate limits;
  input length caps; 25s timeouts with one retry; per-merchant caching so a
  merchant costs tokens once.
- **Verification test:** `tests/ai-isolation.test.ts` — per-user exhaustion,
  per-user separation, the shared global counter, and the unverified ceiling.
- **Residual risk:** The global ceiling is a blunt instrument: once exhausted,
  every user loses AI for the day. Acceptable — it fails to the rule engine
  rather than failing the app.

### TH-14 — Cache leakage between users
- **Attacker:** T1, T2 · **Assets:** A2
- **Threat:** A CDN or a shared server cache serving one user's balances to
  another. Historically one of the most damaging bugs in this class of app.
- **Mitigation:** Every authenticated response carries
  `Cache-Control: private, no-store` and `Vary: Cookie`, set both in `safeJson`
  and as a `next.config.ts` backstop. Every data route is `force-dynamic`.
  `getCurrentUser` uses React `cache`, which is per-request, not shared.
- **Verification test:** `tests/tenant-isolation.test.ts` alternates users
  through the same handler and asserts each gets their own data, plus header
  assertions.
- **Residual risk:** A CDN misconfigured at the platform level could override
  this. **LB-10** requires confirming no edge caching rule applies to `/api/*`.

### TH-15 — Compromised dependency
- **Attacker:** T6 · **Assets:** everything
- **Mitigation:** Committed lockfile; CI installs with `npm ci`; `npm audit`
  blocks on high and critical; secret scanning in CI; the email integration uses
  `fetch` rather than adding a package; no JWT library (Node's crypto verifies
  the webhook signature directly).
- **Residual risk:** **Real and unmitigated in the general case.** A compromised
  transitive dependency executing at runtime would defeat every control here.
  Recommend enabling Dependabot and GitHub secret scanning (LB-11).
- **Known finding:** 4 high-severity advisories at the time of writing, all in
  build-time tooling (`deepmerge-ts` via `@prisma/config`, `nanoid`). Not in a
  runtime request path. See SECURITY_REVIEW.md.

### TH-16 — Insider / administrator access to financial data
- **Attacker:** T7 · **Assets:** A2
- **Mitigation:** Two roles only (`USER`, `ADMIN`), checked server-side from the
  database on every request, never from a cookie or token claim. **No admin UI
  exists**, which is the strongest available control: there is no interface
  through which an administrator can browse another person's finances.
- **Residual risk:** Anyone with direct database access can read everything
  except Plaid tokens. Inherent. Mitigated operationally by restricting who
  holds database credentials, and by the audit trail. If a support tool is ever
  built, it must be metadata-only (§34).

### TH-17 — Session theft / fixation
- **Attacker:** T3 · **Mitigation:** HttpOnly (JavaScript cannot read the
  cookie), Secure in production, SameSite=Lax, 30-day expiry with rolling
  refresh, server-side session table so revocation is immediate. Cookie-cached
  sessions are deliberately **disabled** so a revoked session stops working at
  once rather than up to five minutes later. Password reset revokes all other
  sessions.
- **Verification test:** Deleted-user and soft-deleted-account sessions are both
  denied, in `tests/tenant-isolation.test.ts`.

### TH-18 — Resource exhaustion
- **Attacker:** T2, T4 · **Mitigation:** Pagination capped at 200; search text
  capped at 80 characters and used as a parameterised `LIKE`, never a regex
  (no ReDoS); every aggregation bounded (5,000 rows; 50,000 for export); date
  windows validated; expensive endpoints on their own rate-limit budgets;
  per-user row caps on goals, folders and properties.
- **Verification test:** Validation tests reject oversized pages, long searches
  and huge bodies.
- **Residual risk:** No load testing has been performed. **LB-12.**

### TH-19 — Accidental disclosure through logs
- **Attacker:** T7, T6 · **Assets:** A1, A2
- **Threat:** The commonest real-world leak — `console.error("failed", err, item)`
  putting a token and a balance into a log aggregator that far more people can
  read than can read the database.
- **Mitigation:** A structured logger with **no** raw-object escape hatch;
  redaction by key name (secrets, financial fields, PII) *and* by value shape
  (Plaid, Anthropic, Resend, JWT, connection-string and email patterns);
  depth, array and string bounds; ESLint blocks `console.*` outside the logger.
  Plaid errors are logged by error **code** only, because Plaid's error bodies
  echo the request — including the access token.
- **Verification test:** `tests/security-controls.test.ts` asserts that tokens,
  balances, merchants, notes, emails and connection strings are all absent from
  redacted output.

### TH-20 — Demo data appearing in a real account
- **Attacker:** none — a self-inflicted wound · **Assets:** A10
- **Threat:** The previous app seeded demo transactions whenever it found an
  empty database. In a multi-tenant product that means a real user could open
  the app and see fabricated money.
- **Mitigation:** **Removed from the application entirely.** Nothing in `src/`
  imports the seed. `prisma/seed.ts` is a development tool that creates one
  explicit demo user, owns every row to them, and refuses to run against
  Postgres, on Vercel, or with Plaid credentials present.
- **Residual risk:** None in the application path.

---

## 5. Threats explicitly out of scope

| Threat | Why |
|---|---|
| Money movement / fraudulent transfers | Structurally impossible: Metta requests only Plaid's `transactions` product. There is no code path that can move money. |
| Bank credential theft from Metta | Metta never receives them. |
| Email account compromise via Metta | Metta never holds email credentials; the cancellation helper produces a draft the user sends themselves. |
| Physical / datacenter security | Delegated to the hosting and database providers. |

---

## 6. Where this model is weakest

Stated plainly, because a threat model that only lists successes is not useful:

1. **No independent review.** Everything here was designed, implemented and
   tested by the same author. That is a structural weakness no amount of
   internal testing corrects. An external penetration test is required before
   meaningful user adoption (§77).
2. **Prompt-injection delimiting is soft.** Containment rests on the model
   having no authority, not on the delimiters holding.
3. **Supply chain is largely unmitigated.** Standard for this stack, and still
   true.
4. **No load or DoS testing.** Limits are reasoned about, not measured.
5. **Timing side channels are unmeasured**, particularly around sign-up.
6. **The webhook signature path has not been exercised against real Plaid
   traffic** — only against forgeries, which it correctly rejects. Verifying a
   genuine signature end-to-end requires Plaid credentials and is LB-4.
