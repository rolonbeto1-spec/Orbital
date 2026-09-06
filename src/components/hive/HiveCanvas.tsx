"use client";

import { useEffect, useRef, useState } from "react";
import { PiggyBank, Wallet } from "lucide-react";
import { getIcon } from "@/lib/icons";
import type {
  HiveBranchWire as HiveBranch,
  HiveItemWire as HiveItem,
  BudgetStatusWire as BudgetStatus,
  HiveMoneyWire as HiveMoney,
} from "@/lib/types";

export interface HiveData {
  windowLabel: string;
  total: number;
  branches: HiveBranch[];
  budget: BudgetStatus;
  money: HiveMoney;
}

export type HiveSelection =
  | { type: "overview" }
  | { type: "budget" }
  | { type: "branch"; branch: HiveBranch }
  | { type: "item"; branch: HiveBranch; item: HiveItem };

// Per-cell nudges from the default spot, as fractions of the canvas size.
export type HiveLayout = Record<string, { dx: number; dy: number }>;

const BRANCH_COLOR: Record<string, string> = {
  needs: "var(--needs)",
  wants: "var(--wants)",
  invest: "var(--invest)",
  rentals: "var(--rentals)",
};
const BRANCH_ANGLE: Record<string, number> = {
  rentals: -90, // up
  needs: 0, // right
  wants: 90, // down
  invest: 180, // left (matches the "investments on the left" mental map)
};

// Each spending category gets its own hue (from the visual handoff), so cells
// read as individuals instead of inheriting their branch color wholesale.
const CATEGORY_HUE: Record<string, number> = {
  Housing: 232,
  "Bills & Utilities": 92,
  Groceries: 148,
  Transportation: 205,
  Health: 12,
  "Loan Payments": 275,
  Fees: 260,
  Services: 225,
  "Food & Dining": 42,
  Entertainment: 320,
  Shopping: 292,
  "Personal Care": 350,
  Travel: 190,
  Other: 92,
};

function hueColor(label: string | undefined, fallback: string): string {
  const hue = label != null ? CATEGORY_HUE[label] : undefined;
  return hue != null ? `oklch(0.62 0.13 ${hue})` : fallback;
}

// Hexagon outline for the progress ring; pathLength=100 makes the dash
// offset map 1:1 to percent.
const HEX_RING_PATH = "M50 3 L95.7 26 L95.7 74 L50 97 L4.3 74 L4.3 26 Z";

function shortMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1000) return sign + "$" + (abs / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return sign + "$" + Math.round(abs);
}

const SHORT_NAME: Record<string, string> = {
  Transportation: "Transport",
  Entertainment: "Fun",
  "Food & Dining": "Dining",
  "Bills & Utilities": "Bills",
  "Personal Care": "Care",
  "High-Yield Savings": "Savings",
  "Business Checking": "Business",
};

interface Cell {
  key: string;
  x: number;
  y: number;
  d: number;
  color: string;
  center?: boolean;
  icon: string;
  label?: string;
  amount?: string;
  sub?: string;
  trend?: { up: boolean; pct?: number; text?: string; good: boolean };
  onClick: () => void;
  animIndex: number;
  fromX?: number; // parent position — cells emerge from under it
  fromY?: number;
}
interface Link {
  key: string;
  d: string;
  color: string;
  width: number;
  opacity: number;
  animIndex: number;
}

