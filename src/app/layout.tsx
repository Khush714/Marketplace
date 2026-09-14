import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: {
    default: "TABLZ — Order from local restaurants",
    template: "%s · TABLZ",
  },
  description:
    "Discover nearby restaurants, browse menus and order online. Powered by the restaurants' own POS.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TABLZ",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0c0f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="noise">
      <body className="min-h-screen bg-ink-950 font-sans text-[#f5f3ef] antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
