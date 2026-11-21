import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/app-url";
import { PRIVATE_ROUTE_PREFIXES } from "@/lib/seo";

/**
 * `/robots.txt`.
 *
 * `Disallow` here is a REQUEST, not a control. A crawler that ignores it still
 * fetches and can still index these pages, which is why every route in
 * `PRIVATE_ROUTE_PREFIXES` also carries a `robots: { index: false }` metadata
 * export — and, for the partner and ops consoles, an actual auth gate. This
 * file exists to keep crawlers out of the cheap cases (link-following, crawl
 * budget, URL discovery), not to be the only line of defence.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = appOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...PRIVATE_ROUTE_PREFIXES],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}