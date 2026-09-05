import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const folder = await prisma.folder.findUnique({
    where: { id },
    include: {
      transactions: {
        include: { category: true, account: { select: { name: true, mask: true } } },
        orderBy: { date: "desc" },
      },
    },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(folder);
}

// Deleting a folder frees its charges (folderId set null via relation).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.folder.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
