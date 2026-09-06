import Link from 'next/link'

/**
 * Footer links.
 *
 * Every entry points somewhere that exists. The design shipped with three
 * columns of labels all pointing at "#top", which reads as a finished footer
 * and behaves like a dead end — worse than a shorter, honest one. Sections
 * that have no page yet are simply not listed.
 */
const columns = [
  {
    title: 'Product',
    links: [
      { label: 'The Hive', href: '#hive' },
      { label: 'Features', href: '#features' },
      { label: 'Intelligence', href: '#ai' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { label: 'Read-only design', href: '#privacy' },
      { label: 'Privacy Policy', href: '/legal/privacy' },
      { label: 'Terms of Service', href: '/legal/terms' },
    ],
  },
  {
    title: 'Account',
    links: [{ label: 'Sign in', href: '/login' }],
  },
]

export function SiteFooter() {
  return (
    <footer className="bg-ink px-6 pb-12 pt-16 text-ink-foreground">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-10 border-b border-white/10 pb-12 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2.5">
              <span className="hex flex h-8 w-8 items-center justify-center bg-emerald-bright/15">
                <span className="hex flex h-5 w-5 items-center justify-center bg-emerald-bright">
                  <span className="hex h-2 w-2 bg-ink" />
                </span>
              </span>
              <span className="font-heading text-lg font-semibold tracking-tight">
                Metta
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-foreground/50">
              A private companion that helps everyone see exactly where their money goes.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-ink-foreground/80">
                {column.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith('#') ? (
                      <a
                        href={link.href}
                        className="text-sm text-ink-foreground/50 transition-colors hover:text-emerald-bright"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-ink-foreground/50 transition-colors hover:text-emerald-bright"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 pt-8 text-sm text-ink-foreground/40 sm:flex-row">
          <p>© {new Date().getFullYear()} Metta. Read-only forever.</p>
          <p>Your money stays yours. Metta only ever looks.</p>
        </div>
      </div>
    </footer>
  )
}
