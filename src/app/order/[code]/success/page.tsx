import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderSuccess } from "@/components/order-success";
import { getOrderByCode } from "@/db/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "crave. — Order placed" };

export default async function OrderSuccessPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const order = await getOrderByCode(code);
  if (!order) notFound();
  return <OrderSuccess order={order} />;
}
