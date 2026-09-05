import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "./session";

/**
 * Object-level authorization (§7).
 *
 * The rule this file exists to enforce, with no exceptions anywhere in the
 * codebase:
 *
 *     never  findUnique({ where: { id } })   then return it
 *     always findFirst({ where: { id, userId } })
 *
 * Fetching by id and *then* checking the owner is a bug waiting to happen —
 * someone adds an early return, or forgets the check on the DELETE handler,
 * and an attacker who can guess an id owns the data. Here ownership is part
 * of the query, so a record belonging to someone else does not come back at
 * all, and there is no code path in which the check can be skipped.
 *
 * Not-found and not-yours produce the identical 404. Distinguishing them
 * would confirm to an attacker that an id exists, which is an enumeration
 * oracle even when the data itself stays hidden.
 */

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Models that carry a direct `userId` column. */
type OwnedModel =
  | "item"
  | "account"
  | "transaction"
  | "holding"
  | "category"
  | "merchantRule"
  | "budget"
  | "goal"
  | "property"
  | "folder";

/**
 * Assert that `id` names a row of `model` owned by `userId`, and return it.
 *
 * Throws NotFoundError for both "no such row" and "not yours".
 */
export async function requireOwned<T>(
  model: OwnedModel,
  id: string,
  userId: string,
  options?: { include?: Record<string, unknown>; select?: Record<string, unknown> },
): Promise<T> {
  // Reject obviously malformed ids before they reach the database, so a
  // hostile id cannot become an expensive query (§14).
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    throw new NotFoundError();
  }

  const delegate = prisma[model] as unknown as {
    findFirst: (args: unknown) => Promise<T | null>;
  };

  const record = await delegate.findFirst({
    // Ownership is part of the WHERE clause, not a later check.
    where: { id, userId },
    ...(options?.include ? { include: options.include } : {}),
    ...(options?.select ? { select: options.select } : {}),
  });

  if (!record) throw new NotFoundError();
  return record;
}

/**
 * Assert ownership without loading the row — for the common
 * "is this id mine before I use it as a foreign key?" check.
 */
export async function assertOwned(
  model: OwnedModel,
  id: string,
  userId: string,
): Promise<void> {
  await requireOwned(model, id, userId, { select: { id: true } });
}

/**
 * Assert ownership of every id in a list, in one query.
 * Used where a request references several objects at once (bulk edits, AI
 * actions). Fails if *any* id is missing or belongs to someone else.
 */
export async function assertAllOwned(
  model: OwnedModel,
  ids: string[],
  userId: string,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  if (unique.length > 500) throw new ForbiddenError("Too many records referenced");
  if (unique.some((id) => typeof id !== "string" || id.length === 0 || id.length > 64)) {
    throw new NotFoundError();
  }

  const delegate = prisma[model] as unknown as {
    count: (args: unknown) => Promise<number>;
  };
  const found = await delegate.count({ where: { id: { in: unique }, userId } });
  if (found !== unique.length) throw new NotFoundError();
}

/**
 * A `where` fragment that scopes any query to one tenant.
 *
 * Written as a helper so that scoping is a visible, greppable act at every
 * call site: `where: { ...ownedBy(user.id), pending: true }`.
 */
export function ownedBy(userId: string): { userId: string } {
  return { userId };
}

/**
 * Resolve an optional foreign key supplied by the client, verifying ownership.
 * Returns null for an absent value, throws for one that is not the user's.
 *
 * This is the guard for the classic cross-tenant write: "move MY transaction
 * into YOUR folder", which would otherwise link two tenants' data together.
 */
export async function resolveOwnedRef(
  model: OwnedModel,
  id: string | null | undefined,
  userId: string,
): Promise<string | null> {
  if (id === null || id === undefined || id === "") return null;
  await assertOwned(model, id, userId);
  return id;
}
