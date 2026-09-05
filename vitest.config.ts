import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Test configuration.
 *
 * Tests run against a real SQLite database (tests/test.db), not mocks. The
 * tenant-isolation tests in particular MUST hit a real database: their whole
 * purpose is to prove that the queries the application actually issues cannot
 * return another tenant's rows, and a mocked Prisma client would prove
 * nothing at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Isolation tests share one database file; running them in one process
    // keeps the fixtures deterministic.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      /**
       * `server-only` throws by design when a server module is pulled into a
       * client bundle — that guard is exactly what we want in the app (§54),
       * and its presence here proves the guard is real. Under Vitest we are
       * deliberately calling server modules from Node, so it is stubbed out.
       */
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
