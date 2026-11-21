import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Merchant App connection — crave." },
  ...NOINDEX,
};

export default function MerchantAppLayout({ children }: { children: ReactNode }) {
  return children;
}
