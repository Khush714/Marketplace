import type { Metadata } from "next";
import { OrderTracker } from "@/components/orders/OrderTracker";

export const dynamic = "force-dynamic";

/**
 * Customer tracking URL — every order gets a permanent link:
 *
 *   /orders/:reference
 *
 * The page stays deliberately thin: it extracts the reference from the URL
 * and hands it to the tracking hook + components. No polling logic or big UI
 * lives here.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Track ${reference}` };
}

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const normalized = reference.trim().toUpperCase();

  return (
    <main className="min-h-screen bg-white px-4 pb-20 sm:px-6">
      <OrderTracker reference={normalized} />
    </main>
  );
}