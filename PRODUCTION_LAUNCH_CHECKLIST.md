# Metta — Production Launch Checklist

**Current status: PUBLIC SIGNUPS MUST REMAIN DISABLED.**

`PUBLIC_SIGNUP_ENABLED=false` is the shipped default. While it is false, only
addresses on `SIGNUP_ALLOWLIST` can register — which is how the owner and
invited testers get in without opening the product to the world.

Legend: `[x]` done and verified · `[ ]` outstanding · **BLOCKER** = public
signup stays off until this is cleared.

---

## Code and architecture — done

- [x] Shared `APP_PASSWORD` removed (deleted, not wrapped; the app now refuses
      to start in production if the variable is still set)
- [x] Production authentication working (Better Auth 1.7, scrypt, sessions)
- [x] Email verification implemented and required before data access
- [x] Password reset implemented (single-use, 1-hour expiry, revokes other sessions)
- [x] Change password / sign out / sign out all devices available
- [x] Tenant ownership added to every user-owned model
- [x] Every API route and domain query scoped to the authenticated user
- [x] Object-level authorization with ownership in the WHERE clause
- [x] Tenant-isolation tests passing (50 tests, User A vs User B)
- [x] Plaid access tokens encrypted (AES-256-GCM, rotatable)
- [x] Plaid webhooks cryptographically verified (ES256, algorithm pinned)
- [x] Plaid Item state handling (connected / login required / consent expired /
      disconnected / revoked / error)
- [x] Plaid `client_user_id` is an opaque internal reference, not email or name
- [x] Plaid OAuth redirect from a server-side allowlist
- [x] Rate limits enabled (database-backed, per-user and per-IP)
- [x] Security headers configured (CSP with per-request nonce, HSTS,
      frame-ancestors, Permissions-Policy, COOP/CORP)
- [x] CSRF: SameSite cookies, origin checks, no state-changing GET
- [x] CORS: none configured; same-origin only
- [x] SSRF review complete; server does not fetch user- or AI-supplied URLs
- [x] Open-redirect protection
- [x] Input validation on every route (Zod, strict objects, bounded)
- [x] AI isolation verified (no tools, per-user snapshots, scoped writes)
- [x] AI cost controls per user and global, with a kill switch
- [x] Account deletion implemented and tested
- [x] Data export implemented and tested (excludes all credentials)
- [x] Logs redact sensitive information (by key name and by value shape)
- [x] Secrets audited; 97 commits of history scanned clean
- [x] `.env.example` contains names only
- [x] Demo seeding removed from the application entirely
- [x] Production database migrations established (`migrate deploy`, not `db push`)
- [x] CI security gate (lint, typecheck, tests, build, secret scan, audit)
- [x] Threat model completed
- [x] ASVS checklist completed
- [x] Incident-response document completed
- [x] Secret-rotation procedures documented
- [x] Money arithmetic correct to the cent (two real bugs found and fixed)
- [x] Timezone-correct period boundaries per user

---

## BLOCKERS — public signup stays off until every one is cleared

### LB-1 — Owner data migrated and verified **BLOCKER**
- [ ] Neon backup taken **and a restore tested**
- [ ] `scripts/migrate-owner-data.ts --dry-run` reviewed
- [ ] Migration run for real
- [ ] Row counts identical before and after
- [ ] No row left without an owner
- [ ] Plaid tokens encrypted (0 rows with a legacy plaintext token)
- [ ] Owner can sign in
- [ ] Net worth and monthly spending match the old app
- [ ] A manual sync completes and new transactions arrive

> Until this is done there is production financial data that the new schema does
> not correctly own. §66 is explicit: no public signup before this.

### LB-2 — Real secrets set in production **BLOCKER**
- [ ] `BETTER_AUTH_SECRET` generated (48 bytes) and set
- [ ] `ENCRYPTION_KEY_V1` generated (32 bytes) and set
- [ ] `ENCRYPTION_KEY_ACTIVE=v1` set
- [ ] `APP_URL` set to the real https origin
- [ ] `APP_PASSWORD` **deleted** from the environment
- [ ] Redeployed after setting them

### LB-3 — MFA decision **BLOCKER**
- [ ] Either enable Better Auth's 2FA plugin, **or** the owner explicitly
      accepts, in writing, launching without it

> The only **FAIL** in the ASVS checklist. It needs a decision, not necessarily
> an implementation.

