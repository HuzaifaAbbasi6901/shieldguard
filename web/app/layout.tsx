import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://shieldguard.example"),
  title: "ShieldGuard — Ransomware & Data-Theft Early Warning",
  description:
    "A purely defensive, local-only early-warning dashboard that watches your folders for ransomware and data-theft behavior and tells you what to do — in plain language.",
  openGraph: {
    title: "ShieldGuard — Ransomware & Data-Theft Early Warning",
    description:
      "Local-only early warning for ransomware and data theft. Demo mode built in; connect the local agent to protect your real folders.",
    type: "website",
    siteName: "ShieldGuard",
  },
};

export const viewport: Viewport = {
  themeColor: "#050810",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
