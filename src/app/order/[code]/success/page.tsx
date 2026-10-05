import type { Metadata } from "next";
import { OrderSuccessScreen } from "@/components/order-success-screen";
import { NOINDEX } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * `NOINDEX` — a per-customer confirmation page reachable by guessing a short
 * order code, and `follow: false` keeps it from being a crawl path into the
 * listings it links to.
 */
export const metadata: Metadata = {
  title: "Order placed",
  description: "Your crave. order is confirmed and on its way to the kitchen.",
  robots: NOINDEX.robots,
};

export default async function OrderSuccessPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  return <OrderSuccessScreen code={code} />;
}
