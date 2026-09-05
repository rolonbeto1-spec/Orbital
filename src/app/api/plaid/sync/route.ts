import { NextResponse } from "next/server";
import { plaidConfigured } from "@/lib/plaid";
import { syncAllItems } from "@/lib/sync";

// Sync does real work (bank pull + AI sorting + logo passes) — give it a
// full minute instead of the platform's ~10s default before it gets killed.
export const maxDuration = 60;

// Re-syncs balances and transactions for all connected banks.
export async function POST() {
  if (!plaidConfigured) {
    return NextResponse.json(
      { ok: false, demo: true, message: "Demo mode — no banks connected." },
      { status: 200 }
    );
  }
  try {
    const results = await syncAllItems();
    const totals = results.reduce(
      (acc, r) => ({
        added: acc.added + r.added,
        modified: acc.modified + r.modified,
        removed: acc.removed + r.removed,
      }),
      { added: 0, modified: 0, removed: 0 }
    );
    return NextResponse.json({ ok: true, ...totals });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
