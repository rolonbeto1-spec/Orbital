import "server-only";
import { createHash, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { plaidClient } from "@/lib/plaid";
import { log } from "@/lib/security/logger";

/**
 * Plaid webhook verification (§10).
 *
 * Plaid signs every webhook with a JWT in the `Plaid-Verification` header:
 * ES256 (ECDSA over P-256 with SHA-256), whose payload carries a SHA-256
 * digest of the request body. Verifying it proves both that Plaid sent the
 * request and that the body was not altered in transit.
 *
 * What we deliberately do NOT accept as proof (§10):
 *  - the source IP address, which is spoofable and changes without notice;
 *  - a secret in the URL path, which leaks through logs and referrers;
 *  - the mere fact that the JSON is well-formed and names a real Item.
 *
 * The verification key is fetched from Plaid by `kid` and cached in memory for
 * the life of the instance, so key rollover works without a deploy but a
 * normal webhook does not cost an extra round trip.
 *
 * No JWT library: Node's crypto verifies ES256 directly, given
 * `dsaEncoding: "ieee-p1363"` — JOSE signatures are raw r‖s, not DER. One
 * fewer dependency in a security-critical path (§43).
 */

/** Reject anything older than this, so a captured webhook cannot be replayed. */
const MAX_AGE_SECONDS = 5 * 60;

interface CachedKey {
  key: ReturnType<typeof createPublicKey>;
  fetchedAt: number;
}

const keyCache = new Map<string, CachedKey>();
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function b64urlToJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/** Fetch (and cache) Plaid's public key for a given key id. */
async function verificationKey(kid: string): Promise<ReturnType<typeof createPublicKey> | null> {
  const cached = keyCache.get(kid);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) return cached.key;

  if (!plaidClient) return null;

  try {
    const response = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
    const jwk = response.data.key;

    // Only the algorithm we expect. A key advertising anything else is not
    // one we will verify with.
    if (jwk.alg !== "ES256" || jwk.kty !== "EC" || jwk.crv !== "P-256") {
      log.warn("Plaid verification key has unexpected algorithm", { alg: jwk.alg, kty: jwk.kty });
      return null;
    }
    // An expired key must not verify new webhooks.
    if (jwk.expired_at !== null && jwk.expired_at !== undefined) {
      log.warn("Plaid verification key is expired", { kid });
      return null;
    }

    const key = createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: "jwk",
    });

    keyCache.set(kid, { key, fetchedAt: Date.now() });
    return key;
  } catch (error) {
    log.error("Could not fetch Plaid webhook verification key", { error });
    return null;
  }
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a webhook.
 *
 * `rawBody` must be the exact bytes received. Re-serialising parsed JSON
 * changes whitespace and key order, which changes the digest, which fails
 * verification — so the route reads the body as text and parses it only after
 * this returns ok.
 */
export async function verifyPlaidWebhook(
  verificationHeader: string | null,
  rawBody: string,
): Promise<VerificationResult> {
  if (!verificationHeader) return { ok: false, reason: "missing-header" };
  if (verificationHeader.length > 8192) return { ok: false, reason: "oversized-header" };

  const segments = verificationHeader.split(".");
  if (segments.length !== 3) return { ok: false, reason: "malformed-jwt" };

  const [headerSegment, payloadSegment, signatureSegment] = segments;

  let header: { alg?: string; kid?: string };
  try {
    header = b64urlToJson(headerSegment) as { alg?: string; kid?: string };
  } catch {
    return { ok: false, reason: "malformed-header" };
  }

  // Pin the algorithm. Accepting the token's own `alg` is the classic JWT
  // confusion bug — "none" or an HMAC alg would let a forger sign with the
  // public key itself.
  if (header.alg !== "ES256") return { ok: false, reason: "bad-alg" };
  if (!header.kid || typeof header.kid !== "string" || header.kid.length > 200) {
    return { ok: false, reason: "bad-kid" };
  }

  const key = await verificationKey(header.kid);
  if (!key) return { ok: false, reason: "unknown-key" };

  // --- Signature ---------------------------------------------------------
  const signature = Buffer.from(signatureSegment, "base64url");
  // ES256 signatures are exactly 64 bytes (32-byte r ‖ 32-byte s).
  if (signature.length !== 64) return { ok: false, reason: "bad-signature-length" };

  const verifier = createVerify("SHA256");
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();

  const signatureValid = verifier.verify(
    { key, dsaEncoding: "ieee-p1363" },
    signature,
  );
  if (!signatureValid) return { ok: false, reason: "bad-signature" };

  // --- Claims ------------------------------------------------------------
  let payload: { iat?: number; request_body_sha256?: string };
  try {
    payload = b64urlToJson(payloadSegment) as { iat?: number; request_body_sha256?: string };
  } catch {
    return { ok: false, reason: "malformed-payload" };
  }

  // Freshness: bounds replay of a genuine, captured webhook.
  if (typeof payload.iat !== "number") return { ok: false, reason: "missing-iat" };
  const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
  if (ageSeconds > MAX_AGE_SECONDS) return { ok: false, reason: "stale" };
  // A token from the future is a clock problem or a forgery attempt; allow a
  // small skew and refuse the rest.
  if (ageSeconds < -60) return { ok: false, reason: "future-dated" };

  // Body integrity: the signature covers the digest, and the digest must
  // match the bytes we actually received.
  if (typeof payload.request_body_sha256 !== "string") {
    return { ok: false, reason: "missing-digest" };
  }
  const actualDigest = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(payload.request_body_sha256, "utf8");
  const actual = Buffer.from(actualDigest, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "body-mismatch" };
  }

  return { ok: true };
}

/** Test seam: clear the in-memory key cache. */
export function resetVerificationKeyCache(): void {
  keyCache.clear();
}
