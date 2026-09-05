"use client";

import { AlertTriangle, Lightbulb, ThumbsUp } from "lucide-react";
import { useApi } from "@/lib/client";

interface Nudge {
  id: string;
  tone: "warn" | "info" | "good";
  title: string;
  body: string;
}

const TONE = {
  warn: { icon: AlertTriangle, color: "var(--negative)" },
  info: { icon: Lightbulb, color: "var(--primary)" },
  good: { icon: ThumbsUp, color: "var(--positive)" },
} as const;

// "Heads up" — the app noticing things (pace, odd purchases, owed money).
export function NudgesCard() {
  const { data } = useApi<{ nudges: Nudge[] }>("/api/nudges");
  if (!data || data.nudges.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
        Heads up
      </h2>
      <div className="mx-5 flex flex-col gap-2">
        {data.nudges.map((n) => {
          const t = TONE[n.tone] ?? TONE.info;
          const Icon = t.icon;
          return (
            <div
              key={n.id}
              className="card flex items-start gap-3 p-4"
              style={{ borderColor: `color-mix(in srgb, ${t.color} 35%, transparent)` }}
            >
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: `color-mix(in srgb, ${t.color} 15%, transparent)`,
                  color: t.color,
                }}
              >
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">{n.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{n.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
