import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { learnFromCorrection } from "@/lib/smart-categorize";

// Update a transaction's category or note (manual recategorization).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data: {
    categoryId?: string | null;
    notes?: string | null;
    owedBack?: boolean;
    reimbursedAmount?: number;
    folderId?: string | null;
  } = {};
  if ("categoryId" in body) data.categoryId = body.categoryId || null;
  if ("notes" in body) data.notes = body.notes ?? null;
  if ("folderId" in body) data.folderId = body.folderId || null;
  // folderName: create-or-reuse a folder by name, then file the charge there.
  if (typeof body.folderName === "string" && body.folderName.trim()) {
    const folder = await prisma.folder.upsert({
      where: { name: body.folderName.trim() },
      update: {},
      create: { name: body.folderName.trim() },
    });
    data.folderId = folder.id;
  }
  if ("owedBack" in body) data.owedBack = Boolean(body.owedBack);
  if ("reimbursedAmount" in body && typeof body.reimbursedAmount === "number") {
    data.reimbursedAmount = Math.max(0, body.reimbursedAmount);
  }

  try {
    const before = await prisma.transaction.findUnique({ where: { id } });
    const updated = await prisma.transaction.update({
      where: { id },
      data,
      include: {
        category: true,
        folder: true,
        account: { select: { name: true, mask: true } },
      },
    });

    // A manual category change on a spend teaches the categorizer: future
    // purchases from this merchant follow the user's choice.
    if (
      before &&
      data.categoryId &&
      data.categoryId !== before.categoryId &&
      updated.amount > 0
    ) {
      await learnFromCorrection(
        updated.merchantName || updated.name,
        data.categoryId,
        updated.amount,
      );
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
