import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireUser,
  requireAdmin,
  requireUserAllowingUnverified,
  UnauthenticatedError,
  ForbiddenError,
  type AuthedUser,
} from "./session";
import { NotFoundError } from "./ownership";
import { consumeRateLimit, clientIp, type RateLimitName } from "./rate-limit";
import { log, newCorrelationId, metric } from "./logger";
import { recordAudit } from "./audit";

/**
 * The one way to write an API route (§13).
 *
 * Every handler in src/app/api is built with this wrapper, so authentication,
 * rate limiting, body-size limits, schema validation, error shaping and
 * cache headers are applied uniformly instead of being reimplemented (and
 * subtly forgotten) in forty places.
 *
 * Defaults are the safe ones: authentication required, responses marked
 * private and no-store, unknown body properties rejected.
 */

/** Bodies larger than this are refused before parsing (§14). */
const MAX_BODY_BYTES = 128 * 1024; // 128 KB

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly publicMessage?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * JSON response with the cache headers an authenticated financial API needs
 * (§53). `private` keeps it out of shared/CDN caches; `no-store` keeps it out
 * of the browser's disk cache so a shared computer does not leak the last
 * user's balances.
 */
export function safeJson(data: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data as never, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Vary", "Cookie");
  // Belt and braces against a proxy that ignores Cache-Control.
  response.headers.set("Pragma", "no-cache");
  return response;
}

function errorResponse(status: number, message: string, extra?: Record<string, string>) {
  const response = safeJson({ error: message }, { status });
  if (extra) for (const [k, v] of Object.entries(extra)) response.headers.set(k, v);
  return response;
}

export interface RouteContext<TBody, TQuery> {
  user: AuthedUser;
  body: TBody;
  query: TQuery;
  request: Request;
  params: Record<string, string>;
  /** Correlation id, already attached to any log line this request emits. */
  correlationId: string;
}

export interface RouteOptions<TBody, TQuery> {
  /** "user" (default), "admin", "unverified" (verification flows), or "public". */
  auth?: "user" | "admin" | "unverified" | "public";
  /** Named rate-limit budgets. All must pass. */
  limits?: RateLimitName[];
  /** Zod schema for the JSON body. Absent means no body is read. */
  body?: z.ZodType<TBody>;
  /** Zod schema for the query string. Absent means query params are ignored. */
  query?: z.ZodType<TQuery>;
  /** Audit event name recorded on success. Omit for ordinary reads. */
  audit?: string;
}

type Handler<TBody, TQuery> = (
  ctx: RouteContext<TBody, TQuery>,
) => Promise<NextResponse | Response>;

/**
 * Build a route handler.
 *
 * Ordering is deliberate: authenticate first (so the rate-limit key can be
 * the user rather than a shared IP), then rate-limit, then validate. An
 * unauthenticated request never reaches validation, and an over-limit request
 * never reaches the database.
 */
