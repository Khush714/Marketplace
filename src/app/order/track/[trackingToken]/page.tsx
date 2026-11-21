import type { Metadata } from "next";
import { OrderTrackingTokenScreen } from "@/components/order-tracking-token-screen";
import { NOINDEX } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * `NOINDEX`. This URL is a per-customer bearer credential in the open — the
 * tracking token is the access key — and the page behind it is per-customer.
 * It must never appear in search results, and `follow: false` also stops it
 * acting as a crawl path into the listings it links to.
 */
export const metadata: Metadata = {
  title: "Live tracking",
  description: "Follow your crave. order from the kitchen to your door, stage by stage.",
  robots: NOINDEX.robots,
};

/**
 * Tracking by the Phase 6 bearer token. Unlike `/order/[code]/track`, this page
 * (served at `/order/track/<token>`, deliberately OUTSIDE the bare `[code]`
 * slot — Next refuses two differently-named dynamic siblings under `order/`) is
 * the shareable URL: the token itself is the credential, so nobody needs to
 * have placed the order in this browser to follow it. The screen resolves the
 * order client-side through the token-authenticated API.
 */
export default async function TrackingTokenPage(props: { params: Promise<{ trackingToken: string }> }) {
  const { trackingToken } = await props.params;
  return <OrderTrackingTokenScreen trackingToken={trackingToken} />;
}