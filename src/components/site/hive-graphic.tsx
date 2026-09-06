'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Home,
  Utensils,
  Car,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

type Cell = {
  label: string
  amount: string
  pct: number
  hue: string
  icon: LucideIcon
  x: number
  y: number
  fx: string
  fy: string
  size?: number
}

const CENTER: Cell = {
  label: 'Budget',
  amount: '68%',
  pct: 0.68,
  hue: 'var(--color-emerald-bright)',
  icon: Wallet,
  x: 50,
  y: 50,
  fx: '0',
  fy: '0',
  size: 30,
}

const CELLS: Cell[] = [
  { label: 'Housing', amount: '$1,840', pct: 0.82, hue: 'var(--color-needs)', icon: Home, x: 35, y: 27.5, fx: '20px', fy: '40px' },
  { label: 'Dining', amount: '$612', pct: 0.54, hue: 'var(--color-needs)', icon: Utensils, x: 65, y: 27.5, fx: '-20px', fy: '40px' },
  { label: 'Transport', amount: '$328', pct: 0.41, hue: 'var(--color-needs)', icon: Car, x: 20, y: 50, fx: '40px', fy: '0' },
  { label: 'Investing', amount: '$900', pct: 0.75, hue: 'var(--color-invest)', icon: TrendingUp, x: 80, y: 50, fx: '-40px', fy: '0' },
  { label: 'Shopping', amount: '$447', pct: 0.63, hue: 'var(--color-wants)', icon: ShoppingBag, x: 35, y: 72.5, fx: '20px', fy: '-40px' },
  { label: 'Fun', amount: '$210', pct: 0.33, hue: 'var(--color-wants)', icon: Sparkles, x: 65, y: 72.5, fx: '-20px', fy: '-40px' },
]

const RING_CIRC = 2 * Math.PI * 42

function HiveCell({ cell, active, delay, isCenter }: { cell: Cell; active: boolean; delay: number; isCenter?: boolean }) {
  const Icon = cell.icon
  const size = cell.size ?? 26
  const offset = RING_CIRC * (1 - cell.pct)

  return (
    <div
      className="absolute animate-breathe"
      style={{
        left: `${cell.x}%`,
        top: `${cell.y}%`,
        width: `${size}%`,
        aspectRatio: '1 / 1',
        transform: 'translate(-50%, -50%)',
        animationDelay: `${delay + 400}ms`,
      }}
    >
      <div
        className="relative h-full w-full"
        style={{
          opacity: active ? 1 : 0,
          animation: active ? `hexin 0.9s cubic-bezier(0.16,1,0.3,1) ${delay}ms both` : 'none',
          ['--fx' as string]: cell.fx,
          ['--fy' as string]: cell.fy,
        }}
      >
        {/* glass hex body */}
        <div
          className="hex absolute inset-0 border border-white/10"
          style={{
            background: isCenter
              ? 'linear-gradient(160deg, color-mix(in oklch, white 16%, transparent), color-mix(in oklch, white 4%, transparent))'
              : 'color-mix(in oklch, white 7%, transparent)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
          }}
        />
        {/* nectar fill whisper */}
        <div
          className="hex absolute inset-0"
          style={{
            background: `radial-gradient(circle at 50% 115%, color-mix(in oklch, ${cell.hue} ${isCenter ? 34 : 22}%, transparent), transparent 62%)`,
          }}
        />
        {/* top light seam */}
        <div
          className="hex absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.14), transparent 30%)' }}
        />

        {/* activity ring + content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <div className="relative" style={{ width: '46%', aspectRatio: '1 / 1' }}>
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={cell.hue}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                strokeDashoffset={active ? offset : RING_CIRC}
                style={{ transition: `stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1) ${delay + 250}ms` }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Icon
                className="text-ink-foreground"
                style={{ width: '38%', height: '38%', color: cell.hue }}
                strokeWidth={1.75}
              />
            </div>
          </div>
          <span
            className="font-heading font-semibold leading-none text-ink-foreground"
            style={{ fontSize: isCenter ? 'clamp(11px, 2.1vw, 17px)' : 'clamp(8px, 1.5vw, 12px)' }}
          >
            {cell.amount}
          </span>
          <span
            className="leading-none text-ink-foreground/55"
            style={{ fontSize: isCenter ? 'clamp(8px, 1.3vw, 11px)' : 'clamp(6px, 1.1vw, 9px)' }}
          >
            {cell.label}
          </span>
        </div>
      </div>
    </div>
  )
}

export function HiveGraphic() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="relative mx-auto aspect-square w-full max-w-[540px]">
      {/* stage lighting */}
      <div
        className="animate-spotlight absolute left-1/2 top-1/2 h-[80%] w-[80%] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in oklch, var(--color-emerald-bright) 30%, transparent), transparent 70%)' }}
      />

      {/* strand links */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {CELLS.map((c, i) => (
          <line
            key={i}
            x1="50"
            y1="50"
            x2={c.x}
            y2={c.y}
            stroke="var(--color-emerald-bright)"
            strokeWidth="0.4"
            strokeLinecap="round"
            style={{ animation: `strandpulse ${4 + i * 0.4}s ease-in-out ${i * 0.3}s infinite` }}
          />
        ))}
      </svg>

      {CELLS.map((cell, i) => (
        <HiveCell key={cell.label} cell={cell} active={active} delay={200 + i * 110} />
      ))}
      <HiveCell cell={CENTER} active={active} delay={0} isCenter />
    </div>
  )
}
