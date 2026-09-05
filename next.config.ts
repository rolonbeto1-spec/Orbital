import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * Most security headers are set per-request in src/proxy.ts, because the CSP
 * carries a per-request nonce and a static header cannot. The headers here are
 * the ones that are genuinely constant, applied as a backstop so that any
 * response path which somehow bypasses the proxy still carries them.
 */
const nextConfig: NextConfig = {
  // Never expose the framework version to every visitor.
  poweredByHeader: false,

  // Fail the production build on a type error or a lint error, rather than
  // shipping it. This is the default, stated explicitly so nobody turns it
  // off to get a deploy out (§64).
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Authenticated API responses must never be stored by a shared cache
        // or a CDN. safeJson() sets this per response too; this is the
        // belt-and-braces layer for any handler that forgets (§53).
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
};

export default nextConfig;
