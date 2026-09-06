"use client";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client.
 *
 * This module holds NO secrets. It talks to /api/auth over same-origin
 * requests, and the session lives in an HttpOnly cookie that JavaScript here
 * cannot read (§5). Everything security-relevant — password hashing, token
 * generation, session validation — happens on the server.
 */
export const authClient = createAuthClient({
  // Same-origin. Deliberately not configurable from the client.
  basePath: "/api/auth",
});

export const { signIn, signUp, signOut, useSession } = authClient;
