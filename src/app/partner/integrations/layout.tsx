import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata: the page is a client component. Holds POS credentials
 * and connection state, so it takes the shared `NOINDEX` policy.
 *
 * `absolute` title for the same reason as /partner/menu — nested under another
 * layout that declares a title, a bare string misses the root template.
 */
export const metadata: Metadata = {
  title: { absolute: "POS integration — crave." },
  description: "Connect, verify and monitor your restaurant's POS integration with crave.",
  ...NOINDEX,
};

export default function PartnerIntegrationsLayout({ children }: { children: ReactNode }) {
  return children;
}