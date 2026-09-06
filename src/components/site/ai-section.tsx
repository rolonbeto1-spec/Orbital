import { Reveal } from './reveal'
import { Sparkles, Gauge, BrainCircuit } from 'lucide-react'

const points = [
  {
    icon: BrainCircuit,
    title: 'It sorts, so you don’t',
    body: 'New transactions are categorized automatically and remembered per merchant — each one learned once, forever.',
  },
  {
    icon: Gauge,
    title: 'Sips, never gulps',
    body: 'Batched, cached and capped by a daily ceiling. Intelligence that stays quiet and cheap in the background.',
  },
  {
    icon: Sparkles,
    title: 'Your word is law',
    body: 'Correct a category once and your rule permanently outranks the AI. Metta defers to you, always.',
  },
]

export function AiSection() {
  return (
    <section id="ai" className="relative bg-background py-24 sm:py-32">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <Reveal>
            <div className="flex items-center gap-3">
              <span className="hex h-2.5 w-2.5 bg-primary" />
              <span className="text-sm font-medium uppercase tracking-widest text-primary">
                Intelligence
              </span>
            </div>
            <h2 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              A quiet assistant that knows your money.
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
              Just ask. Metta reads a live snapshot of your finances and answers
              in plain English — no dashboards to decode.
            </p>
          </Reveal>

          <div className="mt-10 flex flex-col gap-6">
            {points.map((point, i) => {
              const Icon = point.icon
              return (
                <Reveal key={point.title} delay={i * 110} className="flex gap-4">
                  <span className="hex flex h-11 w-11 shrink-0 items-center justify-center bg-accent">
                    <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="font-heading text-lg font-semibold tracking-tight">
                      {point.title}
                    </h3>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {point.body}
                    </p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>

        <Reveal delay={150}>
          <ChatMock />
        </Reveal>
      </div>
    </section>
  )
}

function ChatMock() {
  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-[2rem] border border-border bg-ink p-5 text-ink-foreground shadow-[0_40px_100px_-40px_rgba(15,122,85,0.55)]">
      <div className="honeycomb-bg pointer-events-none absolute inset-0 opacity-[0.04]" />
      <div className="relative flex items-center gap-2.5 border-b border-white/10 pb-4">
        <span className="hex flex h-8 w-8 items-center justify-center bg-emerald-bright/15">
          <span className="hex h-3.5 w-3.5 bg-emerald-bright" />
        </span>
        <span className="font-heading text-sm font-semibold">Ask Metta</span>
      </div>

      <div className="relative mt-4 flex flex-col gap-3">
        <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-bright px-4 py-2.5 text-sm text-ink">
          Where&apos;s my money going this month?
        </div>
        <div className="mr-auto max-w-[88%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-ink-foreground/85 backdrop-blur">
          You&apos;ve spent <span className="font-semibold text-emerald-bright">$4,337</span> so
          far — 68% of budget. Housing leads at $1,840, then Investing at $900.
          Dining is up $120 from last month.
        </div>
        <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-bright px-4 py-2.5 text-sm text-ink">
          The Shell charge is groceries
        </div>
        <div className="mr-auto max-w-[88%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-ink-foreground/85 backdrop-blur">
          Done — moved to Groceries and I&apos;ll remember it. That rule now
          outranks my own guess.
        </div>
      </div>

      <div className="relative mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-ink-foreground/40">
        Ask about your money…
        <span className="ml-auto h-4 w-px animate-pulse bg-emerald-bright" />
      </div>
    </div>
  )
}
