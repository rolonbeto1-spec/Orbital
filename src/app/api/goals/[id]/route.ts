import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const key of ["name", "targetAmount", "currentAmount", "icon", "color"]) {
    if (key in body) data[key] = body[key];
  }
  if ("targetDate" in body) data.targetDate = body.targetDate ? new Date(body.targetDate) : null;

  try {
    const goal = await prisma.goal.update({ where: { id }, data });
    return NextResponse.json(goal);
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
    await prisma.goal.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
