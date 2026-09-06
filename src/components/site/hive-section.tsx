import { Reveal } from './reveal'
import { Target, GitBranch, Activity } from 'lucide-react'

const pillars = [
  {
    icon: Target,
    title: 'Budget at the center',
    body: 'The center hex is your month. A bold ring traces how much of your budget is spent — its caption turns red the moment you tip over.',
  },
  {
    icon: GitBranch,
    title: 'A branch for every dollar',
    body: 'Needs, Wants, Investing and Rentals fan out from the middle, each carrying satellite cells sized by how much they spend.',
  },
  {
    icon: Activity,
    title: 'Rings you read in a glance',
    body: 'Every cell wears an Apple-Watch style activity ring. Color is information — tint and weight tell the whole story without a number.',
  },
]

const branches = [
  { label: 'Needs', hue: 'var(--color-needs)' },
  { label: 'Wants', hue: 'var(--color-wants)' },
  { label: 'Investing', hue: 'var(--color-invest)' },
  { label: 'Rentals', hue: 'var(--color-rentals)' },
]

export function HiveSection() {
  return (
    <section id="hive" className="relative bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="hex h-2.5 w-2.5 bg-primary" />
            <span className="text-sm font-medium uppercase tracking-widest text-primary">
              The Hive
            </span>
          </div>
          <h2 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Your money, drawn as a
            <span className="text-primary"> honeycomb.</span>
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
            Spreadsheets bury the truth in rows. The Hive surfaces it. Instead of
            reading, you simply look — and know.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {pillars.map((pillar, i) => {
            const Icon = pillar.icon
            return (
              <Reveal
                key={pillar.title}
                delay={i * 120}
                className="group rounded-3xl border border-border bg-card p-7 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_24px_60px_-30px_rgba(15,122,85,0.5)]"
              >
                <span className="hex flex h-12 w-12 items-center justify-center bg-accent">
                  <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 font-heading text-xl font-semibold tracking-tight">
                  {pillar.title}
                </h3>
                <p className="mt-2.5 leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </Reveal>
            )
          })}
        </div>

        <Reveal delay={120} className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-3xl border border-border bg-secondary/60 px-8 py-5">
          <span className="text-sm font-medium text-muted-foreground">Branches</span>
          {branches.map((branch) => (
            <span key={branch.label} className="flex items-center gap-2 text-sm font-medium">
              <span className="hex h-3.5 w-3.5" style={{ background: branch.hue }} />
              {branch.label}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
