import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/**
 * Better Auth's endpoints: sign-up, sign-in, sign-out, email verification,
 * password reset, session listing and revocation, account deletion.
 *
 * This replaces the old hand-rolled /api/auth/login and /api/auth/logout
 * routes, which compared a single shared password and minted an HMAC cookie.
 *
 * Never cached, and not statically analysable at build time.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth);
