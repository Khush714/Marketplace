import type { Metadata } from "next";
import KdsBoard from "@/components/kds-board";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Print tickets",
  description: "Read-only thermal ticket view for marketplace orders.",
  ...NOINDEX,
};

export default async function PartnerPrintPage(props: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const search = await props.searchParams;
  const raw = Array.isArray(search.code) ? search.code[0] : search.code;
  const code = raw && /^[A-Za-z0-9_-]{4,64}$/.test(raw) ? raw : "";
  return <KdsBoard mode="print" initialCode={code} />;
}
