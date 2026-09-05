import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Persists the user's custom hive arrangement: per-cell offsets from the
// default position, normalized to the canvas size so they scale with the
// screen. { [cellId]: { dx, dy } } with dx/dy as fractions of width/height.

const KEY = "hiveLayout";

export async function GET() {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let layout: Record<string, { dx: number; dy: number }> = {};
  try {
    if (row) layout = JSON.parse(row.value);
  } catch {
    // corrupted value — treat as default layout
  }
  return NextResponse.json({ layout });
}

export async function POST(req: Request) {
  const body = await req.json();
  const layout: Record<string, { dx: number; dy: number }> = {};
  if (body && typeof body.layout === "object" && body.layout !== null) {
    for (const [k, v] of Object.entries(body.layout as Record<string, unknown>)) {
      const o = v as { dx?: unknown; dy?: unknown };
      if (typeof o?.dx === "number" && typeof o?.dy === "number" && isFinite(o.dx) && isFinite(o.dy)) {
        // clamp so a cell can never be parked off-screen
        layout[k] = {
          dx: Math.max(-0.9, Math.min(0.9, o.dx)),
          dy: Math.max(-0.9, Math.min(0.9, o.dy)),
        };
      }
    }
  }
  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(layout) },
    create: { key: KEY, value: JSON.stringify(layout) },
  });
  return NextResponse.json({ ok: true, layout });
}

export async function DELETE() {
  await prisma.setting.deleteMany({ where: { key: KEY } });
  return NextResponse.json({ ok: true });
}
