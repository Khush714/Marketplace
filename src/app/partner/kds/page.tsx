import type { Metadata } from "next";
import KdsBoard from "@/components/kds-board";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Kitchen display",
  description: "Read-only kitchen board for active marketplace orders.",
  ...NOINDEX,
};

export default function PartnerKdsPage() {
  return <KdsBoard mode="kds" />;
}
