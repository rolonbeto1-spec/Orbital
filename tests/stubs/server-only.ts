/**
 * Test stub for the `server-only` package.
 *
 * In the real build, importing `server-only` from a Client Component is a
 * hard error — that is the mechanism enforcing §54 (no module holding Prisma,
 * Plaid secrets, encryption keys or server auth may be bundled into client
 * JavaScript). Vitest runs those same modules deliberately, in Node, so the
 * marker is a no-op here.
 */
export {};
