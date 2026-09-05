// Re-mounts on every route change, so each screen glides in instead of
// popping. The animation lives in globals.css (.page-enter).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
