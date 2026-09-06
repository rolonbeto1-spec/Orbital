/**
 * Client-safe internal-redirect validation (§19).
 *
 * A copy of the rule in src/lib/security/url-guard.ts that can run in the
 * browser (that module is server-only because it does DNS lookups). This is
 * for UX; the authoritative check is the server's.
 */
export function safeRedirectTarget(
  candidate: string | null | undefined,
  fallback = "/app",
): string {
  if (!candidate || candidate.length > 512) return fallback;
  if (/[\r\n\t]/.test(candidate)) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.includes("\\")) return fallback;
  return candidate;
}