export function route<TBody = undefined, TQuery = undefined>(
  options: RouteOptions<TBody, TQuery>,
  handler: Handler<TBody, TQuery>,
) {
  return async function handleRequest(
    request: Request,
    context?: { params?: Promise<Record<string, string>> },
  ): Promise<Response> {
    const correlationId = newCorrelationId();
    const started = Date.now();
    const method = request.method;
    const routePath = new URL(request.url).pathname;
    const authMode = options.auth ?? "user";

    try {
      // ---- 1. Authenticate -------------------------------------------------
      let user: AuthedUser | null = null;
      if (authMode === "admin") user = await requireAdmin();
      else if (authMode === "user") user = await requireUser();
      else if (authMode === "unverified") user = await requireUserAllowingUnverified();

      // ---- 2. Rate limit ---------------------------------------------------
      // Authenticated traffic is limited per user; anonymous traffic per IP.
      // Authenticated requests are additionally limited per IP so that one
      // network cannot launder abuse through many fresh accounts.
      if (options.limits?.length) {
        const ip = clientIp(request);
        const actor = user ? `user:${user.id}` : `ip:${ip}`;
        for (const limitName of options.limits) {
          const result = await consumeRateLimit(limitName, actor);
          if (!result.ok) {
            metric("ratelimit.rejected", 1, { route: routePath, limit: limitName });
            // Deliberately says nothing about which budget or how much is left.
            return errorResponse(429, "Too many requests. Please slow down.", {
              "Retry-After": String(result.retryAfter),
            });
          }
          if (user) {
            const ipResult = await consumeRateLimit(limitName, `ip:${ip}`);
            if (!ipResult.ok) {
              metric("ratelimit.rejected", 1, { route: routePath, limit: limitName, by: "ip" });
              return errorResponse(429, "Too many requests. Please slow down.", {
                "Retry-After": String(ipResult.retryAfter),
              });
            }
          }
        }
      }

      // ---- 3. Validate -----------------------------------------------------
      let body = undefined as TBody;
      if (options.body) {
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_BODY_BYTES) {
          return errorResponse(413, "Request body is too large.");
        }
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return errorResponse(413, "Request body is too large.");
        }
        let parsedJson: unknown;
        try {
          parsedJson = raw.length ? JSON.parse(raw) : {};
        } catch {
          return errorResponse(400, "Request body is not valid JSON.");
        }
        const result = options.body.safeParse(parsedJson);
        if (!result.success) {
          // Field names and reasons only — never echo the submitted values,
          // which may be hostile or sensitive.
          return safeJson(
            {
              error: "Invalid request.",
              details: result.error.issues.map((issue) => ({
                field: issue.path.join(".") || "(body)",
                message: issue.message,
              })),
            },
            { status: 400 },
          );
        }
        body = result.data;
      }

      let query = undefined as TQuery;
      if (options.query) {
        const params = Object.fromEntries(new URL(request.url).searchParams.entries());
        const result = options.query.safeParse(params);
        if (!result.success) {
          return safeJson(
            {
              error: "Invalid request.",
              details: result.error.issues.map((issue) => ({
                field: issue.path.join(".") || "(query)",
                message: issue.message,
              })),
            },
            { status: 400 },
          );
        }
        query = result.data;
      }

      const params = (await context?.params) ?? {};

      // ---- 4. Handle -------------------------------------------------------
      const response = await handler({
        // Non-null for every non-public route; public routes must not read it.
        user: user as AuthedUser,
        body,
        query,
        request,
        params,
        correlationId,
      });

      if (options.audit && user) {
        await recordAudit({
          userId: user.id,
          type: options.audit,
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
      }

      metric("http.request", 1, { route: routePath, method, status: response.status });
      metric("http.duration_ms", Date.now() - started, { route: routePath, method });
      return response;
    } catch (error) {
      return handleRouteError(error, {
        correlationId,
        routePath,
        method,
        started,
        request,
        auditOnDeny: authMode !== "public",
      });
    }
  };
}

function handleRouteError(
  error: unknown,
  ctx: {
    correlationId: string;
    routePath: string;
    method: string;
    started: number;
    request: Request;
    auditOnDeny: boolean;
  },
): Response {
  const { correlationId, routePath, method, started } = ctx;

  const finish = (status: number, message: string) => {
    metric("http.request", 1, { route: routePath, method, status });
    metric("http.duration_ms", Date.now() - started, { route: routePath, method });
    return errorResponse(status, message);
  };

  if (error instanceof UnauthenticatedError) {
    return finish(401, "Not signed in.");
  }

  if (error instanceof ForbiddenError) {
    // A denied authenticated request is a security-relevant event: it is what
    // a tenant-isolation probe looks like from the server's side.
    void recordAudit({
      type: "authz.denied",
      outcome: "denied",
      ip: clientIp(ctx.request),
      meta: { route: routePath, method },
    });
    return finish(403, error.message);
  }

  if (error instanceof NotFoundError) {
    // Identical response for "no such record" and "not your record" (§7).
    return finish(404, "Not found.");
  }

  if (error instanceof HttpError) {
    return finish(error.status, error.publicMessage ?? error.message);
  }

  // Anything else is a bug. The user gets a generic message plus a reference
  // they can quote; the detail stays in the server log (§40).
  log.error("Unhandled route error", { route: routePath, method, correlationId, error });
  metric("http.error", 1, { route: routePath, method });
  return finish(500, `Something went wrong. Reference: ${correlationId}`);
}

/**
 * Guard for state-changing GET requests (§17). A route that mutates must not
 * be reachable by a <img src> or a link, so mutations live behind
 * POST/PATCH/DELETE only. Exported for tests that assert this property.
 */
export const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
