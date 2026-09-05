import { getIcon } from "@/lib/icons";

// Small colored circle with the category's lucide icon.
export function CategoryIcon({
  icon,
  color,
  size = 40,
}: {
  icon?: string | null;
  color?: string | null;
  size?: number;
}) {
  const Icon = getIcon(icon);
  const c = color || "#9ca3af";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
        color: c,
      }}
    >
      <Icon size={size * 0.5} strokeWidth={2} />
    </div>
  );
}
