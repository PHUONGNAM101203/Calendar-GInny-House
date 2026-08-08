import type { Metadata, Viewport } from "next";
import { Barlow } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Barlow is the single brand face — the guideline is explicit that no second
// font may be mixed in, so display and body both resolve to this one family
// and hierarchy is carried by weight alone (400 body → 900 display).
//
// The `vietnamese` subset is mandatory, not optional: without it every
// precomposed diacritic (ệ ủ ằ ẩ) silently falls back to a system face. Barlow
// ships latin/latin-ext/vietnamese, verified against next/font's own metadata.
//
// Weights are trimmed to the five the guideline actually uses (400 Regular,
// 500 Lead, 600 SemiBold, 700 H3, 800 headings, 900 Display) — next/font
// fetches one static file per weight, so requesting all nine would be dead payload.
const barlow = Barlow({
  variable: "--font-brand",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Ginny House · Lịch làm việc",
  description: "Lịch làm việc và đổi ca cho đội ngũ Ginny House.",
  manifest: "/manifest.json",
  // iOS only allows web push for a PWA opened from its home-screen icon,
  // not a plain Safari tab — this is what makes "Add to Home Screen" turn
  // into a real standalone app instead of a bookmark shortcut.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ginny House",
  },
};

export const viewport: Viewport = {
  // Vivid Blue — the brand anchor. Drives the browser/PWA chrome colour, so a
  // stale value here shows the old navy in the task switcher long after the UI
  // has been rebranded.
  themeColor: "#022B9D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${barlow.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning: some browser extensions (ColorZilla's
          "cz-shortcut-listen", Grammarly, etc.) inject an attribute onto
          <body> before React hydrates — a real DOM mismatch, but caused by
          the visitor's own extension, not app code, and cosmetic (React
          doesn't try to "fix" a suppressed attribute either way). */}
      {/* h-full (not min-h-full): descendants like the calendar rely on an
          unbroken chain of *definite* heights down to `.rbc-time-header` +
          `.rbc-time-content` (see ShiftCalendar.tsx's overflow-hidden
          comment) so the internal time-grid scroll region engages instead
          of the whole page scrolling — min-height never gives flex/overflow
          descendants a definite size to constrain against, so that chain
          silently never had a bounded ancestor to clip into. */}
      <body className="flex h-full flex-col" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
