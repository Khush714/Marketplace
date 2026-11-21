import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Connect your restaurant — crave." },
  ...NOINDEX,
};

export default function ConnectMerchantLayout({ children }: { children: ReactNode }) {
  return children;
}
