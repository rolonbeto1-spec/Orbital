import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySessionToken } from "@/lib/session";

// The login gate. Active only when APP_PASSWORD is set — locally, with no
// password configured, the app stays open so demo mode works with zero setup.
// Once deployed, APP_PASSWORD must be set: everything except the login screen
// and PWA assets then requires a valid session cookie.

export async function proxy(request: NextRequest) {
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token, sessionSecret()))) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("from", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except: login screen, auth endpoints, Next internals, and the
  // PWA files the phone needs before sign-in (manifest, service worker, icons).
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|manifest\\.webmanifest|sw\\.js|icons/|favicon\\.ico).*)",
  ],
};
