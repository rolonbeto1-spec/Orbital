import "server-only";

/**
 * Case-insensitive text matching that behaves the same on both engines.
 *
 * ## The bug this exists to prevent
 *
 * Prisma's `contains` compiles to `LIKE '%term%'`. SQLite's LIKE is
 * case-insensitive for ASCII by default; PostgreSQL's is not. The test suite
 * runs on SQLite and production runs on PostgreSQL, so a search filter written
 * as `{ name: { contains: search } }` passes every test and then, in
 * production, fails to match "Starbucks" when the user types "starbucks".
 * Nothing in the type system, the schema or the tests reveals it — the query
 * is valid on both engines and simply returns fewer rows on one of them.
 *
 * Prisma exposes `mode: "insensitive"` only on PostgreSQL; the SQLite client
 * does not generate the field at all. So the mode is applied at runtime,
 * against the provider actually in use, and this module is the single place
 * that decision is made.
 *
 * The result is that both engines match case-insensitively, which is what
 * every caller already assumed.
 */

/**
 * True when the live datasource is PostgreSQL.
 *
 * Read from DATABASE_URL rather than from a build-time constant because the
 * same build runs against SQLite in tests and PostgreSQL in production.
 */
function isPostgres(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

/**
 * A `contains` filter that is case-insensitive on every supported engine.
 *
 * Use this instead of a bare `{ contains: term }` for anything a person typed.
 *
 * The cast is deliberate and confined to this function: `mode` is absent from
 * the SQLite client's generated filter type, and adding it there would be
 * both a type error and a runtime error. On SQLite the extra key is simply
 * never produced.
 */
export function containsInsensitive(term: string) {
  return (
    isPostgres() ? { contains: term, mode: "insensitive" } : { contains: term }
  ) as { contains: string };
}
