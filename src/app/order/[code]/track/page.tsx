import type { Metadata } from "next";
import { OrderTracker } from "@/components/order-tracker";
import { NOINDEX } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * `NOINDEX`. This URL is reachable by guessing a short order code and the page
 * behind it is per-customer. `follow: false` also stops it acting as a crawl
 * path into the listings it links to.
 */
export const metadata: Metadata = {
  title: "Live tracking",
  description: "Follow your crave. order from the kitchen to your door, stage by stage.",
  robots: NOINDEX.robots,
};

/**
 * The order itself is NOT read here: reading it needs the token this browser was
 * issued at checkout, which never reaches the server on navigation. The client
 * wrapper resolves it and calls the token-authenticated API.
 */
export default async function TrackPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  return <OrderTracker code={code} />;
}
