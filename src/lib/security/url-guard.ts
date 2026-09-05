import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { log } from "./logger";

/**
 * SSRF and open-redirect defence (§19, §20).
 *
 * Two separate problems, both about URLs the application did not author:
 *
 *  1. Open redirect — the browser is sent to a URL that came from a query
 *     string. Only relative internal paths are ever allowed.
 *  2. SSRF — the *server* fetches a URL that came from a user, or worse, from
 *     the AI. On a cloud host that is a route to the instance metadata
 *     service and to anything else on the private network.
 *
 * Metta's policy on server-side fetching is restrictive by default: the app
 * does not fetch arbitrary URLs at all. Merchant logos are stored as URLs and
 * rendered by the *browser*; the server never dereferences them. The guard
 * below exists for the narrow cases where a server fetch is genuinely needed,
 * and for tests that assert the policy.
 */

// ---------------------------------------------------------------------------
// Open redirect
// ---------------------------------------------------------------------------

/**
 * Return a safe internal path, or the fallback.
 *
 * Only same-site relative paths are accepted. Everything else — absolute
 * URLs, protocol-relative "//evil.example", backslash tricks that some
 * browsers normalise to slashes, and control characters — is rejected.
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback = "/app"): string {
  if (!candidate) return fallback;
  if (candidate.length > 512) return fallback;

  // Reject anything with a scheme, an authority, or a newline (header splitting).
  if (/[\r\n\t]/.test(candidate)) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) return fallback; // http:, javascript:, data:
  // "//host" and "/\host" are both treated as protocol-relative by browsers.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.includes("\\")) return fallback;

  // Normalise away any "..' segments so the result cannot escape upward.
  try {
    const url = new URL(candidate, "https://internal.invalid");
    if (url.origin !== "https://internal.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// SSRF
// ---------------------------------------------------------------------------

/** Address ranges the server must never be pointed at. */
function isBlockedAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // unspecified, loopback
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) must be judged by its IPv4 value.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }

  return true; // not an IP literal at all
}

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
  /** The resolved addresses, so the caller can pin the connection to them. */
  addresses?: string[];
}

/**
 * Validate a URL the server is about to fetch.
 *
 * Checks, in order: scheme, port, hostname shape, then every address the
 * hostname resolves to. Resolving *all* addresses and rejecting if any is
 * private closes the DNS-rebinding trick where a name returns a public
 * address on the first lookup and a private one on the second.
 */
export async function guardOutboundUrl(candidate: string): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  // HTTPS only: no http, and certainly no file:, gopher:, ftp: (§20).
  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };

  // Only the default port. A non-standard port is almost always an attempt to
  // reach an internal service.
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "port" };

  if (url.username || url.password) return { ok: false, reason: "credentials-in-url" };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.length > 253) return { ok: false, reason: "hostname" };
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "loopback" };
  }
  // .internal / .local are cloud and mDNS internal namespaces.
  if (hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    return { ok: false, reason: "internal-tld" };
  }

  // A literal IP is checked directly; a name is resolved first.
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) return { ok: false, reason: "private-address" };
    return { ok: true, addresses: [hostname] };
  }

  try {
    const results = await lookup(hostname, { all: true });
    if (results.length === 0) return { ok: false, reason: "unresolvable" };
    for (const result of results) {
      if (isBlockedAddress(result.address)) {
        return { ok: false, reason: "private-address" };
      }
    }
    return { ok: true, addresses: results.map((r) => r.address) };
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
}

/**
 * The only sanctioned way for the server to fetch an external URL.
 *
 * Enforces the guard, a strict timeout, a response-size cap, and — crucially
 * — `redirect: "manual"`, so a permitted host cannot bounce us to a forbidden
 * one. Each hop is re-validated.
 */
export async function guardedFetch(
  candidate: string,
  options: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<{ ok: true; body: string; url: string } | { ok: false; reason: string }> {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxRedirects = options.maxRedirects ?? 2;

  let current = candidate;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const guard = await guardOutboundUrl(current);
    if (!guard.ok) {
      log.warn("Blocked outbound fetch", { reason: guard.reason });
      return { ok: false, reason: guard.reason ?? "blocked" };
    }

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual", // re-validate every hop ourselves
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "text/plain, application/json, text/html" },
      });
    } catch {
      return { ok: false, reason: "fetch-failed" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "bad-redirect" };
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) return { ok: false, reason: `status-${response.status}` };

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return { ok: false, reason: "too-large" };

    const text = await response.text();
    if (text.length > maxBytes) return { ok: false, reason: "too-large" };

    return { ok: true, body: text, url: current };
  }

  return { ok: false, reason: "too-many-redirects" };
}

/**
 * Validate a URL that will be handed to the *browser* to render or link to
 * (a merchant logo, a cancellation page the AI suggested).
 *
 * The server never dereferences these, so SSRF does not apply — but they must
 * still be https and must not be a javascript:/data: payload that would
 * become XSS when placed in an href or src (§16).
 */
export function isSafeDisplayUrl(candidate: string | null | undefined): boolean {
  if (!candidate || candidate.length > 2048) return false;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Returns the URL if it is safe to hand to the browser, else null. */
export function sanitizeDisplayUrl(candidate: string | null | undefined): string | null {
  return isSafeDisplayUrl(candidate) ? (candidate as string) : null;
}
