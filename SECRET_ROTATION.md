# Metta — Secret Rotation

Rotating a credential should be routine, not an emergency-only skill. This
document is the routine version; INCIDENT_RESPONSE.md is the version for when
something has already gone wrong.

**Every rotation requires a Vercel redeploy.** Environment variables are read at
runtime, but the running instances hold the old values until they restart.

---

## Rotation schedule (recommended)

| Credential | Cadence | User impact |
|---|---|---|
| `BETTER_AUTH_SECRET` | Annually, or on suspicion | **Signs everyone out** |
| `ENCRYPTION_KEY_V*` | Annually, or on suspicion | None, if done in order |
| `PLAID_SECRET` | Annually, or on suspicion | None |
| `ANTHROPIC_API_KEY` | Annually, or on suspicion | None |
| `DATABASE_URL` password | Annually, or on staff change | Brief downtime |
| `RESEND_API_KEY` | Annually, or on suspicion | None |

"On staff change" matters more than the calendar: rotate when someone who held a
credential no longer needs it.

---

## 1. Encryption key (`ENCRYPTION_KEY_V*`) — the one with an order

This is the only rotation that can permanently destroy something if done out of
order, because the ciphertext in the database is useless without the key that
produced it.

The design that makes it safe: **each row records the key generation it was
encrypted with**, so several generations can be valid at once.

```bash
# 1. Generate the next generation.
openssl rand -base64 32
```

2. In Vercel, add `ENCRYPTION_KEY_V2` with that value.
   **Keep `ENCRYPTION_KEY_V1`.** Existing rows still need it.

3. Set `ENCRYPTION_KEY_ACTIVE=v2`. **Redeploy.**
   New writes now use V2. Old rows still decrypt with V1.

4. Re-encrypt the backlog:
   ```bash
   npx tsx scripts/rotate-encryption-key.ts --dry-run   # look first
   npx tsx scripts/rotate-encryption-key.ts
   ```

5. Confirm the backlog is empty:
   ```sql
   SELECT COUNT(*) FROM "Item" WHERE "accessTokenKeyId" <> 'v2';
   ```

6. **Only when that returns 0**, remove `ENCRYPTION_KEY_V1` and redeploy.

> **If you remove the old key before step 5 returns 0**, the remaining rows can
> never be decrypted. Those users must reconnect their banks. There is no
> recovery — that is what authenticated encryption means.

---

## 2. Auth secret (`BETTER_AUTH_SECRET`)

Signs sessions and verification tokens.

```bash
openssl rand -base64 48
```

1. Set the new value in Vercel. **Redeploy.**
2. Everyone is signed out. Optionally clear the table for certainty:
   ```sql
   DELETE FROM "session";
   ```
3. Tell users beforehand if this is planned. If it is a response to an incident,
   tell them afterwards without detail that helps an attacker.

In-flight password-reset and email-verification links are also invalidated.
Users simply request new ones.

---

## 3. Plaid credentials

**Secret** (routine): Plaid Dashboard → Team Settings → Keys → rotate for the
environment. Set `PLAID_SECRET` in Vercel. Redeploy. Existing Items are
unaffected — bank connections survive.

**Client ID**: effectively an account identifier, not a secret. Changing it means
a new Plaid account and re-linking every bank. Not a rotation; a migration.

Verify after rotating: sign in, run a manual sync, confirm transactions arrive
and no Item shows an error state.

---

## 4. Anthropic key

Anthropic Console → API Keys → create a new key → set `ANTHROPIC_API_KEY` in
Vercel → redeploy → revoke the old key.

Create-then-revoke, in that order, avoids a window with no working key.

If AI is unavailable for a while, that is survivable: every feature falls back to
the deterministic rule engine. `AI_DAILY_LIMIT=0` is the deliberate kill switch.

---

## 5. Database credential

1. Neon Console → Roles → reset the password.
2. Update `DATABASE_URL` in Vercel. **Redeploy.**
3. Expect a short window where in-flight requests fail; `/api/health` will
   report `degraded` until the redeploy completes.
4. Update any local `.env` and any other tool holding the old URL.

---

## 6. Email provider key

Resend Dashboard → API Keys → create new → set `RESEND_API_KEY` in Vercel →
redeploy → revoke old.

Verify by triggering a password-reset email to an address you control.

---

## 7. Credentials leaked in the predecessor repository — ROTATE

These are not Metta secrets and Metta does not use them, but they were
committed in cleartext and must be treated as compromised.

`rolonbeto1-spec/bull-trader` (the single-user application this rebuild came
from) committed a real `.env` in commit `1fa2ee2` on 2026-04-29 and removed it
in `db04748` on 2026-08-11. The file is still present in that repository's
history and in every clone and fork of it. Affected names:

| Name | Provider | Action |
|---|---|---|
| `ALPACA_API_KEY` | Alpaca | Revoke and reissue |
| `ALPACA_SECRET_KEY` | Alpaca | Revoke and reissue |
| `FINNHUB_API_KEY` | Finnhub | Revoke and reissue |

The values are deliberately not recorded in this or any other document.

Two things this is not:

* **Not fixed by the deletion.** The keys were public for about three and a
  half months and remain in history. Anyone who cloned in that window has them.
* **Not fixed by rewriting history.** A force-pushed rewrite changes what new
  clones see; it does not un-read what was already read. Rewrite if you like,
  but rotate regardless.

Rotate even though the Alpaca account is paper-trading: the key-id shape
cannot be assumed to be paper-only, and providers frequently issue one
credential pair that spans environments.

---

## After any rotation

1. `GET /api/health` returns `{"status":"ok","database":true}`.
2. Sign in.
3. Load the Hive and Activity; confirm the numbers look right.
4. Run a manual sync.
5. Trigger one email (a password reset to yourself).
6. Record the rotation: what, when, who, why.

---

## Generating values

```bash
# 32-byte encryption key (base64)
openssl rand -base64 32

# 48-byte auth secret (base64)
openssl rand -base64 48
```

Never generate a production secret in a shared terminal, a chat window, or
anywhere with scrollback others can read. Never commit one —
`node scripts/scan-secrets.js` runs in CI and will fail the build, but the right
time to catch it is before the commit.
