import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackingView } from "@/components/tracking-view";
import { getOrderByCode } from "@/db/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "crave. — Live tracking" };

export default async function TrackPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const order = await getOrderByCode(code);
  if (!order) notFound();
  return <TrackingView initialOrder={order} />;
}
