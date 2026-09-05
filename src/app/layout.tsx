import type { Metadata, Viewport } from "next";
import { DM_Sans, Sora } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

const dmSans = DM_Sans({
  variable: "--font-geist-sans", // keeps the existing token wiring
  subsets: ["latin"],
});
const sora = Sora({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Metta",
  description: "All your accounts and budgets, on one screen.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Metta",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e0d" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${sora.variable} antialiased`}>
      <body className="min-h-dvh">
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
      </body>
    </html>
  );
}
