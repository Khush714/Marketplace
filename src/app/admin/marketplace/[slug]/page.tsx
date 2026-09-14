import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { restaurants, marketplaceProfiles, restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { num } from "@/lib/format";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { OnboardingForm } from "@/components/OnboardingForm";
import { MarketplaceStatusDashboard } from "@/components/admin/MarketplaceStatusDashboard";
import { ConnectRestaurantCard } from "@/components/admin/ConnectRestaurantCard";
import { marketplaceStats } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Owner-only — normal customers must never reach the edit form.
  if (!(await getCurrentAdmin())) redirect("/admin/login");

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

  const [integration] = await db
    .select()
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, row.r.id))
    .limit(1);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <Link
          href="/admin/marketplace"
          className="text-sm text-white/45 hover:text-ember-400 hover:underline"
        >
          ← All restaurants
        </Link>
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <div>
            <p className="text-sm font-bold text-white">Menu items</p>
            <p className="text-xs text-white/45">
              Add and manage categories, items and customisation options —
              they appear on your storefront instantly.
            </p>
          </div>
          <Link
            href={`/admin/marketplace/${row.r.slug}/menu`}
            className="shrink-0 rounded-2xl bg-ember-500 px-4 py-2.5 text-xs font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
          >
            Edit menu →
          </Link>
        </div>
      </div>

      <div className="mt-4">
        <ConnectRestaurantCard
          restaurantDbId={row.r.id}
          restaurantName={row.r.name}
          marketplaceId={row.r.marketplaceId}
          provider={integration?.provider ?? "restaurantai"}
          status={integration?.status ?? "disconnected"}
        />
      </div>
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
            qrImageUrl: row.p.qrImageUrl ?? "",
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
