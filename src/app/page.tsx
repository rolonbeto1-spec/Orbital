import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/security/session";
import { SiteNav } from "@/components/site/site-nav";
import { Hero } from "@/components/site/hero";
import { HiveSection } from "@/components/site/hive-section";
import { Features } from "@/components/site/features";
import { Privacy } from "@/components/site/privacy";
import { AiSection } from "@/components/site/ai-section";
import { Cta } from "@/components/site/cta";
import { SiteFooter } from "@/components/site/site-footer";

export const metadata: Metadata = {
  title: "Metta — See where your money goes",
  description:
    "A private personal-finance companion that connects to your banks and " +
    "answers one question at a glance: where is my money going? Read-only " +
    "forever. Your data never moves.",
  openGraph: {
    title: "Metta — See where your money goes",
    description:
      "A private personal-finance companion built around the Hive — a living " +
      "map of your money. Read-only forever.",
    type: "website",
  },
};

/**
 * The public landing page.
 *
 * Before this existed, "/" rendered the signed-in dashboard while the proxy
 * treated it as a public path, so a signed-out visitor got an empty dashboard
 * shell whose every request came back 401. The dashboard now lives at "/app",
 * which the proxy already protects and which the post-login redirect already
 * defaulted to.
 *
 * Someone already signed in has no use for the marketing page, so they are
 * sent straight to their own data. This is a convenience, not a security
 * control — the authorization that matters happens in the route handlers.
 */
export default async function LandingPage() {
  // Cheap check first. This page is the one unauthenticated URL that anyone on
  // the internet can hit at any volume, and resolving a session costs a
  // database round trip. No session cookie means there is certainly no
  // session, so the common case answers without touching the database.
  //
  // The cookie is only a hint — a forged or stale one gets resolved properly
  // below, and the redirect it controls is a convenience, not a gate.
  const cookieStore = await cookies();
  const hasSessionCookie = cookieStore
    .getAll()
    .some((cookie) => cookie.name.startsWith("metta.session_token"));

  if (hasSessionCookie && (await getCurrentUser())) redirect("/app");

  return (
    <main className="relative">
      <SiteNav />
      <Hero />
      <HiveSection />
      <Features />
      <Privacy />
      <AiSection />
      <Cta />
      <SiteFooter />
    </main>
  );
}
