import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Ambient } from "@/components/ambient";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { appOrigin } from "@/lib/app-url";
import "./globals.css";

/* Fonts are self-hosted by `next/font`, which replaces the two `<link>`s this
   used to hand-roll in `<head>`.

   That indirection was not cosmetic. A render-blocking stylesheet from
   fonts.googleapis.com puts a third-party DNS + TCP + TLS handshake in front
   of first paint, and then a fourth origin (fonts.gstatic.com) in front of the
   glyphs themselves. `next/font` fetches the files at build time, serves them
   same-origin, and emits a `<link rel=preload>` per woff2 with a
   metric-compatible local fallback, so a slow font can no longer cost FCP or
   shift the layout when it swaps in. It also keeps `@next/next/no-page-custom-font`
   satisfied, which the hand-rolled link could not.

   Inter is pinned to the four weights the codebase actually uses — 400 (the
   default for any element without a weight utility), 500, 600 and 700. The
   old request asked for 300 and 800 as well, which downloaded two weights no
   rule in `src/` ever selects.

   JetBrains Mono was dropped. Nothing overrides Tailwind's `--font-mono`, so
   `font-mono` resolves to the system mono stack; the woff2 was fetched on the
   five order/tracking screens and never applied to a single glyph. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

/**
 * Absolute origin for canonical/OG URLs. Without `metadataBase`, Next.js emits
 * relative OG image and canonical URLs that social crawlers cannot resolve.
 * `appOrigin()` is shared with robots.txt and sitemap.xml — see
 * `lib/app-url.ts` for why those three must not read the env var separately.
 */
export const metadata: Metadata = {
  metadataBase: new URL(appOrigin()),
  // `template` is what lets every route below declare a bare title ("Restaurants")
  // and still render a branded one. The default applies only to routes that set
  // no title at all, so it has to carry the brand on its own.
  title: {
    default: "crave. — Food, delivered beautifully",
    template: "%s — crave.",
  },
  description:
    "A next-generation food marketplace. Discover restaurants, order in seconds, track your rider live.",
  applicationName: "crave.",
  keywords: [
    "food delivery",
    "restaurant ordering",
    "online food",
    "food delivery Bharuch",
    "crave",
  ],
  icons: { icon: "/favicon.svg" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "crave.",
    title: "crave. — Food, delivered beautifully",
    description:
      "A next-generation food marketplace. Discover restaurants, order in seconds, track your rider live.",
    url: "/",
    // A static file rather than an `opengraph-image.tsx` route on purpose: this
    // card is the same for every page, so rendering it per request would buy
    // nothing and would put a dynamic route (and its dependencies) in front of
    // a crawler that may not wait. 1200x630 is the ratio X and Facebook crop
    // to; declaring it explicitly keeps them from re-encoding the card.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "crave. — Food, delivered beautifully" }],
  },
  // The OG block above supplies title/description; Twitter needs its own copy
  // because X falls back to og:title only for some scrapers, and a card with no
  // image renders as a bare text link.
  twitter: {
    card: "summary_large_image",
    title: "crave. — Food, delivered beautifully",
    description:
      "A next-generation food marketplace. Discover restaurants, order in seconds, track your rider live.",
    // Set explicitly rather than relying on Twitter reading `og:image`. It does
    // for most cards, but a route that overrides `openGraph` — every
    // restaurant page does — replaces the whole block, and `twitter` is not
    // merged into it. Naming the file here keeps the site-wide card in place
    // for any route that has no image of its own.
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`js ${inter.variable} ${display.variable}`}>
      <body className="bg-void font-sans text-cream-50">
        <Providers>
          <Ambient />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
