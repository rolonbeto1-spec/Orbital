'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const links = [
  { label: 'The Hive', href: '#hive' },
  { label: 'Features', href: '#features' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'Intelligence', href: '#ai' },
]

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        scrolled ? 'py-2' : 'py-4',
      )}
    >
      <nav
        className={cn(
          'mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-500 sm:px-5',
          scrolled
            ? 'border border-white/10 bg-ink/70 backdrop-blur-xl'
            : 'border border-transparent bg-transparent',
        )}
      >
        <a href="#top" className="flex items-center gap-2.5 pl-1">
          <HexMark />
          <span className="font-heading text-lg font-semibold tracking-tight text-ink-foreground">
            Metta
          </span>
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-1.5 text-sm text-ink-foreground/70 transition-colors hover:text-ink-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <Link
          href="/login"
          className="rounded-full bg-emerald-bright px-4 py-2 text-sm font-medium text-ink transition-transform duration-300 hover:scale-[1.03]"
        >
          Sign in
        </Link>
      </nav>
    </header>
  )
}

function HexMark() {
  return (
    <span className="hex flex h-8 w-8 items-center justify-center bg-emerald-bright/15">
      <span className="hex flex h-5 w-5 items-center justify-center bg-emerald-bright">
        <span className="hex h-2 w-2 bg-ink" />
      </span>
    </span>
  )
}
