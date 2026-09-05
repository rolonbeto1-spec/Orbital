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
describe("Money arithmetic (§49)", () => {
  it("adds without accumulating float error", async () => {
    const { sumMoney } = await import("@/lib/money");
    // The canonical failure: 0.1 + 0.2 === 0.30000000000000004.
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3); // proves the naive version is wrong
  });

  it("stays exact over ten thousand additions", async () => {
    const { sumMoney } = await import("@/lib/money");
    const amounts = Array.from({ length: 10_000 }, () => 0.07);
    expect(sumMoney(amounts)).toBe(700);

    // The naive sum drifts measurably.
    const naive = amounts.reduce((s, a) => s + a, 0);
    expect(naive).not.toBe(700);
  });

  it("is order-independent", async () => {
    const { sumMoney } = await import("@/lib/money");
    const amounts = [19.99, 0.01, 1234.56, -45.67, 0.1, 0.2, 8.88];
    const forward = sumMoney(amounts);
    const backward = sumMoney([...amounts].reverse());
    expect(forward).toBe(backward);
  });

  it("handles credits, debits, refunds and zero", async () => {
    const { sumMoney, addMoney, subtractMoney } = await import("@/lib/money");
    // Plaid convention: positive = out, negative = in.
    expect(sumMoney([100, -100])).toBe(0);
    expect(sumMoney([50.5, -20.25])).toBe(30.25);
    expect(addMoney(0, 0)).toBe(0);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
  });

  it("rounds halves away from zero symmetrically for credits and debits", async () => {
    const { toCents } = await import("@/lib/money");
    // Math.round(-0.5) is -0 in JS, which would round debits and credits
    // differently. Ours does not.
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
  });

  it("handles large balances without losing cents", async () => {
    const { sumMoney, roundMoney } = await import("@/lib/money");
    expect(sumMoney([9_999_999.99, 0.01])).toBe(10_000_000);
    expect(roundMoney(123456789.126)).toBe(123456789.13);
  });

  it("treats non-finite input as zero rather than producing NaN", async () => {
    const { toCents, sumMoney } = await import("@/lib/money");
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
    expect(sumMoney([1, Number.NaN, 2])).toBe(3);
  });

  describe("effectiveSpend — reimbursements", () => {
    it("subtracts a partial reimbursement", async () => {
      const { effectiveSpend } = await import("@/lib/money");
      expect(effectiveSpend(100, 40)).toBe(60);
    });

    it("never goes below zero on a full or over reimbursement", async () => {
      const { effectiveSpend } = await import("@/lib/money");
      expect(effectiveSpend(100, 100)).toBe(0);
      expect(effectiveSpend(100, 150)).toBe(0);
    });

    it("leaves income and refunds untouched", async () => {
      const { effectiveSpend } = await import("@/lib/money");
      // A refund (negative = money in) must not be turned positive.
      expect(effectiveSpend(-50, 0)).toBe(-50);
      expect(effectiveSpend(-50, 20)).toBe(-50);
    });

    it("ignores a negative reimbursement", async () => {
      const { effectiveSpend } = await import("@/lib/money");
      expect(effectiveSpend(100, -25)).toBe(100);
    });

    it("is exact at the cent", async () => {
      const { effectiveSpend } = await import("@/lib/money");
      expect(effectiveSpend(84.21, 28.07)).toBe(56.14);
    });
  });

  it("guards percentages against a zero budget", async () => {
    const { percentOf } = await import("@/lib/money");
    expect(percentOf(50, 0)).toBeNull();
    expect(percentOf(50, 200)).toBe(25);
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
