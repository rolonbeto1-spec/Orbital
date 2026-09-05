/**
 * Structured logging with mandatory redaction (§12, §40, §73).
 *
 * The API deliberately has no "log this object" escape hatch: context always
 * passes through redact(). If a developer reaches for console.log instead,
 * the lint rule in eslint.config.mjs flags it.
 *
 * Output is one JSON object per line, which is what Vercel's log drain and
 * every log aggregator want. Correlation ids let a user-visible error message
 * ("reference: abc123") be traced to a specific log line without the message
 * itself carrying any detail.
 */

import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  if (configured && configured in LEVEL_ORDER) return configured;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/** Random, short, non-guessable id used to correlate a user-facing error. */
export function newCorrelationId(): string {
  // 8 bytes is plenty to correlate within a retention window and short
  // enough that a person can read it out over the phone.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel()]) return;

  const line = {
    level,
    time: new Date().toISOString(),
    // The message itself is scrubbed too — messages are frequently built by
    // interpolating a value that turns out to be a token.
    msg: redact(message),
    ...(context ? { ctx: redact(context) } : {}),
  };

  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const log = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};

/**
 * Operational metrics (§73). Emitted on the same stream with a marker so a
 * drain can route them to a metrics backend.
 *
 * Metric names and tag values must be low-cardinality and non-personal: a
 * route template, an error code, a duration. Never a user id, a merchant, or
 * an amount — the observability platform must not become a second copy of
 * the financial database.
 */
export function metric(
  name: string,
  value: number,
  tags?: Record<string, string | number | boolean>,
): void {
  const line = {
    level: "info" as const,
    time: new Date().toISOString(),
    metric: name,
    value,
    ...(tags ? { tags: redact(tags) } : {}),
  };
  console.log(JSON.stringify(line));
}

/** Times an operation and emits a duration metric, whatever the outcome. */
export async function timed<T>(
  name: string,
  tags: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    metric(`${name}.duration_ms`, Date.now() - started, { ...tags, outcome: "ok" });
    return result;
  } catch (error) {
    metric(`${name}.duration_ms`, Date.now() - started, { ...tags, outcome: "error" });
    throw error;
  }
}
