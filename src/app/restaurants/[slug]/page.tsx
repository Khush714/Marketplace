import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock3, MapPin, Percent, Star } from "lucide-react";
import { BLUR_DATA, PureVegTag, RatingBadge } from "@/components/atoms";
import { MenuBrowser } from "@/components/menu-browser";
import { MiniCart } from "@/components/mini-cart";
import { FavoriteHeroButton } from "@/components/favorite-hero-button";
import { getRestaurant } from "@/db/queries";
import { formatK, priceSymbol } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getRestaurant(slug);
  return { title: data ? `crave. — ${data.restaurant.name}` : "crave." };
}

export default async function RestaurantPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dish?: string }>;
}) {
  const { slug } = await props.params;
  const { dish } = await props.searchParams;
  const data = await getRestaurant(slug);
  if (!data) notFound();

  const { restaurant: r, sections } = data;

  return (
    <div className="pb-10">
      {/* ------------------------------ hero ------------------------------ */}
      <section className="relative">
        <div className="relative h-60 overflow-hidden md:h-[380px]">
          <Image
            src={r.heroUrl}
            alt={`${r.name} cover`}
            fill
            priority
            sizes="100vw"
            placeholder="blur"
            blurDataURL={BLUR_DATA}
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-void" />
          <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_100%,rgba(255,110,60,0.12),transparent_70%)]" />

          {/* floating controls */}
          <div className="absolute inset-x-0 top-0 z-10 mx-auto flex max-w-5xl items-center justify-between px-4 pt-4 md:px-6">
            <a
              href="/restaurants"
              aria-label="Back to restaurants"
              className="press glass-strong grid size-10 place-items-center rounded-full transition-colors hover:bg-white/15"
            >
              <ChevronLeft className="size-5 text-cream-50" />
            </a>
            <FavoriteHeroButton restaurant={r} />
          </div>
        </div>

        {/* info panel — floats over the cover */}
        <div className="mx-auto max-w-5xl px-4 md:px-6">
          <div className="glass-strong animate-rise-3d relative z-10 -mt-20 rounded-[26px] p-5 md:-mt-24 md:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {r.pureVeg && <PureVegTag />}
                  {r.cuisines.map((c) => (
                    <span key={c} className="rounded-full bg-white/6 px-2.5 py-0.5 text-[11px] font-semibold text-cream-300">
                      {c}
                    </span>
                  ))}
                </div>
                <h1 className="mt-2.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-[40px] md:leading-none">
                  {r.name}
                </h1>
                <p className="mt-1.5 text-sm text-cream-400">{r.tagline}</p>
              </div>
              <div className="flex flex-col items-end gap-1 rounded-2xl bg-white/[0.05] px-3.5 py-2.5">
                <RatingBadge rating={r.rating} className="text-sm" />
                <span className="text-[11px] text-cream-500">{formatK(r.ratingsCount)} ratings</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/8 pt-4 text-sm text-cream-300">
              <span className="flex items-center gap-1.5">
                <Clock3 className="size-4 text-ember-400" />
                <span className="font-semibold text-cream-50">{r.deliveryMinutes}-{r.deliveryMinutes + 10} min</span>
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4 text-chili-400" />
                {r.distanceKm.toFixed(1)} km · {r.locality}
              </span>
              <span className="flex items-center gap-1.5">
                <Star className="size-4 text-gold-400" />
                {priceSymbol(r.priceLevel)} for two
              </span>
            </div>

            {r.offer && (
              <div className="mt-4 flex items-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-chili-600/25 to-ember-500/10 px-4 py-3 ring-1 ring-chili-500/25">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-b from-ember-400 to-chili-600 shadow-glow">
                  <Percent className="size-4 text-white" strokeWidth={2.6} />
                </span>
                <div>
                  <p className="text-sm font-bold text-ember-300">{r.offer}</p>
                  <p className="text-xs text-cream-500">Auto-applied at checkout</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------- menu + side cart ------------------------ */}
      <div className="mx-auto mt-6 max-w-5xl px-4 md:px-6 lg:grid lg:grid-cols-[1fr_300px] lg:gap-8">
        <MenuBrowser
          sections={sections}
          restaurantSlug={r.slug}
          restaurantName={r.name}
          highlightId={dish ? Number(dish) || null : null}
        />
        <aside className="hidden lg:block">
          <MiniCart restaurantSlug={r.slug} restaurantName={r.name} />
        </aside>
      </div>
    </div>
  );
}
