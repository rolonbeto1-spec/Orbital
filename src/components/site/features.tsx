import { Reveal } from './reveal'
import {
  Hexagon,
  Receipt,
  PieChart,
  MessageCircle,
  Repeat,
  FolderTree,
} from 'lucide-react'

const features = [
  {
    icon: Hexagon,
    title: 'The Home Hive',
    body: 'A live honeycomb of your whole financial life. Arrange the cells with a drag; the layout is yours and it stays.',
    span: 'sm:col-span-2',
  },
  {
    icon: Receipt,
    title: 'Activity',
    body: 'Every bank and card in one statement. Merchant logos, "Repeats" badges, and tap-to-recategorize that learns for good.',
    span: '',
  },
  {
    icon: PieChart,
    title: 'Insights',
    body: 'Net worth, savings rate, six months of income versus spending — the trends behind the numbers.',
    span: '',
  },
  {
    icon: MessageCircle,
    title: 'Ask anything',
    body: '"Where is my money going?" Get a real answer, or reclassify a charge, in plain language.',
    span: 'sm:col-span-2',
  },
  {
    icon: Repeat,
    title: 'Recurring radar',
    body: 'Every subscription detected, totalled by month and year, with a ready-to-send cancel plan.',
    span: '',
  },
  {
    icon: FolderTree,
    title: 'Folders & rentals',
    body: 'Bookkeeping folders for taxes, per-property P&L, and a dedicated screen for business accounts.',
    span: '',
  },
]

export function Features() {
  return (
    <section id="features" className="relative bg-background pb-24 sm:pb-32">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <h2 className="text-balance font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Everything a statement never told you.
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
            Twelve screens, one idea: make the truth about your money effortless
            to see and impossible to lose.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <Reveal
                key={feature.title}
                delay={(i % 3) * 100}
                className={`group relative overflow-hidden rounded-3xl border border-border bg-card p-7 transition-all duration-500 hover:-translate-y-1 hover:border-primary/30 ${feature.span}`}
              >
                <div
                  className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                  style={{ background: 'radial-gradient(circle, color-mix(in oklch, var(--color-emerald) 45%, transparent), transparent 70%)' }}
                />
                <span className="hex relative flex h-12 w-12 items-center justify-center bg-accent">
                  <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                </span>
                <h3 className="relative mt-5 font-heading text-xl font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="relative mt-2.5 max-w-md leading-relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
