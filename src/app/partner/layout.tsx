import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata: the page is a client component.
 *
 * `NOINDEX`, matching `/partner` in `PRIVATE_ROUTE_PREFIXES`. I first indexed
 * this route on the argument that a restaurant owner might search for it — but
 * that contradicts the policy already committed to in `lib/seo.ts`, and the
 * disallow in `/robots.txt` would strip the crawl credit the index tag is
 * trying to earn anyway. Changing the policy is a product decision, not a
 * metadata one, so the metadata defers to it.
 */
export const metadata: Metadata = {
  // No brand in this string: the root template appends "— crave.", and a title
  // that already said "crave." rendered as "Partner with crave. — crave.".
  title: "For restaurants",
  description:
    "Connect your restaurant's POS to crave. Enter your connection code and your menu, orders and payments sync automatically.",
  ...NOINDEX,
};

export default function PartnerLayout({ children }: { children: ReactNode }) {
  return children;
}