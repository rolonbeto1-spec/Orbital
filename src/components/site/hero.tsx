'use client'

import Link from 'next/link'

import { HiveGraphic } from './hive-graphic'
import { ArrowRight, ShieldCheck } from 'lucide-react'

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-ink text-ink-foreground"
    >
      {/* atmosphere */}
      <div className="honeycomb-bg pointer-events-none absolute inset-0 opacity-[0.035]" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in oklch, var(--color-emerald) 40%, transparent), transparent 70%)' }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink" />

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 px-6 pb-14 pt-28 sm:gap-12 sm:pb-24 sm:pt-36 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-32 lg:pt-44">
        <div className="text-center lg:text-left">
          <div className="reveal is-visible inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-ink-foreground/75 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-bright" />
            Personal finance for everyone, private for each
          </div>

          <h1 className="mt-6 text-balance font-heading text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            See exactly where
            <br />
            your money <span className="text-gradient-emerald">goes.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-foreground/65 lg:mx-0">
            Metta connects each member&apos;s banks and cards, then draws their
            entire financial life as a living Hive — one glance tells you what
            you have, where it went, and what to do next.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
            <Link
              href="/login"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-bright px-6 py-3.5 text-base font-medium text-ink transition-transform duration-300 hover:scale-[1.03] sm:w-auto"
            >
              Sign in
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <a
              href="#hive"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-base font-medium text-ink-foreground backdrop-blur transition-colors hover:bg-white/10 sm:w-auto"
            >
              Explore the Hive
            </a>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-ink-foreground/50 lg:justify-start">
            <ShieldCheck className="h-4 w-4 text-emerald-bright" />
            Read-only forever. Metta can see your money, never move it.
          </div>
        </div>

        <div className="animate-floaty">
          <HiveGraphic />
        </div>
      </div>
    </section>
  )
}
