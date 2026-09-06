import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { DM_Sans, Sora } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-geist-sans", // keeps the existing token wiring
  subsets: ["latin"],
});
const sora = Sora({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Metta",
  description: "All your accounts and budgets, on one screen.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Metta",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e0d" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Every page renders per-request, so that the CSP nonce is per-request too.
 *
 * The Content-Security-Policy set in src/proxy.ts uses `'strict-dynamic'`
 * with a nonce. Under CSP Level 3 `'strict-dynamic'` makes `'self'` and every
 * host-source expression be IGNORED for scripts, so a nonce is the ONLY thing
 * that can allow a script to run. A statically prerendered page is baked at
 * build time and cannot carry a per-request nonce — and a cached page that
 * carried one would hand every visitor the same nonce, which is no protection
 * at all. So a prerendered page under this policy does not merely lose a
 * defence, it fails to load any JavaScript whatsoever.
 *
 * Reading a request header below opts the whole tree into dynamic rendering,
 * which is what lets Next stamp the nonce onto its script tags. The cost is
 * the prerender of a handful of public pages; the alternative is a policy
 * weak enough to permit inline script, which is the thing the policy exists
 * to stop.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Also asserts the proxy ran: the nonce is set there, on every path.
  await headers();

  return (
    <html lang="en" className={`${dmSans.variable} ${sora.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