### LB-4 — Plaid production configuration verified **BLOCKER**
- [ ] `PLAID_ENV=production`, production credentials set
- [ ] Webhook URL registered in the Plaid dashboard, pointing at
      `https://<domain>/api/plaid/webhook`
- [ ] **A genuine Plaid webhook has been received and verified end-to-end**
      (only forgeries have been tested so far)
- [ ] OAuth redirect URI registered and matching `PLAID_REDIRECT_URIS`
- [ ] Plaid Link tested end-to-end against a real bank, **after** the CSP was
      applied

### LB-5 — Email delivery working **BLOCKER**
- [ ] `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` set
- [ ] Sending domain verified with Resend (SPF, DKIM, DMARC in DNS)
- [ ] A verification email received in a real inbox, not spam
- [ ] A password-reset email received and the link works

> Without this, a user who forgets their password is permanently locked out of
> their financial data.

### LB-6 — Abuse protection **BLOCKER**
- [ ] Vercel WAF enabled
- [ ] Bot protection enabled on `/api/auth/*`
- [ ] Attack Challenge Mode understood and available

> The application's own rate limits do not stop a distributed credential-stuffing
> attack across many IPs.

### LB-7 — Backups verified **BLOCKER**
- [ ] Neon point-in-time recovery confirmed available on the current plan
- [ ] Retention window documented
- [ ] **A restore has actually been performed** into a scratch branch
- [ ] Restore procedure written down with a named responsible person

> §45: a backup that has never been restored is not a verified backup.

### LB-8 — Legal review **BLOCKER**
- [ ] Privacy Policy reviewed by qualified counsel
- [ ] Terms of Service reviewed by qualified counsel
- [ ] Support/contact address added to both
- [ ] Breach-notification obligations for the relevant jurisdictions determined
      by counsel and added to INCIDENT_RESPONSE.md

> Both documents currently carry a visible draft banner.

### LB-9 — Production hardening confirmed in a browser **BLOCKER**
- [ ] Headers verified on the live domain (`curl -I`) — CSP, HSTS,
      X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- [ ] CSP produces **no console violations** during a full Plaid Link flow
- [ ] Framing confirmed blocked from a third-party page
- [ ] HSTS preload submitted **only after** the domain is final
- [ ] Vercel Deployment Protection **OFF** for production (the app has its own
      auth) and **ON** for preview deployments

### LB-10 — Cache isolation confirmed at the edge **BLOCKER**
- [ ] No Vercel edge-caching rule applies to `/api/*`
- [ ] Two different signed-in users, same endpoint, on the live domain: each
      sees only their own data
- [ ] `Cache-Control: private, no-store` present on live API responses

### LB-11 — Repository protection **BLOCKER**
- [ ] Branch protection on the production branch
- [ ] CI required to pass before merge
- [ ] GitHub secret scanning enabled
- [ ] Dependabot alerts enabled
- [ ] No direct pushes to the production branch
- [ ] Repository access reviewed (least privilege)

### LB-12 — Independent security review **BLOCKER**
- [ ] Manual penetration test by someone who did not write this code, covering
      auth, IDOR, tenant isolation, cache leakage, Plaid integration, webhooks,
      account recovery, rate limiting and admin privileges
- [ ] Findings triaged; anything high or critical fixed

> §77. The single most important item here. Everything else was verified by the
> author of the code.

---

## Should be done, not blocking

- [ ] Staging environment with its own database, auth secret and Plaid sandbox
      credentials (§46)
- [ ] Load-test Activity, Hive, reports, recurring detection and webhook bursts (§72)
- [ ] Log drain configured to a searchable destination (§73)
- [ ] Alerts on authentication-failure spikes, webhook rejections, sync errors,
      AI budget exhaustion
- [ ] Uptime monitoring on `/api/health`
- [ ] Clear the 4 build-time dependency advisories when upstream allows
- [ ] Resolve the inherited UI lint warnings during the design pass

---

## Enabling public signup

Only when every BLOCKER above is `[x]`:

1. Set `PUBLIC_SIGNUP_ENABLED=true` in Vercel.
2. Redeploy.
3. Register a brand-new account from a clean browser and walk the whole flow:
   sign up → verify email → accept terms → connect a bank → see your own data.
4. Confirm the new account sees **only** its own data and a genuine empty state
   before connecting anything.
5. Watch logs and Anthropic spend closely for the first 48 hours.

**If any blocker is later found to be incomplete, set
`PUBLIC_SIGNUP_ENABLED=false` and redeploy.** That is a single environment
variable, and it takes effect for every new registration immediately.
