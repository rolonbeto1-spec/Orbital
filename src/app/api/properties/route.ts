import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function withPL<T extends { rentIncome: number; mortgage: number; utilities: number; hoa: number; sweatIn: number; sweatOut: number }>(p: T) {
  return {
    ...p,
    net: p.rentIncome - p.mortgage - p.utilities - p.hoa,
    sweatNet: p.sweatOut - p.sweatIn,
  };
}

export async function GET() {
  const properties = await prisma.property.findMany({ orderBy: { createdAt: "asc" } });
  const withNet = properties.map(withPL);
  const totalNet = withNet.reduce((s, p) => s + p.net, 0);
  return NextResponse.json({ properties: withNet, totalNet });
}

export async function POST(req: Request) {
  const b = await req.json();
  if (!b.name || typeof b.name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
  const property = await prisma.property.create({
    data: {
      name: b.name,
      rentIncome: num(b.rentIncome),
      mortgage: num(b.mortgage),
      utilities: num(b.utilities),
      hoa: num(b.hoa),
      sweatIn: num(b.sweatIn),
      sweatOut: num(b.sweatOut),
      notes: b.notes ?? null,
    },
  });
  return NextResponse.json(withPL(property));
}
