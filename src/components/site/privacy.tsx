import { Reveal } from './reveal'
import { Lock, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'

const guarantees = [
  {
    icon: EyeOff,
    title: 'Read-only forever',
    body: 'Metta can see your money but never move it. There is no transfer or payment code — deliberately, by design.',
  },
  {
    icon: KeyRound,
    title: 'Your bank stays yours',
    body: 'Credentials never touch the app. Bank links run through read-only tokens that only ever look, never spend.',
  },
  {
    icon: Lock,
    title: 'Private per account',
    body: "Every member gets their own encrypted vault, signed sessions, and hard isolation. No one sees another person's money — ever.",
  },
]

export function Privacy() {
  return (
    <section id="privacy" className="relative overflow-hidden bg-ink py-24 text-ink-foreground sm:py-32">
      <div className="honeycomb-bg pointer-events-none absolute inset-0 opacity-[0.03]" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in oklch, var(--color-emerald) 30%, transparent), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="hex mx-auto flex h-14 w-14 items-center justify-center bg-emerald-bright/15">
            <ShieldCheck className="h-6 w-6 text-emerald-bright" strokeWidth={1.75} />
          </span>
          <h2 className="mt-6 text-balance font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            The safest thing it can do is look.
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-ink-foreground/60">
            Financial apps ask for the keys to your money. Metta asks for nothing
            it doesn&apos;t need — for every member, the only power it will ever
            have is sight.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {guarantees.map((item, i) => {
            const Icon = item.icon
            return (
              <Reveal
                key={item.title}
                delay={i * 120}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm"
              >
                <span className="hex flex h-12 w-12 items-center justify-center bg-emerald-bright/15">
                  <Icon className="h-5 w-5 text-emerald-bright" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 font-heading text-xl font-semibold tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2.5 leading-relaxed text-ink-foreground/60">
                  {item.body}
                </p>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
