import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const b = await req.json();
  const data: Record<string, unknown> = {};
  for (const key of ["name", "rentIncome", "mortgage", "utilities", "hoa", "sweatIn", "sweatOut", "notes"]) {
    if (key in b) data[key] = b[key];
  }
  try {
    const property = await prisma.property.update({ where: { id }, data });
    return NextResponse.json(property);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.property.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
