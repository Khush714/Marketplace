import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata: the page is a client component. Order history is
 * token-scoped per browser, so it is `NOINDEX` — there is nothing here worth a
 * search result and the codes in it are not public.
 */
export const metadata: Metadata = {
  title: "Your orders",
  description: "Every order you have placed on crave., with live status and a link to track your rider.",
  ...NOINDEX,
};

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return children;
}