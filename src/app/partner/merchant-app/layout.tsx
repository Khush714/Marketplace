import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata: the page is a client component. Holds the one-time
 * Merchant App pairing code, so it takes the shared `NOINDEX` policy like the
 * other /partner tool routes.
 *
 * The `...NOINDEX` spread stays close to the export: the crawl-policy tests
 * scan a bounded window after `export const metadata` to find it.
 */
export const metadata: Metadata = {
  title: { absolute: "Merchant App connection — crave." },
  description: "Connect your Marketplace listing to Savour Merchant.",
  ...NOINDEX,
};

export default function PartnerMerchantAppLayout({ children }: { children: ReactNode }) {
  return children;
}
