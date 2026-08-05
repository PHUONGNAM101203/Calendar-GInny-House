import type { Metadata } from "next";
import { Fraunces, Be_Vietnam_Pro } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Only the weights actually rendered anywhere in the app are requested —
// next/font lazily fetches per-weight static files, so trimming this list
// (no italic, no unused 700, no variable-axis payload) is a real perf win,
// not just tidiness. See DESIGN.md "Typography" for the full rationale.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["vietnamese", "latin"],
  weight: ["500", "600"],
});

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-body",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Ginny House · Lịch làm việc",
  description: "Lịch làm việc và đổi ca cho đội ngũ Ginny House.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${fraunces.variable} ${beVietnamPro.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning: some browser extensions (ColorZilla's
          "cz-shortcut-listen", Grammarly, etc.) inject an attribute onto
          <body> before React hydrates — a real DOM mismatch, but caused by
          the visitor's own extension, not app code, and cosmetic (React
          doesn't try to "fix" a suppressed attribute either way). */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
