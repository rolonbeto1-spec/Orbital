# Metta — Incident Response

**Audience:** whoever is holding the pager. Written to be followed under
pressure, so each procedure is a numbered list with the containment step first.

**Golden rule:** *contain before you investigate.* A leaked credential that is
still valid while you read logs is a leaked credential still being used.

**On breach notification:** this document does **not** state notification
deadlines. Obligations vary by jurisdiction and by the data involved, and
getting them wrong is its own harm. Every procedure below has a "notify" step
that says: **contact legal counsel** — they set the timeline, not this file.

---

## 0. First five minutes, any incident

1. **Write down the time** and what made you suspect an incident.
2. **Do not delete anything.** Logs, database rows and deploy history are
   evidence. Rotating a key is fine; deleting a log is not.
3. **Start a timeline document.** Every action, with a timestamp.
4. **Decide severity:**
   - **SEV-1** — user financial data is or may be exposed; a Plaid token,
     database credential or auth secret is out.
   - **SEV-2** — a service credential (Anthropic, email) is out; no user data
     exposure.
   - **SEV-3** — suspicious activity, no confirmed exposure.
5. **For SEV-1, contact legal counsel immediately.** Do this in parallel with
   the technical work, not after it.

---

## 1. Leaked Plaid secret (`PLAID_SECRET`)

The client secret for the whole Plaid account. Whoever holds it can act as
Metta against Plaid.

**Contain**
1. Plaid Dashboard → Team Settings → Keys → **rotate the secret** for the
   affected environment. Plaid supports rotation without invalidating existing
   Items, so bank connections survive.
2. Set the new value in Vercel → Settings → Environment Variables → `PLAID_SECRET`.
3. **Redeploy.** Environment changes do not take effect until a redeploy.

**Verify**
4. `GET /api/health` returns ok.
5. Sign in and run a manual sync; confirm transactions arrive.

**Investigate**
6. Plaid Dashboard → Activity: look for API calls you cannot account for —
   unfamiliar IPs, volume spikes, calls outside your deploy windows.
7. Determine how it leaked: a commit (`node scripts/scan-secrets.js`), a log, a
   screen share, a third-party tool.

**Notify**
8. Contact Plaid support with the timeline. Contact **legal counsel** — a Plaid
   secret can reach user financial data, so treat as SEV-1 until proven
   otherwise.

---

## 2. Leaked Plaid access token (one user's bank connection)

The most directly harmful single-user leak: it grants read access to a real
person's bank feed, independent of Metta, and is not fixed by a password reset.

**Contain**
1. Identify the Item:
   ```sql
   SELECT id, "userId", "institutionName", status FROM "Item" WHERE id = '<item id>';
   ```
2. **Revoke it at Plaid.** The token is useless once the Item is removed:
   ```
   POST /item/remove  { access_token: <token> }
   ```
   If you cannot reconstruct the token, delete the Item through the app as that
   user (Settings → Connections), which calls `/item/remove` for you.
3. Delete the local row so nothing tries to sync it:
   ```sql
   DELETE FROM "Item" WHERE id = '<item id>';
   ```

**Investigate**
4. How did a token become visible? It should exist in plaintext only inside a
   Plaid API call. Check: a log line (redaction should prevent this — if a token
   reached a log, that is a second bug, fix it), an error report, a database
   dump, or a compromised environment.
5. Query the audit trail for that user:
   ```sql
   SELECT type, outcome, ip, "createdAt" FROM "AuditEvent"
   WHERE "userId" = '<user id>' ORDER BY "createdAt" DESC LIMIT 100;
   ```

**Notify**
6. **Tell the affected user.** They should review their bank activity and
   consider notifying their bank. Contact **legal counsel** for the wording and
   the obligation.

---

## 3. Leaked encryption key (`ENCRYPTION_KEY_V*`)

Alone, the key is not enough — it decrypts nothing without the database. If the
database is *also* exposed, treat this as §5 as well.

**Contain — rotate to a new generation without losing any connection**
1. Generate a new key: `openssl rand -base64 32`
2. Add it as `ENCRYPTION_KEY_V2` **alongside** the existing `ENCRYPTION_KEY_V1`.
   Do not remove V1 yet — existing rows still need it.
3. Set `ENCRYPTION_KEY_ACTIVE=v2`. Redeploy. New writes now use V2; old rows
   still decrypt with V1 because each row records its own generation.
4. Re-encrypt existing rows:
   ```bash
   npx tsx scripts/rotate-encryption-key.ts
   ```
5. Confirm nothing remains on the old generation:
   ```sql
   SELECT COUNT(*) FROM "Item" WHERE "accessTokenKeyId" <> 'v2';
   ```
   When this is 0, remove `ENCRYPTION_KEY_V1` and redeploy.

**Investigate**
6. Determine exposure of the database in the same window. If both leaked,
   assume every Plaid token is compromised and work through §2 for each Item.

---

## 4. Leaked Anthropic key (`ANTHROPIC_API_KEY`)

Cost, not data — the key grants API access, not access to Metta.

**Contain**
1. Anthropic Console → API Keys → **revoke** the key.
2. Create a replacement, set it in Vercel, redeploy.
3. If you cannot rotate immediately, set `AI_DAILY_LIMIT=0` and redeploy. That
   is the kill switch: every AI feature falls back to the rule engine and the
   product keeps working.

