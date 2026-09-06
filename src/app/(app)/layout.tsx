import { BottomNav } from "@/components/BottomNav";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

/**
 * The signed-in application shell.
 *
 * This used to live in the root layout, which meant the marketing page at `/`
 * would have inherited a phone-width container and a bottom navigation bar
 * built for someone who is already signed in. Scoping it to the (app) route
 * group leaves the public landing page free to be full-bleed, and changes
 * nothing about how the application itself looks.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Phone-width app shell, centered on larger screens */}
      <main
        className="mx-auto min-h-dvh w-full max-w-3xl bg-bg pb-32 sm:border-x sm:border-border"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 8%, color-mix(in oklab, var(--primary) 9%, transparent), transparent 45%), radial-gradient(circle at 85% 92%, color-mix(in oklab, var(--wants) 7%, transparent), transparent 50%)",
        }}
      >
        {children}
      </main>
      <BottomNav />
      <ServiceWorkerRegister />
    </>
  );
}
