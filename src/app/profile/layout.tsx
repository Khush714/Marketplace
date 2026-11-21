import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * Layout-carried metadata: the page is a client component. The profile holds a
 * saved address and a favourite list, so it is `NOINDEX` — and `follow: false`
 * means a crawler cannot walk from here into the order or cart surfaces.
 */
export const metadata: Metadata = {
  title: "Your profile",
  description: "Your saved addresses, favourite restaurants and crave. spending summary.",
  ...NOINDEX,
};

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return children;
}