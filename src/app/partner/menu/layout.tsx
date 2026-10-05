import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata: the page is a client component. The menu editor is a
 * tool behind an owner key, so it takes the shared `NOINDEX` policy.
 *
 * The title is `absolute`, not a bare string. This layout sits two segments
 * below the root, and a plain title under an intermediate layout that also
 * declares one does not pick up the root's "%s — crave." template — it rendered
 * as a bare "Menu editor". `absolute` opts out of template resolution
 * explicitly, which is the documented way to say "this title is already final".
 *
 * Note the `...NOINDEX` spread is kept close to the export: the crawl-policy
 * tests scan a bounded window after `export const metadata` to find it, so a
 * long inline comment here would push the robots declaration out of range.
 */
export const metadata: Metadata = {
  title: { absolute: "Menu editor — crave." },
  description: "Add, edit and price the dishes on your crave. menu, grouped by category.",
  ...NOINDEX,
};

export default function PartnerMenuLayout({ children }: { children: ReactNode }) {
  return children;
}