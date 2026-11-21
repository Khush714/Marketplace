import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

/**
 * The cart page is a `"use client"` component, which cannot export metadata, so
 * this layout carries it. `NOINDEX` is the shared crawl policy from
 * `lib/seo.ts` — the same constant `/robots.txt` disallows this path by, so the
 * meta tag and the robots file cannot drift apart.
 */
export const metadata: Metadata = {
  title: "Your cart",
  description: "Review the dishes in your cart and the exact delivery bill before you check out.",
  ...NOINDEX,
};

export default function CartLayout({ children }: { children: ReactNode }) {
  return children;
}