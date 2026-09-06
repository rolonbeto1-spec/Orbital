# Metta — OWASP ASVS 5.0 Verification Checklist

**Purpose:** a structured engineering checklist, used as a way to find gaps we
would otherwise miss. Working through a standard is a good forcing function
precisely because it asks about things you did not think of.

**What this is not:** a certification, an audit, or a claim of ASVS compliance.
Compliance is a determination made by a qualified assessor against evidence they
gather themselves. This document was produced by the engineer who wrote the
code (§61: *"Do not claim ASVS compliance simply because an AI reviewed the
source code."*).

**Target level:** L2. Metta handles sensitive financial data, so L1 is too weak;
L3 assumes formal secure-development process and independent verification that
this project does not have.

**Legend**
- **PASS** — implemented, and named evidence exists.
- **PARTIAL** — implemented with a stated limitation.
- **FAIL** — not implemented. Every FAIL below is either fixed or listed as a
  launch blocker.
- **N/A** — not applicable, with the reason given.

---

## V1 — Encoding and sanitization

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1.1 | Output encoding for HTML context | **PASS** | React escapes by default; 0 uses of `dangerouslySetInnerHTML` (§63 scan) |
| 1.2 | No dynamic code execution | **PASS** | 0 hits for `eval(`, `new Function`; ESLint blocks them |
| 1.3 | SQL injection prevented | **PASS** | Prisma parameterised APIs; 1 justified `$queryRawUnsafe` (fixed string, no input) in a migration script; 0 `$executeRawUnsafe` |
| 1.4 | OS command injection prevented | **PASS** | `child_process` only in build scripts, fixed commands, no user input |
| 1.5 | SSRF prevented | **PASS** | Server does not fetch user/AI URLs; `guardedFetch` blocks private ranges, non-https, redirects. 16 blocked cases tested |
| 1.6 | LDAP / XPath / template injection | **N/A** | None used |
| 1.7 | Untrusted data in AI prompts is delimited | **PARTIAL** | Delimited and stripped, but delimiting is not a reliable control — containment comes from the model having no tools (TH-5) |

## V2 — Validation and business logic

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 2.1 | Positive validation on all input | **PASS** | Zod on every route; `tests/security-controls.test.ts` |
| 2.2 | Unexpected properties rejected | **PASS** | `.strict()` on every object schema; tested with a smuggled `userId` |
| 2.3 | Length and range bounds | **PASS** | Strings, amounts, dates, pagination all bounded |
| 2.4 | Request size limits | **PASS** | 128 KB cap, 413 before parsing. Tested |
| 2.5 | Business-logic limits enforced server-side | **PASS** | Reimbursement capped at the amount spent; per-user row caps on goals/folders/properties |
| 2.6 | Numeric correctness for money | **PASS** | Integer-cent arithmetic; 30 tests including 10,000-addition drift and DST |
| 2.7 | Anti-automation on sensitive functions | **PARTIAL** | Rate limits yes; CAPTCHA/bot protection no (LB-6) |

## V3 — Web frontend security

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 3.1 | CSP present and restrictive | **PARTIAL** | Nonce + `strict-dynamic`; `style-src 'unsafe-inline'` retained (documented) |
| 3.2 | `frame-ancestors` set | **PASS** | `'none'` + `X-Frame-Options: DENY` |
| 3.3 | `X-Content-Type-Options: nosniff` | **PASS** | proxy + next.config |
| 3.4 | Referrer-Policy set | **PASS** | `strict-origin-when-cross-origin` |
| 3.5 | Cookies HttpOnly/Secure/SameSite | **PASS** | Better Auth `defaultCookieAttributes` |
| 3.6 | CSRF defence on state changes | **PASS** | SameSite=Lax + origin checks + no mutating GET (tested) |
| 3.7 | CORS not permissive | **PASS** | No CORS headers; `trustedOrigins` is our origin only |
| 3.8 | Unvalidated redirects prevented | **PASS** | Internal relative paths only; 10 hostile cases tested |
| 3.9 | Sensitive responses not cached | **PASS** | `private, no-store`, `Vary: Cookie`; tested |

## V4 — API and web service

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 4.1 | Authentication on every non-public endpoint | **PASS** | Default-deny in `route()`; 16 routes tested for 401 |
| 4.2 | HTTP methods restricted appropriately | **PASS** | No mutating GET; webhook returns 405 on GET |
| 4.3 | Consistent error format without internals | **PASS** | Generic message + correlation id; tested absent: stack, path, SQL |
| 4.4 | Rate limiting per endpoint risk | **PASS** | Named budgets; DB-backed; tested |
| 4.5 | Content-Type validated | **PASS** | JSON parsed defensively; malformed → 400 |

## V5 — File handling

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 5.x | File upload controls | **N/A** | Metta has no upload feature and none was added (§21) |

## V6 — Authentication

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 6.1 | Passwords hashed with an approved KDF | **PASS** | scrypt (Better Auth) |
| 6.2 | Minimum length ≥ 12 | **PASS** | `minPasswordLength: 12` |
| 6.3 | No composition rules that reduce entropy | **PASS** | Length only |
| 6.4 | Credential recovery is secure | **PASS** | Single-use, 1-hour expiry, revokes other sessions |
| 6.5 | No account enumeration | **PARTIAL** | Neutral responses everywhere; timing unmeasured (TH-7) |
| 6.6 | Brute-force protection | **PARTIAL** | Rate limits yes; no CAPTCHA (LB-6) |
| 6.7 | MFA available | **FAIL** | Not enabled. **LB-3** |
| 6.8 | Email verification before privileged use | **PASS** | `requireEmailVerification: true`; 403 tested |

## V7 — Session management

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 7.1 | Sessions generated by the framework, not custom | **PASS** | Better Auth; the hand-rolled HMAC token was deleted |
| 7.2 | Session tokens not in URLs or storage | **PASS** | HttpOnly cookie only; 0 `localStorage` hits |
| 7.3 | Idle/absolute timeout | **PASS** | 30-day expiry, refreshed daily |
| 7.4 | Logout invalidates server-side | **PASS** | Server-side session table |
| 7.5 | Revocation takes effect immediately | **PASS** | Cookie caching deliberately disabled; tested |
| 7.6 | Sessions bound to the user, re-checked | **PASS** | `getCurrentUser` re-reads role and deletion state each request |

## V8 — Authorization

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 8.1 | Default deny | **PASS** | `route()` requires auth unless opted out |
| 8.2 | Object-level authorization (IDOR) | **PASS** | Ownership in the WHERE clause; **50 adversarial tests** |
| 8.3 | Authorization enforced server-side only | **PASS** | Role from the database; nothing read from the client |
| 8.4 | Function-level authorization | **PASS** | `requireAdmin()`; two roles |
| 8.5 | Not-found and not-authorized indistinguishable | **PASS** | Identical status and body, tested |
| 8.6 | Multi-tenant isolation | **PASS** | `userId` on every owned model; tested across every route |

## V9 — Self-contained tokens

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 9.1 | JWT algorithm pinned; `none` rejected | **PASS** | Plaid webhook pins ES256; `alg:none` and `alg:HS256` rejected in tests |
| 9.2 | Signature verified before use of claims | **PASS** | Body parsed only after verification |
| 9.3 | Token freshness checked | **PASS** | `iat` bounded to 5 minutes |

## V10 — OAuth and OIDC

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 10.1 | Redirect URIs allowlisted | **PASS** | Plaid OAuth redirect from server allowlist; never from the request |
| 10.2 | Social login | **N/A** | Not enabled. Better Auth supports it when wanted |

## V11 — Cryptography

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 11.1 | Approved algorithms only | **PASS** | AES-256-GCM, SHA-256, ES256 — all Node built-ins |
| 11.2 | No custom cryptography | **PASS** | Nothing invented; hashing and session signing are the library's |
| 11.3 | Authenticated encryption for stored secrets | **PASS** | GCM; tamper detection tested |
| 11.4 | Unique nonce per encryption | **PASS** | 12-byte random IV; uniqueness tested |
| 11.5 | Keys outside the data they protect | **PASS** | Environment, not the database |
| 11.6 | Key rotation supported | **PASS** | Generation recorded per row; rotation script; tested |
| 11.7 | Constant-time comparison of secrets | **PASS** | `timingSafeEqual` |

## V12 — Secure communication

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 12.1 | TLS everywhere | **PASS** | Vercel TLS; HSTS 2 years |
| 12.2 | Outbound calls use TLS | **PASS** | Plaid, Anthropic, Resend all https; `guardedFetch` is https-only |
| 12.3 | HSTS preload | **PARTIAL** | Deliberately not set until the domain is final (LB-9) |

## V13 — Configuration

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 13.1 | Secrets not in source | **PASS** | Secret scanner in CI; 97 commits of history scanned clean |
| 13.2 | Secrets not exposed to the client | **PASS** | No `NEXT_PUBLIC_*` secret; client bundle audited across 26 chunks |
| 13.3 | Startup validation of required config | **PASS** | `assertProductionSecrets()` on first request |
| 13.4 | Framework version not disclosed | **PASS** | `poweredByHeader: false` |
| 13.5 | Dependencies audited | **PARTIAL** | `npm audit --audit-level=high` in CI; 4 build-time highs accepted (documented) |
| 13.6 | Reproducible installs | **PASS** | Lockfile committed; CI uses `npm ci` |

## V14 — Data protection

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 14.1 | Sensitive data classified | **PASS** | SECURITY_THREAT_MODEL.md §1 |
| 14.2 | Sensitive data not logged | **PASS** | Redaction by key name and value shape; tested |
| 14.3 | Data minimisation to third parties | **PASS** | AI receives an explicit projection; no credentials, no PII |
| 14.4 | Export excludes credentials | **PASS** | Explicit `select`; asserted by test |
| 14.5 | Deletion removes user data | **PASS** | Transactional purge + Plaid revocation; retention documented |
| 14.6 | Encryption at rest for secrets | **PASS** | Application-layer AES-256-GCM above provider disk encryption |

## V15 — Secure coding and architecture

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 15.1 | Security controls centralised | **PASS** | `src/lib/security/*`; one route wrapper |
| 15.2 | Server/client boundary enforced | **PASS** | `server-only` on every secret-holding module; bundle audited |
| 15.3 | Race conditions considered | **PASS** | Sync lock, unique constraints, atomic upserts, webhook idempotency |
| 15.4 | Fail securely | **PARTIAL** | Auth and webhooks fail closed. The **rate limiter fails open** if the database is unreachable — deliberate, documented |

## V16 — Security logging and error handling

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 16.1 | Security events logged | **PASS** | `AuditEvent`: login, reset, consent, Plaid add/remove, export, denied access |
| 16.2 | Logs free of sensitive data | **PASS** | Redaction tested |
| 16.3 | Logs tamper-resistant to users | **PASS** | Append-only from the app; no route updates or deletes an event |
| 16.4 | Errors do not leak internals | **PASS** | Tested |
| 16.5 | Correlation ids | **PASS** | Per request, returned to the user, present in logs |

## V17 — WebRTC
**N/A** — not used.

---

## Summary

| Status | Count |
|---|---|
| PASS | 64 |
| PARTIAL | 9 |
| FAIL | 1 |
| N/A | 4 |

### The single FAIL

**V6.7 — MFA not available.** The architecture supports it (Better Auth ships
2FA and passkey plugins; the schema accommodates them) but it is not enabled.
Designated **launch blocker LB-3**: public registration stays off until MFA is
either enabled or explicitly accepted as a post-launch item by the owner.

### The nine PARTIALs, and why each is accepted for now

| Item | Limitation | Disposition |
|---|---|---|
| V1.7 | Prompt-injection delimiting is soft | Accepted — containment is structural (no tools) |
| V2.7, V6.6 | No CAPTCHA / bot protection | **LB-6** — enable Vercel WAF before public signup |
| V3.1 | `style-src 'unsafe-inline'` | Accepted — framework requirement; CSS not script |
| V6.5 | Sign-up timing side channel | Accepted — low value to an attacker, documented |
| V12.3 | HSTS preload not set | **LB-9** — after the domain is final |
| V13.5 | 4 build-time advisories | Accepted — not reachable from a request |
| V15.4 | Rate limiter fails open | Accepted — availability trade-off, documented |
| V16 (implicit) | No independent verification | **The most significant limitation.** §77 |

Every PARTIAL is a decision someone can disagree with. They are listed
individually so that disagreement is possible.
