import type { Metadata } from "next";
import { OrderSuccessScreen } from "@/components/order-success-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "crave. — Order placed" };

export default async function OrderSuccessPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  return <OrderSuccessScreen code={code} />;
}
