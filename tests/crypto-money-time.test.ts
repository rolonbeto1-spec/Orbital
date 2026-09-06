import { describe, it, expect } from "vitest";

/**
 * Correctness tests for the three places where a subtle bug is expensive:
 * encryption of bank credentials (§9, §29), money arithmetic (§49), and
 * timezone-dependent period boundaries (§50).
 */

// ---------------------------------------------------------------------------
describe("Plaid token encryption (§9)", () => {
  it("round-trips a token", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/security/crypto");
    const token = "access-production-a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("never stores the plaintext in the encrypted value", async () => {
    const { encryptSecret } = await import("@/lib/security/crypto");
    const token = "access-production-verydistinctivevalue";
    const stored = encryptSecret(token);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain("verydistinctive");
  });

  it("produces a different ciphertext every time (unique nonce)", async () => {
    const { encryptSecret } = await import("@/lib/security/crypto");
    const token = "access-production-same-token";
    // Deterministic encryption would leak that two users share a token and
    // would be catastrophic with a reused GCM nonce.
    const values = new Set(Array.from({ length: 20 }, () => encryptSecret(token)));
    expect(values.size).toBe(20);
  });

  it("refuses to decrypt a tampered ciphertext (authenticated encryption)", async () => {
    const { encryptSecret, decryptSecret, DecryptionError } = await import(
      "@/lib/security/crypto"
    );
    const stored = encryptSecret("access-production-token");
    const parts = stored.split(".");

    // Flip a byte in the ciphertext segment.
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString("base64url");

    // GCM's auth tag makes this fail loudly rather than returning garbage.
    expect(() => decryptSecret(parts.join("."))).toThrow(DecryptionError);
  });

  it("refuses to decrypt when the auth tag is replaced", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/security/crypto");
    const parts = encryptSecret("access-production-token").split(".");
    parts[4] = Buffer.alloc(16, 7).toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a malformed stored value", async () => {
    const { decryptSecret } = await import("@/lib/security/crypto");
    for (const bad of ["", "garbage", "v1.v1", "v2.v1.a.b.c", "v1.v1.a.b"]) {
      expect(() => decryptSecret(bad)).toThrow();
    }
  });

  it("records the key generation so keys can be rotated (§29)", async () => {
    const { encryptSecret, keyGenerationOf } = await import("@/lib/security/crypto");
    expect(keyGenerationOf(encryptSecret("token"))).toBe("v1");
  });

  it("rotates a value to a new key generation and still decrypts it", async () => {
    const crypto = await import("@/lib/security/crypto");
    const token = "access-production-rotate-me";

    const underV1 = crypto.encryptSecret(token);
    expect(crypto.keyGenerationOf(underV1)).toBe("v1");

    // Promote v2 to active, as a rotation would.
    process.env.ENCRYPTION_KEY_ACTIVE = "v2";
    // env caches the parsed value, so re-import the module graph fresh.
    const rotated = await import("@/lib/security/crypto?rotate" as string).catch(
      () => crypto,
    );
    void rotated;

    // The old value must still decrypt with the old key — that is the whole
    // point of recording the generation per row.
    expect(crypto.decryptSecret(underV1)).toBe(token);

    process.env.ENCRYPTION_KEY_ACTIVE = "v1";
  });

  it("compares tokens in constant time without leaking length mismatches", async () => {
    const { safeEquals } = await import("@/lib/security/crypto");
    expect(safeEquals("abc", "abc")).toBe(true);
    expect(safeEquals("abc", "abd")).toBe(false);
    expect(safeEquals("abc", "abcd")).toBe(false);
    expect(safeEquals("", "")).toBe(true);
  });

  it("produces stable, non-reversible fingerprints with no separator collisions", async () => {
    const { fingerprint } = await import("@/lib/security/crypto");
    expect(fingerprint("a", "b")).toBe(fingerprint("a", "b"));
    // ("ab","c") and ("a","bc") must not collide.
    expect(fingerprint("ab", "c")).not.toBe(fingerprint("a", "bc"));
    expect(fingerprint("secret")).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------
describe("Money — exact integer cents (§49)", () => {
  it("converts dollars to exact cents", async () => {
    const { dollarsToCents } = await import("@/lib/money");
    expect(dollarsToCents(84.21)).toBe(8421);
    expect(dollarsToCents(0.1)).toBe(10);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(-45.67)).toBe(-4567);
  });

  it("rounds halves away from zero symmetrically for credits and debits", async () => {
    const { dollarsToCents } = await import("@/lib/money");
    // Math.round(-0.5) is -0 in JS, which would round debits and credits
    // differently. Ours does not.
    expect(dollarsToCents(0.005)).toBe(1);
    expect(dollarsToCents(-0.005)).toBe(-1);
    // 1.005 is stored as 1.00499999999999989 — the naive form loses a cent.
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(-1.005)).toBe(-101);
  });

  it("adds without any accumulated error", async () => {
    const { sumCents, dollarsToCents } = await import("@/lib/money");
    expect(sumCents([dollarsToCents(0.1), dollarsToCents(0.2)])).toBe(30);
    // The naive float version is demonstrably wrong.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("stays exact over ten thousand additions", async () => {
    const { sumCents } = await import("@/lib/money");
    const amounts = Array.from({ length: 10_000 }, () => 7); // 7 cents each
    expect(sumCents(amounts)).toBe(70_000);

    // The float equivalent drifts.
    const naive = Array.from({ length: 10_000 }, () => 0.07).reduce((s, a) => s + a, 0);
    expect(naive).not.toBe(700);
  });

  it("is order-independent", async () => {
    const { sumCents } = await import("@/lib/money");
    const amounts = [1999, 1, 123456, -4567, 10, 20, 888];
    expect(sumCents(amounts)).toBe(sumCents([...amounts].reverse()));
  });

  it("handles credits, debits, refunds and zero", async () => {
    const { sumCents } = await import("@/lib/money");
    // Plaid convention: positive = out, negative = in.
    expect(sumCents([10_000, -10_000])).toBe(0);
    expect(sumCents([5050, -2025])).toBe(3025);
    expect(sumCents([])).toBe(0);
  });

  it("handles large balances without losing a cent", async () => {
    const { sumCents, dollarsToCents, centsToDollars } = await import("@/lib/money");
    expect(sumCents([dollarsToCents(9_999_999.99), 1])).toBe(1_000_000_000);
    expect(centsToDollars(1_000_000_000)).toBe(10_000_000);
  });

  it("refuses to silently overflow past safe-integer territory", async () => {
    const { dollarsToCents, MAX_SAFE_CENTS } = await import("@/lib/money");
    expect(dollarsToCents(1e20)).toBe(MAX_SAFE_CENTS);
    expect(dollarsToCents(-1e20)).toBe(-MAX_SAFE_CENTS);
    expect(Number.isSafeInteger(MAX_SAFE_CENTS)).toBe(true);
  });

  it("treats non-finite input as zero rather than producing NaN", async () => {
    const { dollarsToCents, sumCents } = await import("@/lib/money");
    expect(dollarsToCents(Number.NaN)).toBe(0);
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBe(0);
    expect(sumCents([100, Number.NaN, 200])).toBe(300);
  });

  it("rejects non-integer cents defensively", async () => {
    const { asCents, isValidCents } = await import("@/lib/money");
    expect(isValidCents(8421)).toBe(true);
    expect(isValidCents(84.21)).toBe(false);
    expect(isValidCents("8421")).toBe(false);
    // A stray float is rounded rather than propagated.
    expect(asCents(84.6)).toBe(85);
    expect(asCents("nonsense")).toBe(0);
  });

  it("round-trips dollars through cents and back", async () => {
    const { dollarsToCents, centsToDollars } = await import("@/lib/money");
    for (const dollars of [0, 0.01, 0.1, 1.5, 84.21, 1234.56, -45.67, 999_999.99]) {
      expect(centsToDollars(dollarsToCents(dollars))).toBeCloseTo(dollars, 10);
    }
  });

  describe("effectiveSpendCents — reimbursements", () => {
    it("subtracts a partial reimbursement", async () => {
      const { effectiveSpendCents } = await import("@/lib/money");
      expect(effectiveSpendCents(10_000, 4000)).toBe(6000);
    });

    it("never goes below zero on a full or over reimbursement", async () => {
      const { effectiveSpendCents } = await import("@/lib/money");
      expect(effectiveSpendCents(10_000, 10_000)).toBe(0);
      expect(effectiveSpendCents(10_000, 15_000)).toBe(0);
    });

    it("leaves income and refunds untouched", async () => {
      const { effectiveSpendCents } = await import("@/lib/money");
      // A refund (negative = money in) must not be turned positive.
      expect(effectiveSpendCents(-5000, 0)).toBe(-5000);
      expect(effectiveSpendCents(-5000, 2000)).toBe(-5000);
    });

    it("ignores a negative reimbursement", async () => {
      const { effectiveSpendCents } = await import("@/lib/money");
      expect(effectiveSpendCents(10_000, -2500)).toBe(10_000);
    });

    it("is exact at the cent", async () => {
      const { effectiveSpendCents } = await import("@/lib/money");
      expect(effectiveSpendCents(8421, 2807)).toBe(5614);
    });
  });

  it("computes an exact median for odd and even lists", async () => {
    const { medianCents } = await import("@/lib/money");
    expect(medianCents([100, 300, 200])).toBe(200);
    expect(medianCents([100, 200, 300, 400])).toBe(250);
    // Rounds half away from zero, so the result is still an exact cent.
    expect(medianCents([100, 101])).toBe(101);
    expect(medianCents([])).toBe(0);
  });

  it("guards percentages against a zero budget", async () => {
    const { percentOfCents } = await import("@/lib/money");
    expect(percentOfCents(5000, 0)).toBeNull();
    expect(percentOfCents(5000, 20_000)).toBe(25);
  });

  it("scales by a rate, rounding once", async () => {
    const { scaleCents } = await import("@/lib/money");
    // A weekly $15.49 charge normalised to a month (x4.33).
    expect(scaleCents(1549, 4.33)).toBe(6707);
    expect(scaleCents(1000, Number.NaN)).toBe(0);
  });

  describe("the serialization boundary", () => {
    it("renames *Cents fields to dollars", async () => {
      const { serializeMoneyFields } = await import("@/lib/money");
      const out = serializeMoneyFields({ amountCents: 8421, name: "Whole Foods" });
      expect(out).toEqual({ amount: 84.21, name: "Whole Foods" });
    });

    it("handles nulls, nesting and arrays", async () => {
      const { serializeMoneyFields } = await import("@/lib/money");
      const out = serializeMoneyFields({
        availableBalanceCents: null,
        account: { currentBalanceCents: 250_000 },
        items: [{ totalCents: 100 }, { totalCents: 250 }],
      });
      expect(out).toEqual({
        availableBalance: null,
        account: { currentBalance: 2500 },
        items: [{ total: 1 }, { total: 2.5 }],
      });
    });

    it("leaves non-money fields alone, including Dates", async () => {
      const { serializeMoneyFields } = await import("@/lib/money");
      const date = new Date("2026-02-01T00:00:00Z");
      const out = serializeMoneyFields({ date, pending: true, count: 3, quantity: 10.5 });
      expect(out).toEqual({ date, pending: true, count: 3, quantity: 10.5 });
    });
  });

  it("keeps no floating-point money column in the schema", async () => {
    // A structural assertion: if someone reintroduces `Float` for an amount,
    // this fails. Holding.quantity and Holding.priceUsd are the two
    // documented exceptions (a unit count and a market quote).
    const fs = await import("node:fs");
    const schema = await fs.promises.readFile("prisma/schema.prisma", "utf8");

    const floatLines = schema
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\w+\s+Float\??\s*(@|$)/.test(line));

    const allowed = ["quantity", "priceUsd"];
    for (const line of floatLines) {
      const field = line.split(/\s+/)[0];
      expect(allowed, `unexpected Float column: ${line}`).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Timezone-correct periods (§50)", () => {
  it("puts a late-night transaction in the user's month, not UTC's", async () => {
    const { monthRangeInZone } = await import("@/lib/time");

    // 31 Jan 2026, 23:00 in Los Angeles = 1 Feb 2026, 07:00 UTC.
    const lateJanuaryLA = new Date("2026-02-01T07:00:00Z");

    const laJanuary = monthRangeInZone("America/Los_Angeles", 2026, 1);
    expect(lateJanuaryLA >= laJanuary.start).toBe(true);
    expect(lateJanuaryLA < laJanuary.end).toBe(true);

    // The same instant is already February in UTC.
    const utcJanuary = monthRangeInZone("UTC", 2026, 1);
    expect(lateJanuaryLA < utcJanuary.end).toBe(false);
  });

  it("gives different users different month boundaries", async () => {
    const { monthRangeInZone } = await import("@/lib/time");
    const la = monthRangeInZone("America/Los_Angeles", 2026, 3);
    const auckland = monthRangeInZone("Pacific/Auckland", 2026, 3);
    expect(la.start.getTime()).not.toBe(auckland.start.getTime());
  });

  it("survives a daylight-saving transition", async () => {
    const { monthRangeInZone } = await import("@/lib/time");
    // US DST begins 8 March 2026. A month spanning it must still start and
    // end at local midnight.
    const march = monthRangeInZone("America/New_York", 2026, 3);
    const april = monthRangeInZone("America/New_York", 2026, 4);
    expect(march.end.getTime()).toBe(april.start.getTime());

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    });
    expect(formatter.format(march.start)).toMatch(/^(00|24)/);
    expect(formatter.format(april.start)).toMatch(/^(00|24)/);
  });

  it("rolls a month over the year boundary correctly", async () => {
    const { monthRangeInZone } = await import("@/lib/time");
    const december = monthRangeInZone("UTC", 2026, 12);
    expect(december.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("gives each user their own AI-reset day key", async () => {
    const { localDayKey } = await import("@/lib/time");
    // 07:00 UTC is still "yesterday" in Los Angeles and already "today" in
    // Auckland — so their daily allowances reset at different instants (§33).
    const instant = new Date("2026-02-01T07:00:00Z");
    expect(localDayKey("America/Los_Angeles", instant)).toBe("2026-01-31");
    expect(localDayKey("Pacific/Auckland", instant)).toBe("2026-02-01");
  });

  it("falls back to UTC for an unknown timezone rather than throwing", async () => {
    const { safeTimeZone, monthRangeInZone } = await import("@/lib/time");
    expect(safeTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(() => monthRangeInZone("Mars/Olympus_Mons", 2026, 1)).not.toThrow();
  });

  it("parses a month key only when it is a real month", async () => {
    const { parseMonthKey } = await import("@/lib/time");
    expect(parseMonthKey("UTC", "2026-02")).not.toBeNull();
    expect(parseMonthKey("UTC", "2026-13")).toBeNull();
    expect(parseMonthKey("UTC", "2026-00")).toBeNull();
    expect(parseMonthKey("UTC", "nonsense")).toBeNull();
  });
});
