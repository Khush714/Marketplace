import { notFound } from "next/navigation";
import { db } from "@/db";
import { restaurants, marketplaceProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { num } from "@/lib/format";
import { OnboardingForm } from "@/components/OnboardingForm";
import { MarketplaceStatusDashboard } from "@/components/admin/MarketplaceStatusDashboard";
import { marketplaceStats } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [row] = await db
    .select({ r: restaurants, p: marketplaceProfiles })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(eq(restaurants.slug, slug))
    .limit(1);

  if (!row) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <a
          href="/admin/marketplace"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← All restaurants
        </a>
      </div>
      <MarketplaceStatusDashboard
        slug={slug}
        isListed={row.p.isListed}
        marketplaceStatus={row.p.marketplaceStatus}
        acceptOnlineOrders={row.p.acceptOnlineOrders}
        acceptDelivery={row.p.acceptDelivery}
        acceptPickup={row.p.acceptPickup}
        menuUrl={row.p.menuUrl}
        stats={await marketplaceStats(row.r.id)}
      />
      <div className="mt-4">
        <OnboardingForm
          initial={{
            name: row.r.name,
            slug: row.r.slug,
            address: row.r.address,
            isListed: row.p.isListed,
            description: row.r.description,
            cuisine: row.r.cuisine,
            priceRange: row.r.priceRange,
            imageUrl: row.r.imageUrl,
            tagline: row.p.tagline,
            menuUrl: row.p.menuUrl,
            acceptOnlineOrders: row.p.acceptOnlineOrders,
            acceptDelivery: row.p.acceptDelivery,
            acceptPickup: row.p.acceptPickup,
            deliveryFee: num(row.p.deliveryFee),
            minOrder: num(row.p.minOrder),
            etaMinutes: row.p.etaMinutes,
            pickupEtaMinutes: row.p.pickupEtaMinutes,
          }}
        />
      </div>
    </main>
  );
}
