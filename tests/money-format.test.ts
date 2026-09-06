import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  asCents,
  dollarsToCents,
  isUnboundedBand,
  MAX_SAFE_CENTS,
  serializeMoneyFields,
  UNBOUNDED_MAX_CENTS,
  UNBOUNDED_MIN_CENTS,
} from "@/lib/money";
import { formatCents, formatCurrency } from "@/lib/format";

/**
 * Guards for two defects that a SQLite-only test suite cannot see, and one
 * that the type system cannot see. All three were live in this branch.
 *
 * 1. Money columns declared `Int` become 32-bit `INTEGER` on PostgreSQL — a
 *    ceiling of $21,474,836.47 — while SQLite's INTEGER is 64-bit. Every
 *    test passed; production would have rejected the INSERT outright with
 *    `integer out of range`, failing an entire Plaid sync on one large
 *    balance. The columns are `BigInt` now, and this file keeps them that way.
 *
 * 2. A UNIQUE index containing a nullable column is not a constraint. Both
 *    engines treat every NULL as distinct, so UNIQUE(userId, match, min, max)
 *    permitted unlimited duplicate rows for the common case where min and max
 *    were NULL. Sentinel bounds replaced the NULLs.
 *
 * 3. `formatCurrency` takes dollars and `formatCents` takes cents, and both
 *    are `number`, so passing the wrong one is a silent 100x error rather
 *    than a compile failure.
 */

const SCHEMA = fs.readFileSync("prisma/schema.prisma", "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!full.includes("generated")) sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

describe("Money columns are 64-bit on every engine", () => {
  it("declares every *Cents column as BigInt, never Int", () => {
    // `Int` is 32-bit on PostgreSQL. Any money column declared Int is a
    // production-only failure that no SQLite test can reach.
    const offenders: string[] = [];
    for (const line of SCHEMA.split("\n")) {
      const match = /^\s*(\w*[Cc]ents\w*)\s+(\w+)/.exec(line);
      if (match && match[2] === "Int") offenders.push(match[1]);
    }
    expect(offenders, `These money columns are 32-bit on Postgres: ${offenders.join(", ")}`).toEqual([]);
  });

  it("finds the money columns at all, so the check cannot pass vacuously", () => {
    const declared = SCHEMA.split("\n").filter((l) => /^\s*\w*[Cc]ents\w*\s+BigInt/.test(l));
    expect(declared.length).toBeGreaterThan(10);
  });

  it("clamps at 2^53, which a BIGINT column can hold and an INTEGER cannot", () => {
    expect(MAX_SAFE_CENTS).toBe(Number.MAX_SAFE_INTEGER - 991); // 9_007_199_254_740_000
    expect(Number.isSafeInteger(MAX_SAFE_CENTS)).toBe(true);
    // Above the old 32-bit ceiling by a wide margin.
    expect(MAX_SAFE_CENTS).toBeGreaterThan(2_147_483_647);
    // A $25,000,000.00 balance — the value that failed to INSERT on Postgres.
    expect(dollarsToCents(25_000_000)).toBe(2_500_000_000);
  });

  it("reads a bigint back as an exact number", () => {
    expect(asCents(2_500_000_000n)).toBe(2_500_000_000);
    expect(asCents(-8_421n)).toBe(-8_421);
    expect(asCents(BigInt(MAX_SAFE_CENTS))).toBe(MAX_SAFE_CENTS);
    // Beyond 2^53 a number cannot be exact, so it clamps rather than lying.
    expect(asCents(BigInt(MAX_SAFE_CENTS) * 1000n)).toBe(MAX_SAFE_CENTS);
    expect(asCents(BigInt(-MAX_SAFE_CENTS) * 1000n)).toBe(-MAX_SAFE_CENTS);
  });

  it("serializes bigint money fields to dollars, not to raw bigints", () => {
    // The failure this prevents is JSON.stringify throwing on a bigint, or
    // worse, an amountCents leaking to the client under its cents name.
    const out = serializeMoneyFields({ amountCents: 8_421n, name: "Coffee" });
    expect(out).toEqual({ amount: 84.21, name: "Coffee" });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("never lets a bigint reach JSON, even under an unrecognised field name", () => {
    const out = serializeMoneyFields({ someCount: 12n });
    expect(out.someCount).toBe(12);
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

describe("Unique constraints contain no nullable columns", () => {
  it("has no @@unique naming an optional field", () => {
    // A NULL never equals a NULL, so a unique index over a nullable column
    // silently permits duplicates. This walks each model, collects the fields
    // declared optional, and rejects any @@unique that references one.
    const problems: string[] = [];
    for (const block of SCHEMA.split(/\nmodel\s+/).slice(1)) {
      const model = block.split(/\s/)[0];
      const optional = new Set<string>();
      for (const line of block.split("\n")) {
        const field = /^\s*(\w+)\s+\w+\?/.exec(line);
        if (field) optional.add(field[1]);
      }
      for (const unique of block.matchAll(/@@unique\(\[([^\]]+)\]/g)) {
        for (const raw of unique[1].split(",")) {
          const name = raw.trim();
          if (optional.has(name)) problems.push(`${model}.${name}`);
        }
      }
    }
    expect(
      problems,
      `Unique constraints over nullable columns do not constrain anything: ${problems.join(", ")}`,
    ).toEqual([]);
  });

  it("treats the sentinel band as unbounded", () => {
    expect(isUnboundedBand(UNBOUNDED_MIN_CENTS, UNBOUNDED_MAX_CENTS)).toBe(true);
    expect(isUnboundedBand(0, 1_000)).toBe(false);
    expect(isUnboundedBand(UNBOUNDED_MIN_CENTS, 1_000)).toBe(false);
    // And reading them back from a BIGINT column gives the same answer.
    expect(isUnboundedBand(BigInt(UNBOUNDED_MIN_CENTS), BigInt(UNBOUNDED_MAX_CENTS))).toBe(true);
  });
});

describe("Cents and dollars are never confused at a format call", () => {
  it("formats cents and dollars differently, which is why the split exists", () => {
    expect(formatCents(8_421)).toBe("$84.21");
    expect(formatCurrency(8_421)).toBe("$8,421.00");
    expect(formatCents(8_421n)).toBe("$84.21");
  });

  it("uses formatCents, never formatCurrency, in server-side modules", () => {
    // Server modules work in exact cents. A direct formatCurrency call there
    // renders a 100x overstatement, and both parameters are `number`, so
    // nothing else catches it.
    const offenders: string[] = [];
    for (const file of sourceFiles("src/lib")) {
      // format.ts declares both and defines formatCents in terms of
      // formatCurrency; it is the one place the dollars formatter belongs.
      if (file.endsWith("format.ts")) continue;
      const source = fs.readFileSync(file, "utf8");
      if (/\bformatCurrency\s*\(/.test(source)) offenders.push(file);
    }
    expect(
      offenders,
      `Server modules must call formatCents (cents), not formatCurrency (dollars): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
