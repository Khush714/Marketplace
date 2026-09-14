import type { Metadata } from "next";
import { RiderConsole } from "@/components/rider/RiderConsole";

export const dynamic = "force-dynamic";

/**
 * Rider PWA URL — every delivery assignment gets a token-scoped link:
 *
 *   /rider/:token
 *
 * The token is the rider's credential (same public pattern as the order
 * reference), so no login is required. The page hands the token to the
 * RiderConsole which drives the whole job: pickup → dropoff → GPS reporting
 * → status advancement.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return { title: `Delivery job` };
}

export default async function RiderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const normalized = token.trim();

  return (
    <main className="min-h-screen px-4 pb-24 sm:px-6">
      <RiderConsole token={normalized} />
    </main>
  );
}