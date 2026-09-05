import Link from "next/link";
import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function Section({
  title,
  href,
  linkLabel = "See all",
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          {title}
        </h2>
        {href && (
          <Link
            href={href}
            className="flex items-center text-xs font-semibold text-primary"
          >
            {linkLabel}
            <ChevronRight size={14} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="card mx-5 overflow-hidden">{children}</div>;
}

export function Divider() {
  return <div className="mx-5 border-t border-border" />;
}