export function HiveCanvas({
  data,
  layout,
  editMode = false,
  onSelect,
  onLayoutChange,
}: {
  data: HiveData;
  layout: HiveLayout;
  editMode?: boolean;
  onSelect: (sel: HiveSelection) => void;
  onLayoutChange: (layout: HiveLayout) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [offsets, setOffsets] = useState<HiveLayout>(layout);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const drag = useRef<{
    key: string;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => setOffsets(layout), [layout]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cells: Cell[] = [];
  const links: Link[] = [];

  if (size && size.w > 0 && size.h > 0 && data.branches.length > 0) {
    const { w: W, h: H } = size;
    const off = (key: string) => ({
      x: (offsets[key]?.dx ?? 0) * W,
      y: (offsets[key]?.dy ?? 0) * H,
    });
    const P = (key: string, bx: number, by: number) => {
      const o = off(key);
      return { x: bx + o.x, y: by + o.y };
    };

    // Keep a cell of diameter d fully on screen.
    const clamp = (p: { x: number; y: number }, d: number) => ({
      x: Math.min(Math.max(p.x, d / 2 + 2), W - d / 2 - 2),
      y: Math.min(Math.max(p.y, d / 2 + 2), H - d / 2 - 2),
    });
    const center = P("budget", W / 2, H * 0.5);
    const money = clamp(P("money", W * 0.85, H * 0.08), 84);
    const rx = W * 0.26;
    const ry = H * 0.29;
    const maxB = Math.max(1, ...data.branches.map((b) => b.value));
    let anim = 2; // 0 = budget center, 1 = money cell

    for (const b of data.branches) {
      const color = BRANCH_COLOR[b.id] ?? "var(--primary)";
      const angleDeg = BRANCH_ANGLE[b.id] ?? 0;
      const a = (angleDeg * Math.PI) / 180;
      // Branch bases hang off wherever the center currently sits, so dragging
      // the budget hex pulls the whole hive with it.
      const bd = Math.round(62 + 24 * Math.sqrt(b.value / maxB));
      const bp = clamp(P(b.id, center.x + rx * Math.cos(a), center.y + ry * Math.sin(a)), bd);

      links.push({
        key: `l-${b.id}`,
        d: `M ${center.x} ${center.y} Q ${(center.x + bp.x) / 2} ${(center.y + bp.y) / 2} ${bp.x} ${bp.y}`,
        color,
        width: 1.5 + 1.5 * (b.value / maxB),
        opacity: 0.4,
        animIndex: anim,
      });

      const sats = b.items.slice(0, 4);
      const n = sats.length;
      const maxS = Math.max(1, ...sats.map((s) => s.value));
      // Satellites fan around the branch's *final* position — drag a branch
      // and its satellites ride along on their strings.
      const base = Math.atan2(bp.y - center.y, bp.x - center.x);
      const arc = ((n <= 1 ? 0 : Math.min(120, 40 * (n - 1))) * Math.PI) / 180;
      const step = n > 1 ? arc / (n - 1) : 0;
      const R2 = bd / 2 + 50;

      sats.forEach((s, j) => {
        const offAng = (j - (n - 1) / 2) * step;
        const ang = base + offAng;
        const sd = Math.round(57 + 11 * Math.sqrt(s.value / maxS));
        const sp = clamp(P(s.id, bp.x + R2 * Math.cos(ang), bp.y + R2 * Math.sin(ang)), sd);
        links.push({
          key: `l-${s.id}`,
          d: `M ${bp.x} ${bp.y} Q ${(bp.x + sp.x) / 2} ${(bp.y + sp.y) / 2} ${sp.x} ${sp.y}`,
          color,
          width: 1.25,
          opacity: 0.32,
          animIndex: anim,
        });
        const trend =
          s.trendPct != null
            ? { up: s.trendPct > 0, pct: Math.abs(s.trendPct), good: !!s.trendGood }
            : s.kind === "property"
              ? { up: !!s.trendGood, good: !!s.trendGood }
              : s.kind === "account"
                ? { up: true, good: true }
                : undefined;
        cells.push({
          key: s.id,
          x: sp.x,
          y: sp.y,
          d: sd,
          color,
          icon: s.icon,
          label: SHORT_NAME[s.name] ?? s.name,
          amount: shortMoney(s.balance ?? s.value),
          trend,
          onClick: () => onSelect({ type: "item", branch: b, item: s }),
          animIndex: anim++,
          fromX: bp.x,
          fromY: bp.y,
        });
      });

      cells.push({
        key: b.id,
        x: bp.x,
        y: bp.y,
        d: bd,
        color,
        icon: b.icon,
        label: b.label,
        amount: shortMoney(b.value),
        onClick: () => onSelect({ type: "branch", branch: b }),
        animIndex: anim++,
        fromX: center.x,
        fromY: center.y,
      });
    }

    // Your money: its own cell, on a faint string to the center.
    links.push({
      key: "l-money",
      d: `M ${center.x} ${center.y} Q ${(center.x + money.x) / 2} ${(center.y + money.y) / 2} ${money.x} ${money.y}`,
      color: "var(--primary)",
      width: 1.25,
      opacity: 0.22,
      animIndex: 1,
    });
    cells.push({
      key: "money",
      x: money.x,
      y: money.y,
      d: 84,
      color: "var(--primary)",
      icon: "Wallet",
      label: "Your money",
      amount: shortMoney(data.money.total),
      trend: {
        up: data.money.monthNet >= 0,
        good: data.money.monthNet >= 0,
        text: shortMoney(Math.abs(data.money.monthNet)),
      },
      onClick: () => onSelect({ type: "overview" }),
      animIndex: 1,
      fromX: center.x,
      fromY: center.y,
    });

    // Budget: the reason you check in — front and center.
    const bgt = data.budget;
    cells.push({
      key: "budget",
      x: center.x,
      y: center.y,
      d: 118,
      color: "var(--primary)",
      center: true,
      icon: "PiggyBank",
      label: "Budget",
      amount: bgt.hasBudget ? shortMoney(bgt.left) : shortMoney(bgt.spent),
      sub: bgt.hasBudget
        ? bgt.left >= 0
          ? "left this month"
          : "over this month"
        : "spent this month",
      onClick: () => onSelect({ type: "budget" }),
      animIndex: 0,
    });
  }

  // ---- drag handling (pointer events cover touch + mouse) ----
  // Dragging only happens in Arrange mode, so normal scrolling never
  // accidentally moves a cell.
  function onPointerDown(e: React.PointerEvent, key: string) {
    if (!editMode) return;
    drag.current = {
      key,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: offsets[key]?.dx ?? 0,
      baseDy: offsets[key]?.dy ?? 0,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent, key: string) {
    const d = drag.current;
    if (!d || d.key !== key || !size) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 10) return;
    if (!d.moved) {
      d.moved = true;
      setDraggingKey(key);
    }
    setOffsets((o) => ({
      ...o,
      [key]: {
        dx: Math.max(-0.9, Math.min(0.9, d.baseDx + dx / size.w)),
        dy: Math.max(-0.9, Math.min(0.9, d.baseDy + dy / size.h)),
      },
    }));
  }
  function onPointerUp(key: string) {
    const d = drag.current;
    drag.current = null;
    setDraggingKey(null);
    if (d?.moved) {
      suppressClick.current = true;
      setOffsets((o) => {
        onLayoutChange(o);
        return o;
      });
    }
  }
  function handleClick(cell: Cell) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (editMode) return; // arrange mode is for moving, not opening
    cell.onClick();
  }

  return (
    <div ref={ref} className="relative h-full w-full">
      {/* the stage: a soft spotlight on the hero cell, mist in the lower
          corners, and a whisper of vignette so the scene reads lit, not flat */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background: [
            "radial-gradient(120% 85% at 50% 42%, color-mix(in oklab, var(--primary) 6%, transparent), transparent 62%)",
            "radial-gradient(70% 55% at 12% 96%, color-mix(in oklab, var(--wants) 5%, transparent), transparent 70%)",
            "radial-gradient(70% 55% at 90% 8%, color-mix(in oklab, var(--needs) 4%, transparent), transparent 70%)",
            "radial-gradient(150% 130% at 50% 50%, transparent 58%, color-mix(in srgb, var(--text) 4%, transparent))",
          ].join(", "),
        }}
      />
      {/* honeycomb backdrop */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.04]" aria-hidden>
        <defs>
          <pattern id="metta-comb" width="56" height="97" patternUnits="userSpaceOnUse">
            <path
              d="M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z M28 64 L56 80 M28 64 L0 80"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#metta-comb)" />
      </svg>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {links.map((l) => (
          <path
            key={l.key}
            className="hivelink"
            d={l.d}
            fill="none"
            stroke={l.color}
            strokeWidth={l.width}
            strokeLinecap="round"
            strokeDasharray="0.5 7"
            style={{ stroke: l.color, "--i": l.animIndex, "--o": l.opacity } as React.CSSProperties}
          />
        ))}
        {/* nectar particles flowing along the strands */}
        {links.map((l, i) => (
          <circle key={`p-${l.key}`} r={l.width > 1.5 ? 2 : 1.5} fill={l.color} opacity="0">
            <animateMotion
              dur={`${5.5 + (i % 5) * 0.9}s`}
              repeatCount="indefinite"
              path={l.d}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0;0.5;0"
              dur={`${5.5 + (i % 5) * 0.9}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </svg>
      {cells.map((c) => {
        const Icon = c.icon === "PiggyBank" ? PiggyBank : c.icon === "Wallet" ? Wallet : getIcon(c.icon);
        const big = c.d >= 76;
        const cellColor = c.center ? "var(--primary)" : hueColor(c.label, c.color);
        // Nectar level: heavier cells (bigger hexes) read fuller. The center's
        // ring means something real: how much of the monthly budget is used.
        const budgetUsed =
          data.budget?.limit > 0 ? Math.min(1, data.budget.spent / data.budget.limit) : 0;
        const fill = c.center ? budgetUsed : Math.max(0.18, Math.min(0.88, (c.d - 52) / 70));
        return (
          <button
            key={c.key}
            className={`hivecell${c.center ? " center" : ""}${draggingKey === c.key ? " dragging" : ""}${editMode ? " editable" : ""}`}
            style={
              {
                left: c.x,
                top: c.y,
                width: c.d,
                height: c.d,
                touchAction: editMode ? "none" : "auto",
                "--c": cellColor,
                "--fill": fill,
                "--i": c.animIndex,
                "--fx": `${(c.fromX ?? c.x) - c.x}px`,
                "--fy": `${(c.fromY ?? c.y) - c.y}px`,
              } as React.CSSProperties
            }
            onClick={() => handleClick(c)}
            onPointerDown={(e) => onPointerDown(e, c.key)}
            onPointerMove={(e) => onPointerMove(e, c.key)}
            onPointerUp={() => onPointerUp(c.key)}
            onPointerCancel={() => onPointerUp(c.key)}
            aria-label={c.label}
          >
            <div className="inner">
              <span style={{ color: cellColor, lineHeight: 0 }}>
                <Icon size={c.center ? 24 : big ? 21 : 17} />
              </span>
              <span
                className="font-medium leading-[1.05]"
                style={{
                  // A hexagon narrows away from its middle — keep text inside
                  // the true safe zone so edges never get shaved.
                  fontSize: c.center ? 12 : big ? 11.5 : 9,
                  color: "var(--text-muted)",
                  maxWidth: "74%",
                  overflowWrap: "anywhere",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {c.label}
              </span>
              <span
                className="font-bold tabular-nums"
                style={{
                  fontSize: c.center ? 20 : big ? 14 : 10.5,
                  color: "var(--text)",
                  letterSpacing: "-0.02em",
                  maxWidth: "88%",
                  whiteSpace: "nowrap",
                }}
              >
                {c.amount}
              </span>
              {c.center && c.sub && (
                <span
                  className="font-bold uppercase"
                  style={{
                    fontSize: 7.5,
                    letterSpacing: ".04em",
                    maxWidth: "80%",
                    whiteSpace: "nowrap",
                    color: /over/i.test(c.sub) ? "var(--negative)" : "var(--primary)",
                  }}
                >
                  {c.sub}
                </span>
              )}
            </div>
            {(!c.center || fill > 0) && (
              // progress ring: traces the hex by the cell's fill weight
              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 h-full w-full"
                fill="none"
                aria-hidden
              >
                {/* faint full track, then the bold colored ring — the color carrier */}
                <path
                  d={HEX_RING_PATH}
                  pathLength={100}
                  stroke={cellColor}
                  strokeWidth={c.center ? 3.6 : 3}
                  strokeLinecap="round"
                  opacity={0.14}
                />
                <path
                  d={HEX_RING_PATH}
                  pathLength={100}
                  stroke={cellColor}
                  strokeWidth={c.center ? 3.6 : 3}
                  strokeLinecap="round"
                  strokeDasharray="100"
                  strokeDashoffset={100 - Math.round(fill * 100)}
                  style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)" }}
                />
              </svg>
            )}
            {c.trend && (
              <span
                className="trend"
                style={{ color: c.trend.good ? "var(--positive)" : "var(--negative)" }}
              >
                {c.trend.up ? "▲" : "▼"}
                {c.trend.text ?? (c.trend.pct != null ? `${c.trend.pct}%` : "")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
