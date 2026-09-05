import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getNetWorth } from "@/lib/queries";
import { plaidConfigured } from "@/lib/plaid";

export async function GET() {
  const [accounts, netWorth, items] = await Promise.all([
    prisma.account.findMany({ orderBy: { currentBalance: "desc" } }),
    getNetWorth(),
    prisma.item.findMany({
      orderBy: { createdAt: "asc" },
      include: { accounts: { orderBy: { currentBalance: "desc" } } },
    }),
  ]);
  return NextResponse.json({ accounts, ...netWorth, items, plaidConfigured });
}
