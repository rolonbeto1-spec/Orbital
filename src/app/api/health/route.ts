import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and database connectivity (§74).
 *
 * Deliberately says almost nothing: "ok" or "degraded", and whether the
 * database answered. No version numbers, no connection strings, no
 * configuration, no counts — a health endpoint is unauthenticated, and an
 * attacker should learn nothing from it about how the system is built (§40).
 */
export async function GET(request: Request): Promise<Response> {
  // Metered per IP before the database is touched. This endpoint is
  // unauthenticated and its whole job is to make a database round trip, so
  // leaving it unmetered hands anyone a cheap way to exhaust the connection
  // pool. A refused call returns without querying anything.
  const limit = await consumeRateLimit("health", `ip:${clientIp(request)}`);
  if (!limit.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: {
        "Retry-After": String(limit.retryAfter),
        "Cache-Control": "no-store",
      },
    });
  }

  let database = false;
  try {
    // The cheapest possible round trip that proves the connection works.
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  const body = { status: database ? "ok" : "degraded", database };
  const response = NextResponse.json(body, { status: database ? 200 : 503 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
