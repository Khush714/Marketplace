import type { Metadata } from "next";
import { OrderTracker } from "@/components/order-tracker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "crave. — Live tracking" };

/**
 * The order itself is NOT read here: reading it needs the token this browser was
 * issued at checkout, which never reaches the server on navigation. The client
 * wrapper resolves it and calls the token-authenticated API.
 */
export default async function TrackPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  return <OrderTracker code={code} />;
}
