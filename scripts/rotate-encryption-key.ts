#!/usr/bin/env tsx
/**
 * Re-encrypt every stored Plaid token under the active key generation (§29).
 *
 * How rotation works here: each Item records the key generation its ciphertext
 * was produced with (`accessTokenKeyId`). Old and new keys can therefore be
 * configured at the same time — old rows keep decrypting while new writes use
 * the new generation. This script walks the backlog.
 *
 * Order of operations (also in SECRET_ROTATION.md and INCIDENT_RESPONSE.md §3):
 *
 *   1. Add ENCRYPTION_KEY_V<n+1> alongside the existing key. Keep both.
 *   2. Set ENCRYPTION_KEY_ACTIVE=v<n+1>. Redeploy.
 *   3. Run this script.
 *   4. Confirm zero rows remain on the old generation.
 *   5. Only then remove the old key and redeploy.
 *
 * Removing the old key before step 4 completes makes those rows permanently
 * undecryptable, which means every affected user must reconnect their bank.
 *
 * Usage:
 *   npx tsx scripts/rotate-encryption-key.ts --dry-run
 *   npx tsx scripts/rotate-encryption-key.ts
 */

import { PrismaClient } from "../src/generated/prisma";
import { rotateSecret, keyGenerationOf } from "../src/lib/security/crypto";
import { activeEncryptionKey } from "../src/lib/env";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const active = activeEncryptionKey();
  if (!active) {
    console.error(
      "No active encryption key. Set ENCRYPTION_KEY_<gen> and ENCRYPTION_KEY_ACTIVE.",
    );
    process.exit(1);
  }

  console.log(`Active key generation: ${active.id}`);
  console.log(DRY_RUN ? "MODE: dry run (no writes)" : "MODE: LIVE");

  const items = await prisma.item.findMany({
    select: { id: true, accessTokenCipher: true, accessTokenKeyId: true },
  });

  const stale = items.filter((item) => keyGenerationOf(item.accessTokenCipher) !== active.id);

  console.log(`\nItems total:            ${items.length}`);
  console.log(`Already on ${active.id}:${" ".repeat(Math.max(1, 12 - active.id.length))}${items.length - stale.length}`);
  console.log(`Needing re-encryption:  ${stale.length}`);

  if (stale.length === 0) {
    console.log("\nNothing to do. It is now safe to remove older key generations.");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. Nothing was written.");
    await prisma.$disconnect();
    return;
  }

  let rotated = 0;
  let failed = 0;

  for (const item of stale) {
    try {
      const next = rotateSecret(item.accessTokenCipher);
      if (!next) continue; // already current
      await prisma.item.update({
        where: { id: item.id },
        data: { accessTokenCipher: next, accessTokenKeyId: active.id },
      });
      rotated++;
    } catch (error) {
      // Almost always means the key that encrypted this row is no longer
      // configured. Report the item id — never the ciphertext.
      failed++;
      console.error(
        `  FAILED ${item.id} (generation ${item.accessTokenKeyId}): ` +
          (error instanceof Error ? error.message : "unknown error"),
      );
    }
  }

  console.log(`\nRe-encrypted: ${rotated}`);
  if (failed > 0) {
    console.error(
      `Failed:       ${failed}\n\n` +
        "Those rows could not be decrypted, which means the key generation they\n" +
        "were written with is not configured. Restore that key and run again.\n" +
        "Do NOT remove any key while failures remain — the affected users would\n" +
        "have to reconnect their banks.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("\nDone. Verify with:");
  console.log(`  SELECT COUNT(*) FROM "Item" WHERE "accessTokenKeyId" <> '${active.id}';`);
  console.log("When that is 0, it is safe to remove older key generations.");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Rotation failed:", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
