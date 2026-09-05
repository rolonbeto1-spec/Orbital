import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { plaidClient } from "@/lib/plaid";

// Disconnect a bank: remove it at Plaid (best effort) then delete locally.
// Cascades delete its accounts and transactions.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (plaidClient && item.accessToken) {
    try {
      await plaidClient.itemRemove({ access_token: item.accessToken });
    } catch {
      // best effort
    }
  }

  await prisma.item.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
