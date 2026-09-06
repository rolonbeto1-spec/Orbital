"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ArrowLeftRight, Wallet, Sparkles, PieChart } from "lucide-react";

const NAV = [
  { href: "/app", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Activity", icon: ArrowLeftRight },
  { href: "/budgets", label: "Budgets", icon: Wallet },
  { href: "/chat", label: "Ask", icon: Sparkles },
  { href: "/insights", label: "Insights", icon: PieChart },
];

export function BottomNav() {
  const pathname = usePathname();
  // No app chrome on any page a signed-out visitor can reach: the landing
  // page, the auth pages and the legal pages. A bottom navigation bar full of
  // links to someone else's data is confusing at best on those screens.
  const PUBLIC = [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ];
  if (PUBLIC.includes(pathname) || pathname.startsWith("/legal")) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
        background: "color-mix(in srgb, var(--surface) 90%, transparent)",
      }}
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-5 px-2 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 transition-colors"
              style={{ color: active ? "var(--primary)" : "var(--text-faint)" }}
            >
              <span
                className="grid h-8 w-9 place-items-center transition-all duration-300"
                style={{
                  clipPath: "var(--hex)",
                  background: active
                    ? "color-mix(in oklab, var(--primary) 16%, transparent)"
                    : "transparent",
                  transform: active ? "scale(1.05)" : "scale(1)",
                }}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
              </span>
              <span className="text-[10px] font-semibold tracking-wide">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
