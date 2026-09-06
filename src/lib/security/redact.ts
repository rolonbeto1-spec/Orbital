/**
 * Redaction for logs, error reports and analytics (§12, §39, §40).
 *
 * The threat this addresses is mundane and extremely common: a developer
 * writes `console.error("sync failed", err, item)` and a Plaid access token,
 * a balance, and a list of the user's merchants land in a log aggregator that
 * a much wider group of people can read than can read the database.
 *
 * So: the logger never accepts a raw object. Everything passes through
 * `redact()`, which works from a deny-list of key names AND a value-shaped
 * detector for credentials, and truncates anything unexpectedly large.
 *
 * This module is deliberately dependency-free and safe to import anywhere,
 * including tests and the edge runtime.
 */

/** Key names whose values must never be logged, matched case-insensitively. */
const SECRET_KEYS = [
  "accesstoken",
  "access_token",
  "accesstokencipher",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "publictoken",
  "public_token",
  "linktoken",
  "link_token",
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "secret",
  "clientsecret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "setcookie",
  "set-cookie",
  "sessiontoken",
  "session_token",
  "token",
  "csrf",
  "signature",
  "encryptionkey",
  "databaseurl",
  "database_url",
  "connectionstring",
];

/** Key names holding financial detail. Logged as a type marker, never a value. */
const FINANCIAL_KEYS = [
  "amount",
  "amountcents",
  "balance",
  "currentbalance",
  "availablebalance",
  "reimbursedamount",
  "targetamount",
  "currentamount",
  "rentincome",
  "mortgage",
  "merchantname",
  "plaidcategory",
  "notes",
  "mask",
  "accountnumber",
  "account_number",
  "routingnumber",
  "iban",
  "holdings",
  "transactions",
  "snapshot",
];

/** Personal identifiers: kept only as a coarse, non-reversible marker. */
const PII_KEYS = ["email", "phone", "phonenumber", "ssn", "taxid", "address", "ip", "ipaddress"];

/**
 * Keys whose VALUE is a financial record rather than a scalar — an account,
 * an item, a transaction. Matched by exact name, never by substring, so that
 * `itemId` and `accountId` (useful, non-personal identifiers) keep flowing
 * through while `item` and `account` do not.
 *
 * Without this, `log.error("failed", { account })` publishes the bank's name,
 * the mask and the balance. The nested field names are innocuous — `name` is
 * just `name` — so no deny-list of leaf keys can catch it. The container is
 * what identifies the contents.
 */
const FINANCIAL_CONTAINER_KEYS = new Set([
  "account", "accounts", "item", "items", "transaction", "holding",
  "merchant", "budget", "budgets", "goal", "goals", "property", "properties",
  "category", "categories", "rule", "rules", "user", "owner",
]);

const MAX_STRING = 200;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

/**
 * Value-shaped credential detection, for secrets that arrive under an
 * innocent key name (a message string, a URL query, a stack frame).
 */
const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  // Plaid access + public tokens.
  [/\baccess-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, "[redacted:plaid-access-token]"],
  [/\bpublic-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, "[redacted:plaid-public-token]"],
  [/\blink-(sandbox|development|production)-[A-Za-z0-9-]{8,}/g, "[redacted:plaid-link-token]"],
  // Anthropic keys.
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, "[redacted:anthropic-key]"],
  // Resend keys.
  [/\bre_[A-Za-z0-9_-]{16,}/g, "[redacted:email-key]"],
  // Postgres/MySQL connection strings with inline credentials.
  [/\b(postgres|postgresql|mysql):\/\/[^\s"']+/gi, "[redacted:connection-string]"],
  // Bearer tokens and JWTs.
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, "[redacted:bearer]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted:jwt]"],
  // Anything that looks like an email address.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted:email]"],
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function keyIn(key: string, list: string[]): boolean {
  const k = normalizeKey(key);
  return list.some((entry) => k === normalizeKey(entry) || k.includes(normalizeKey(entry)));
}

/**
 * Long digit runs in free text: an amount in cents, an account number, a
 * card's last digits stitched into a sentence. Four or more digits is the
 * threshold because a balance is always at least that once it is in cents,
 * while a year, an HTTP status and a small count are not.
 *
 * Applied after the credential patterns, so it cannot break a token match.
 */
const LONG_NUMBER = /\d{4,}/g;

/** Scrub credential-shaped substrings out of free text. */
export function scrubString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(LONG_NUMBER, "[redacted:number]");
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  return out;
}

