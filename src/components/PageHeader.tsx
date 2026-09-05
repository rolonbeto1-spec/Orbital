import { ReactNode } from "react";

// Sticky glass chrome: every screen's header floats over the content with a
// heavy blur, a soft seam, and a glowing live dot.
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-30 border-b px-5 py-3 backdrop-blur-xl"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
        background: "color-mix(in srgb, var(--bg) 85%, transparent)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center"
            style={{
              clipPath: "var(--hex)",
              background: "color-mix(in oklab, var(--primary) 15%, transparent)",
            }}
            aria-hidden
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--primary)", boxShadow: "0 0 12px var(--primary)" }}
            />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="truncate text-xs text-text-muted">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </div>
    </header>
  );
}