**Investigate**
4. Anthropic Console → Usage: look for spend you cannot attribute.
5. Check whether the leak was the key itself or a compromised environment (in
   which case escalate to §5 and §6).

---

## 5. Leaked database credential

**SEV-1.** Grants every user's financial data. Plaid tokens are encrypted, so
they are protected *unless* the encryption key leaked too.

**Contain**
1. Neon Console → **rotate the password** for the role in `DATABASE_URL`.
2. Update `DATABASE_URL` in Vercel. Redeploy.
3. Neon Console → check IP allow-listing and connection settings; restrict if
   they are open.

**Investigate**
4. Neon → Monitoring: connections from unfamiliar addresses, unexpected query
   volume, large reads.
5. Establish the exposure window: when did the credential leak, when was it
   rotated? Everything in between is potentially read.
6. Do **not** assume no data was taken because you cannot see it. Absence of
   evidence in connection logs is not evidence of absence.

**Notify**
7. **Contact legal counsel immediately.** This is the scenario most likely to
   carry a notification obligation.

---

## 6. Leaked auth secret (`BETTER_AUTH_SECRET`)

Allows forging sessions for any user.

**Contain**
1. Generate a new secret: `openssl rand -base64 48`
2. Set it in Vercel and redeploy. **This signs every user out**, which is the
   intended effect — it invalidates any forged session along with the real ones.
3. Clear the session table for certainty:
   ```sql
   DELETE FROM "session";
   ```

**Communicate**
4. Users will be signed out with no explanation. Tell them: "we rotated a
   security key; please sign in again." Do not include detail that helps an
   attacker.

---

## 7. Leaked email provider credential (`RESEND_API_KEY`)

Enables sending mail *as Metta* — a phishing capability from a domain users
trust. Higher impact than it first appears.

**Contain**
1. Resend Dashboard → revoke the key. Create a replacement. Update Vercel.
   Redeploy.
2. Check Resend's sending log for messages Metta did not send.

**Investigate**
3. If phishing was sent from the domain, warn users about the specific message.
4. Password-reset links in genuine Metta emails expire in one hour and are
   single-use; check whether any were requested and used during the window.

---

## 8. Exposed financial records (a data-exposure bug)

For example: a route returning another tenant's data, a cache serving the wrong
user, or a misconfigured CDN.

**Contain**
1. **Take the affected route out of service first.** A one-line change that
   returns 503 for the endpoint, deployed now, beats a correct fix in an hour.
2. If exposure is broad, put the whole app behind Vercel Deployment Protection
   temporarily. Users seeing a maintenance page is better than users seeing each
   other's money.

**Investigate**
3. Establish scope from logs: which requests hit the route, from which users,
   over what period. Correlation ids in error responses map to log lines.
4. Reproduce in a test. **Write the failing test first** — it becomes the
   regression guard.

**Fix**
5. Fix, add the test to `tests/tenant-isolation.test.ts`, run the full suite,
   deploy.
6. Restore service.

**Notify**
7. **Contact legal counsel.** Confirmed exposure of financial data between users
   is the most serious incident this product can have.

---

## 9. Suspicious admin activity

**Contain**
1. Demote the account immediately:
   ```sql
   UPDATE "user" SET role = 'USER' WHERE email = '<email>';
   ```
2. Revoke their sessions:
   ```sql
   DELETE FROM "session" WHERE "userId" = (SELECT id FROM "user" WHERE email = '<email>');
   ```

**Investigate**
3. ```sql
   SELECT type, outcome, ip, "createdAt" FROM "AuditEvent"
   WHERE "userId" = '<user id>' ORDER BY "createdAt" DESC LIMIT 200;
   ```
4. Note the structural mitigation: **there is no admin UI**, so an admin role by
   itself does not grant a way to browse other users' financial data through the
   application. Direct database access is the real concern — check Neon's
   connection logs.

---

## 10. Account takeover reported by a user

1. Revoke every session for that user (SQL in §9).
2. Have them reset their password — which, by configuration, also revokes all
   other sessions.
3. Review their audit trail for the connections added or removed while the
   attacker had access.
4. If a bank was connected by the attacker, remove that Item (§2).
5. Advise the user to check their bank activity directly.

---

## 11. After any incident: postmortem

Within a week, write up:

- **Timeline** — detection, containment, resolution.
- **Root cause** — the actual cause, not the trigger.
- **Impact** — users affected, data involved, confirmed vs suspected.
- **What worked** — controls that did their job.
- **What did not** — including anything that made response slower.
- **Actions** — each with an owner and a date. A postmortem without owned
  actions is a diary entry.

Blameless. The goal is a system that fails less, not a person who feels worse.

---

## Quick reference

| Credential | Rotate at | Effect on users |
|---|---|---|
| `PLAID_SECRET` | Plaid Dashboard → Keys | None (Items survive) |
| Plaid access token | `/item/remove` | That bank disconnects |
| `ENCRYPTION_KEY_V*` | Generate + re-encrypt | None if done in order |
| `ANTHROPIC_API_KEY` | Anthropic Console | AI falls back to rules |
| `DATABASE_URL` | Neon Console | Brief downtime |
| `BETTER_AUTH_SECRET` | Generate new | **Everyone signed out** |
| `RESEND_API_KEY` | Resend Dashboard | None |

**Every rotation requires a Vercel redeploy to take effect.**