/**
 * Recursively redact a value so it is safe to log.
 *
 * Rules:
 *  - a secret-named key becomes "[redacted]" — the value is never inspected;
 *  - a financial-named key becomes a type marker such as "[number]";
 *  - a PII-named key becomes "[redacted:pii]";
 *  - every remaining string is scrubbed for credential-shaped content;
 *  - depth, array length and string length are bounded, so one stray object
 *    cannot flood the log or the function's memory.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return redactError(value);
  }

  if (Array.isArray(value)) {
    const shown = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY) shown.push(`[+${value.length - MAX_ARRAY} more]`);
    return shown;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (keyIn(key, SECRET_KEYS)) {
        out[key] = "[redacted]";
      } else if (FINANCIAL_CONTAINER_KEYS.has(normalizeKey(key))) {
        out[key] = financialMarker(raw);
      } else if (keyIn(key, FINANCIAL_KEYS)) {
        out[key] = financialMarker(raw);
      } else if (keyIn(key, PII_KEYS)) {
        out[key] = "[redacted:pii]";
      } else {
        out[key] = redact(raw, depth + 1);
      }
    }
    return out;
  }

  return "[unknown]";
}

/**
 * Mark an error's message as safe to log verbatim.
 *
 * Default-deny is the rule here, and the reason is that most errors are not
 * ours. Prisma embeds column values in constraint violations, SDKs embed
 * request URLs and identifiers, Node embeds filesystem paths. A message like
 * `failed writing Acme Savings balance 4210055` contains a bank account name
 * and an exact balance, and neither has a shape any pattern can recognise —
 * an account name is just words. So a message is withheld unless the code
 * that threw it says it carries no user data.
 *
 * What survives redaction is still enough to debug with: the error class, its
 * code or status, the stack frames, and the correlation id that ties the log
 * line to the user's error reference.
 */
export function safeToLog<E extends Error>(error: E): E {
  Object.defineProperty(error, SAFE_MESSAGE, { value: true, enumerable: false });
  return error;
}

const SAFE_MESSAGE = Symbol.for("metta.safeLogMessage");

/** Errors whose messages we author and which never interpolate user data. */
const SAFE_ERROR_NAMES = new Set([
  "UnauthenticatedError",
  "ForbiddenError",
  "NotFoundError",
  "HttpError",
  "AiBudgetExceeded",
  "ZodError",
]);

function redactError(error: Error): Record<string, unknown> {
  const carrier = error as Error & {
    code?: unknown;
    status?: unknown;
    [SAFE_MESSAGE]?: boolean;
  };

  const messageIsSafe =
    carrier[SAFE_MESSAGE] === true || SAFE_ERROR_NAMES.has(error.name);

  return {
    name: error.name,
    // A code or status is a low-cardinality constant, not user data, and is
    // usually the single most useful field when reading logs.
    ...(typeof carrier.code === "string" || typeof carrier.code === "number"
      ? { code: carrier.code }
      : {}),
    ...(typeof carrier.status === "number" ? { status: carrier.status } : {}),
    message: messageIsSafe
      ? scrubString(error.message)
      : `[message withheld: ${error.message.length} chars]`,
    // Stack traces are kept server-side only, scrubbed, and stripped of their
    // first line — that line is a copy of the message.
    stack: error.stack
      ? scrubString(
          error.stack
            .split("\n")
            .slice(1, 6)
            .join("\n"),
        )
      : undefined,
  };
}

/**
 * Financial values are replaced by a shape marker. "It was a number" is
 * enough to debug a type error; the number itself is the user's business.
 */
function financialMarker(value: unknown): string {
  if (value === null || value === undefined) return "[empty]";
  if (typeof value === "number") return "[number]";
  if (typeof value === "string") return "[string]";
  if (Array.isArray(value)) return `[array:${value.length}]`;
  return "[value]";
}

/**
 * Safe rendering of a URL for logs: path and known-safe query keys only.
 * Query strings are a favourite hiding place for tokens.
 */
export function redactUrl(input: string): string {
  try {
    const url = new URL(input, "http://internal.invalid");
    const keptParams: string[] = [];
    for (const key of url.searchParams.keys()) {
      keptParams.push(keyIn(key, [...SECRET_KEYS, ...PII_KEYS]) ? `${key}=[redacted]` : `${key}=…`);
    }
    return keptParams.length > 0 ? `${url.pathname}?${keptParams.join("&")}` : url.pathname;
  } catch {
    return "[unparseable-url]";
  }
}
