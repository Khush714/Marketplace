import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getPublicRestaurant,
  listPublicReviews,
  getPublicPhotos,
} from "@/lib/marketplace";
import { RestaurantHero } from "@/components/RestaurantHero";
import { ReviewSection } from "@/components/ReviewSection";
import { RestaurantPhotos } from "@/components/RestaurantPhotos";
import { RestaurantMenuQR } from "@/components/RestaurantMenuQR";
import { MenuLinkActions } from "@/components/MenuLinkActions";
import { currency } from "@/lib/format";
import { resolveMenuLink } from "@/lib/menu-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}): Promise<Metadata> {
  const { restaurantId } = await params;
  const r = await getPublicRestaurant(restaurantId);
  return { title: r?.name ?? "Restaurant" };
}

export default async function RestaurantOverview({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const [r, reviewData, photos] = await Promise.all([
    getPublicRestaurant(restaurantId),
    listPublicReviews(restaurantId, 20),
    getPublicPhotos(restaurantId),
  ]);
  if (!r) notFound();

  // OPEN MENU → the restaurant's own hosted menu when it's published as a
  // real external URL, otherwise the marketplace's stable menu page.
  const menuLink = resolveMenuLink(r.menuUrl, r.slug);
  // Phase 22 — existing accepts{} logic is reused unchanged.
  const orderable = r.isOpen && r.accepts.onlineOrders;

  return (
    <main className="mx-auto max-w-4xl pb-16">
      {/* Hero + name + rating + cuisine + price + OPEN + ORDER ONLINE + tabs */}
      <RestaurantHero r={r} active="overview" />

      <div className="px-4 sm:px-6">
        {/* About — per spec */}
        <section id="about" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            About
          </h2>
          <p className="mt-2 leading-relaxed text-slate-600">
            {r.description || "—"}
          </p>
          {r.tagline && (
            <p className="mt-2 text-sm italic text-slate-500">“{r.tagline}”</p>
          )}
          <div className="mt-4 space-y-2 text-sm text-slate-500">
            {r.address && <p>📍 {r.address}</p>}
            <p>
              {r.priceRange} • {r.cuisines.join(" • ")} •{" "}
              {r.accepts.delivery ? `Delivery ${r.etaMinutes} min` : ""}{" "}
              {r.accepts.delivery && r.accepts.pickup ? "•" : ""}{" "}
              {r.accepts.pickup ? `Pickup ${r.pickupEtaMinutes} min` : ""}
            </p>
            {r.minOrder > 0 && (
              <p>Minimum order {currency(r.minOrder)}</p>
            )}
          </div>

        </section>

        {/* Reviews — anchored from tab */}
        <section id="reviews" className="mt-10 scroll-mt-24">
          <ReviewSection slug={r.slug} reviews={reviewData?.reviews ?? []} />
        </section>

        {/* Photos — sourced from the restaurant's POS menu images */}
        {photos && photos.photos.length > 0 && (
          <div className="mt-10">
            <RestaurantPhotos data={photos} />
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            ORDER DIRECTLY FROM <RESTAURANT>
            Stable marketplace link + QR. The marketplace never takes the
            order; this hands the customer to the restaurant's own system.
           ───────────────────────────────────────────────────────────── */}
        <section id="order" className="mt-12 scroll-mt-24 border-t border-slate-200 pt-10">
          <h2 className="text-center text-sm font-bold uppercase tracking-[0.12em] text-slate-900 sm:text-base">
            Order directly from {r.name}
          </h2>

          {r.menuUrl && orderable ? (
            <>
              <div className="mt-5 flex justify-center">
                <MenuLinkActions url={menuLink} />
              </div>

              <div className="mt-8 flex flex-col items-center">
                <RestaurantMenuQR
                  url={menuLink}
                  restaurantName={r.name}
                  uploadedQrUrl={r.qrImageUrl}
                />
              </div>

              <p className="mt-6 break-all text-center font-mono text-xs text-slate-400">
                {menuLink}
              </p>
              <p className="mt-2 text-center text-xs text-slate-400">
                {menuLink.startsWith("/")
                  ? `This link is permanent. If ${r.name} changes its ordering system, the link and printed QR codes keep working.`
                  : `This opens ${r.name}'s own ordering page in a new tab.`}
              </p>
            </>
          ) : (
            <div className="mt-5 text-center">
              <span className="inline-flex rounded-xl bg-slate-100 px-6 py-2.5 text-sm font-bold tracking-wide text-slate-400">
                {!r.isOpen
                  ? "CLOSED"
                  : !r.accepts.onlineOrders
                    ? "ORDERING UNAVAILABLE"
                    : "MENU LINK NOT SET"}
              </span>
              <p className="mt-2 text-xs text-slate-400">
                {r.isOpen && r.accepts.onlineOrders
                  ? "This restaurant hasn't published its ordering link yet."
                  : "Online ordering is currently unavailable at this restaurant."}
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
