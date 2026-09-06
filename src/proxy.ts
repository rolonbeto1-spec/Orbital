import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { safeRedirectPath } from "@/lib/security/url-guard";

/**
 * Next.js 16 proxy — the early authentication gate and the security-header
 * layer (§25, §55).
 *
 * IMPORTANT, and the reason this file is short: this is NOT where
 * authorization happens. It performs an optimistic cookie check to redirect
 * signed-out browsers to the sign-in page, which is a user-experience
 * nicety. It does not verify the session against the database, and it makes
 * no decision about which data anyone may see.
 *
 * Every API route independently calls requireUser() and scopes its queries by
 * the resulting user id. If this file were deleted entirely, the application
 * would still be secure — slower and uglier, but secure. That is the
 * defence-in-depth property §55 asks for:
 *
 *     proxy gate  +  route authentication  +  object ownership  +  DB scoping
 *
 * Why only a cookie check here: the proxy runs on every request including
 * static assets, and a database round trip per request would be both slow and
 * a connection-pool hazard on serverless (§57). Better Auth's own guidance is
 * to treat the middleware/proxy check as optimistic for exactly this reason.
 */

/** Paths that must remain reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/legal",
  "/api/auth",
  "/api/plaid/webhook", // authenticated by signature, not by cookie
  "/api/health",
];

/**
 * "/" is the public marketing page; the signed-in dashboard lives at "/app".
 *
 * This used to be true while "/" actually rendered the dashboard, so a
 * signed-out visitor was let through to an application shell whose every
 * request came back 401.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Security headers applied to every response (§25, §26, §27).
 *
 * The CSP is built to be as tight as the app's real dependencies allow, and
 * each relaxation below is deliberate and explained.
 */
function securityHeaders(nonce: string, isDev: boolean): Record<string, string> {
  const csp = [
    "default-src 'self'",

    // Scripts: our own bundle, plus Plaid Link, which must load its script
    // from cdn.plaid.com to render the bank-connection flow.
    //
    // 'strict-dynamic' with a per-request nonce lets Next's bundle load its
    // own chunks without listing every hash. In development Next's HMR and
    // React Refresh need eval, so 'unsafe-eval' is added there ONLY — never
    // in production (§25).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.plaid.com${
      isDev ? " 'unsafe-eval'" : ""
    }`,

    // Styles: Tailwind emits a stylesheet, but Next injects some inline
    // style attributes and next/font emits an inline <style>. 'unsafe-inline'
    // for styles is a documented, accepted relaxation: it permits CSS
    // injection, not script execution, and is the standard trade-off for
    // this framework. Recorded in SECURITY_REVIEW.md.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",

    // Images: merchant logos are third-party https URLs (validated as https
    // display URLs before storage), plus Google's favicon service.
    "img-src 'self' data: blob: https:",

    // XHR/fetch: our own origin plus Plaid Link's telemetry endpoints.
    "connect-src 'self' https://cdn.plaid.com https://production.plaid.com https://sandbox.plaid.com" +
      (isDev ? " ws: wss:" : ""),

    // Plaid Link renders inside an iframe it owns.
    "frame-src https://cdn.plaid.com https://*.plaid.com",

    // Clickjacking: nobody may frame Metta (§26). Preferred over the legacy
    // X-Frame-Options header, though that is sent too for old browsers.
    "frame-ancestors 'none'",

    // Nothing else should be loadable or submittable.
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // Do not leak the path a user came from to third-party sites.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Metta needs none of these.
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
    "X-DNS-Prefetch-Control": "off",
    // Cross-origin isolation: keep our documents and resources to ourselves.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (!isDev) {
    // HSTS. Two years, subdomains included. Preload is deliberately NOT set:
    // preloading is effectively irreversible and should only be turned on
    // once the domain configuration is confirmed final (§27, documented as a
    // manual step in the launch checklist).
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  }

  return headers;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== "production";

  // A fresh nonce per request. Reusing one would defeat the point.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const headers = securityHeaders(nonce, isDev);

  const applyHeaders = (response: NextResponse): NextResponse => {
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  };

  /**
   * Hand the nonce to the renderer, on EVERY path.
   *
   * This is what makes the nonce real rather than decorative. Next reads the
   * nonce out of the `Content-Security-Policy` REQUEST header and stamps it
   * onto the script tags it emits — including the inline RSC payload script.
   * Without it, the response advertises `'strict-dynamic'` while not one
   * script carries a nonce, and CSP Level 3 says `'strict-dynamic'` causes
   * `'self'` and every host-source to be IGNORED for scripts. The result is
   * not a weaker policy, it is a blank page: every script on every page is
   * blocked, in production only, where the CSP is strictest.
   *
   * Consequence, accepted deliberately: a page that carries a per-request
   * nonce cannot also be statically prerendered, because the nonce differs on
   * every request. A cached page would serve one visitor's nonce to everyone,
   * which is the same as having none. Correctness wins over the prerender.
   */
  const withNonce = (): { headers: Headers } => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);
    return { headers: requestHeaders };
  };

  if (isPublicPath(pathname)) {
    // Public pages need this just as much: /login is the page whose scripts
    // were blocked, and a sign-in form that cannot run JavaScript is a
    // sign-in form nobody can use.
    return applyHeaders(NextResponse.next({ request: withNonce() }));
  }

  // Optimistic check only — see the note at the top of this file.
  // Prefix must match advanced.cookiePrefix in src/lib/auth.ts.
  const sessionCookie = getSessionCookie(request, { cookiePrefix: "metta" });

  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) {
      // The route handler would say the same thing; answering here saves a
      // database round trip for obviously-unauthenticated traffic.
      return applyHeaders(
        NextResponse.json({ error: "Not signed in." }, { status: 401 }),
      );
    }

    const loginUrl = new URL("/login", request.url);
    // The return path is validated as an internal relative path, so this
    // cannot be turned into an open redirect (§19).
    const from = safeRedirectPath(`${pathname}${request.nextUrl.search}`, "/app");
    if (from !== "/app") loginUrl.searchParams.set("from", from);
    return applyHeaders(NextResponse.redirect(loginUrl));
  }

  return applyHeaders(NextResponse.next({ request: withNonce() }));
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and the site assets a
     * browser fetches before anyone has signed in. Note that API routes ARE
     * matched: they get the security headers, and the optimistic 401 above.
     *
     * `icon.svg` and `apple-touch-icon.png` are on this list because they were
     * missing from it: the proxy redirected them to /login for every
     * signed-out visitor, so the site icon failed to load on the landing page
     * and the login page. They are public files with no user data in them.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-touch-icon\\.png|manifest\\.webmanifest|sw\\.js|icons/).*)",
  ],
};
