import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Ambient } from "@/components/ambient";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "crave. — Food, delivered beautifully",
  description:
    "A next-generation food marketplace. Discover restaurants, order in seconds, track your rider live.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="js">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-void font-sans text-cream-50">
        <Providers>
          <Ambient />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
