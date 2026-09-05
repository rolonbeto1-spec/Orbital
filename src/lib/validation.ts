import { z } from "zod";

/**
 * Server-side validation schemas (§14).
 *
 * Client-side validation is a convenience for the person typing. These are the
 * rules that actually hold: every API route and server action validates its
 * input here before anything touches the database.
 *
 * Two habits throughout:
 *  - `.strict()` on objects, so an unexpected property is a 400 rather than
 *    something that quietly rides along into a Prisma `data` object;
 *  - explicit bounds on every string and number, so "excessively large" and
 *    "impossible" inputs are rejected rather than becoming a slow query, a
 *    huge row, or a nonsensical budget.
 */

/** cuid-ish identifier. Bounded so a hostile id cannot become a big query. */
export const idSchema = z
  .string()
  .min(1, "Required")
  .max(64, "Invalid id")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id");

export const optionalId = idSchema.nullable().optional();

/** Free text a user types. Bounded, and trimmed so " " is not a name. */
export const shortText = (max = 120) =>
  z.string().trim().min(1, "Required").max(max, `Must be ${max} characters or fewer`);

export const optionalText = (max = 2000) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : v.trim() === "" ? null : v.trim()));

/**
 * A money amount in dollars.
 *
 * Bounded on both ends: no infinities, no NaN, nothing beyond a plausible
 * personal balance. The upper bound is a denial-of-service and data-integrity
 * control, not a judgement about anyone's net worth.
 */
export const moneyAmount = z
  .number()
  .finite("Must be a number")
  .min(-1_000_000_000, "Out of range")
  .max(1_000_000_000, "Out of range");

/** A non-negative amount, for budgets, goals and reimbursements. */
export const positiveMoney = z
  .number()
  .finite("Must be a number")
  .min(0, "Cannot be negative")
  .max(1_000_000_000, "Out of range");

/** YYYY-MM, validated as a real month. */
export const monthKey = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM")
  .refine((v) => {
    const year = Number(v.slice(0, 4));
    return year >= 1970 && year <= 2200;
  }, "Out of range");

export const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"));

/** Pagination. Hard caps so no request can ask for the whole table (§51). */
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * Search text (§52). Length-capped so it cannot become an expensive scan, and
 * treated strictly as a literal substring by the query layer — never
 * interpolated into SQL and never compiled into a regular expression, which
 * is where the ReDoS risk would come from.
 */
export const searchText = z
  .string()
  .trim()
  .min(1)
  .max(80, "Search is limited to 80 characters")
  .optional();

export const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    // Validate against the runtime's own IANA database rather than a
    // hand-maintained list.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const transactionListQuery = z
  .object({
    month: monthKey.optional(),
    days: z.coerce.number().int().min(1).max(1095).optional(),
    category: idSchema.optional(),
    account: idSchema.optional(),
    bank: idSchema.optional(),
    folder: idSchema.optional(),
    search: searchText,
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const transactionUpdate = z
  .object({
    categoryId: optionalId,
    notes: optionalText(1000),
    folderId: optionalId,
    folderName: shortText(60).optional(),
    owedBack: z.boolean().optional(),
    reimbursedAmount: positiveMoney.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const budgetCreate = z
  .object({
    categoryId: idSchema,
    amount: positiveMoney,
  })
  .strict();

export const budgetUpdate = z.object({ amount: positiveMoney }).strict();

export const goalCreate = z
  .object({
    name: shortText(80),
    targetAmount: positiveMoney.refine((v) => v > 0, "Must be more than zero"),
    currentAmount: positiveMoney.default(0),
    targetDate: isoDate.nullable().optional(),
    icon: shortText(40).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex colour")
      .optional(),
  })
  .strict();

export const goalUpdate = goalCreate.partial().strict();

export const folderCreate = z.object({ name: shortText(60) }).strict();

export const propertyCreate = z
  .object({
    name: shortText(80),
    rentIncome: positiveMoney.default(0),
    mortgage: positiveMoney.default(0),
    utilities: positiveMoney.default(0),
    hoa: positiveMoney.default(0),
    sweatIn: positiveMoney.default(0),
    sweatOut: positiveMoney.default(0),
    notes: optionalText(1000),
  })
  .strict();

export const propertyUpdate = propertyCreate.partial().strict();

export const accountUpdate = z.object({ isBusiness: z.boolean() }).strict();

export const categoryUpdate = z.object({ inBudget: z.boolean().nullable() }).strict();

/** AI chat input. Length-bounded so one request cannot buy a large bill (§33). */
export const assistantRequest = z
  .object({
    message: z.string().trim().min(1, "Say something").max(2000, "Message is too long"),
  })
  .strict();

export const cancelHelpRequest = z.object({ merchant: shortText(100) }).strict();

export const profileUpdate = z
  .object({
    name: shortText(80).optional(),
    timezone: timezone.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const consentUpdate = z
  .object({
    acceptTerms: z.literal(true).optional(),
    acceptPrivacy: z.literal(true).optional(),
    acceptBankConsent: z.literal(true).optional(),
  })
  .strict();

export const plaidExchange = z
  .object({
    // Plaid's public tokens are opaque; bound the length and character set so
    // a hostile value cannot be smuggled onward.
    public_token: z
      .string()
      .min(10)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+$/, "Invalid token"),
  })
  .strict();

export const hiveLayoutUpdate = z
  .object({
    // A map of cell id -> {x, y}. Bounded in both size and coordinate range so
    // the settings row cannot be used as arbitrary storage.
    layout: z
      .record(
        z.string().max(64),
        z.object({ x: z.number().finite().min(-5000).max(5000), y: z.number().finite().min(-5000).max(5000) }).strict(),
      )
      .refine((v) => Object.keys(v).length <= 100, "Too many cells"),
  })
  .strict();

export const alertPrefsUpdate = z
  .object({
    bigPurchase: z.boolean().optional(),
    bigPurchaseThreshold: positiveMoney.max(100_000).optional(),
    lowBalance: z.boolean().optional(),
    lowBalanceThreshold: positiveMoney.max(100_000).optional(),
    weeklyDigest: z.boolean().optional(),
    budgetOverrun: z.boolean().optional(),
  })
  .strict();
