import Link from 'next/link'

import { Reveal } from './reveal'
import { ArrowRight } from 'lucide-react'

export function Cta() {
  return (
    <section id="cta" className="relative overflow-hidden bg-ink px-6 py-28 text-ink-foreground sm:py-36">
      <div className="honeycomb-bg pointer-events-none absolute inset-0 opacity-[0.04]" />
      <div
        className="animate-spotlight pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[720px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in oklch, var(--color-emerald) 38%, transparent), transparent 70%)' }}
      />

      <Reveal className="relative mx-auto max-w-3xl text-center">
        <h2 className="text-balance font-heading text-4xl font-semibold leading-[1.03] tracking-tight sm:text-6xl">
          Stop wondering.
          <br />
          <span className="text-gradient-emerald">Start seeing.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-foreground/60">
          Link a bank and watch your Hive come alive — private, read-only, and
          built to answer one question for good. Metta is invite-only while it
          is still finding its feet.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-bright px-7 py-3.5 text-base font-medium text-ink transition-transform duration-300 hover:scale-[1.03] sm:w-auto"
          >
            Sign in
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
          <a
            href="#hive"
            className="inline-flex w-full items-center justify-center rounded-full border border-white/15 bg-white/5 px-7 py-3.5 text-base font-medium backdrop-blur transition-colors hover:bg-white/10 sm:w-auto"
          >
            See how it works
          </a>
        </div>
      </Reveal>
    </section>
  )
}
