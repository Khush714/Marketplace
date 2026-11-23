"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Clock3, Heart, Percent, Sparkles, Star } from "lucide-react";
import { BLUR_DATA } from "@/components/atoms";
import { Reveal, TiltCard } from "@/components/motion-primitives";
import { cn, formatDistance, isUnrated, priceSymbol } from "@/lib/domain";
import { useCustomerAccountOptional } from "@/lib/customer-account";
import { useFavorites, useProfileReady } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";

/**
 * Restaurant card with two presentations. Home rails keep the premium poster
 * card; the browse grid opts into the compact row so a phone can compare several
 * kitchens without scrolling past a full-height image each time. Navigation,
 * favorites and the facts shown are identical — only the density changes.
 */
export function RestaurantCard({
  restaurant,
  className,
  priority = false,
  size = "md",
  index = 0,
  variant = "card",
}: {
  restaurant: RestaurantDto;
  className?: string;
  priority?: boolean;
  size?: "md" | "lg";
  index?: number;
  variant?: "card" | "row";
}) {
  const r = restaurant;
  const compact = variant === "row";
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const hydrated = useProfileReady();
  const { toast } = useToast();
  const account = useCustomerAccountOptional();
  const fav = hydrated && isFavorite(r.slug);

  return (
    <Reveal variant="flip" delay={(index % 4) * 80} className={className}>
      <TiltCard className="group relative h-full rounded-3xl">
        <div
          data-restaurant-card={compact ? "true" : undefined}
          role="link"
          tabIndex={0}
          aria-label={r.name}
          onClick={() => router.push(`/restaurants/${r.slug}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(`/restaurants/${r.slug}`);
          }}
          className={cn(
            "relative cursor-pointer select-none rounded-3xl outline-none press",
            compact && "flex gap-0 rounded-2xl bg-white/[0.025] p-1.5 ring-1 ring-white/8 sm:block sm:rounded-3xl sm:bg-transparent sm:p-0 sm:ring-0",
          )}
        >
          {/* image */}
          <div
            className={cn(
              "relative overflow-hidden shadow-lift ring-1 ring-white/8 transition-shadow duration-500 group-hover:shadow-float group-hover:ring-white/20",
              compact
                ? "size-[104px] shrink-0 rounded-2xl sm:aspect-[4/3] sm:h-auto sm:w-full sm:rounded-3xl"
                : size === "lg"
                  ? "aspect-[4/3] rounded-3xl md:aspect-[16/10]"
                  : "aspect-[4/3] rounded-3xl",
            )}
          >
            <Image
              src={r.imageUrl}
              alt={r.name}
              fill
              priority={priority}
              sizes={
                compact
                  ? "(max-width: 640px) 104px, (max-width: 1024px) 45vw, (max-width: 1280px) 30vw, 22vw"
                  : size === "lg"
                    ? "(max-width: 768px) 85vw, 560px"
                    : "(max-width: 768px) 70vw, (max-width: 1280px) 30vw, 22vw"
              }
              placeholder="blur"
              blurDataURL={BLUR_DATA}
              className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.08]"
            />
            {/* legibility + depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-black/25 transition-opacity duration-500 group-hover:from-black/70" />
            {/* sheen sweep */}
            <span
              aria-hidden
              className="sheen-band absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:animate-sheen group-hover:opacity-100"
            />

            {/* favorite */}
            <button
              type="button"
              aria-label={fav ? "Remove from favorites" : "Save to favorites"}
              aria-pressed={fav}
              onClick={(e) => {
                e.stopPropagation();
                const wasFav = fav;
                toggleFavorite(r.slug);
                if (!wasFav) toast("Saved to favorites", { sub: r.name });
                // Best-effort cross-device sync when signed in (explicit account action).
                if (account?.status === "signedIn") {
                  const slug = encodeURIComponent(r.slug);
                  void (wasFav
                    ? account.accountFetch(`/api/customer/favorites?slug=${slug}`, { method: "DELETE", mutating: true })
                    : account.accountFetch("/api/customer/favorites", {
                        method: "POST",
                        mutating: true,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ slug: r.slug }),
                      })
                  ).catch(() => {
                    /* keep local UI responsive; account sync is best-effort */
                  });
                }
              }}
              className={cn(
                "press absolute grid place-items-center rounded-full transition-all duration-300",
                fav ? "bg-chili-500 text-white shadow-glow" : "glass-strong text-cream-50 hover:bg-white/20",
                compact ? "right-1.5 top-1.5 size-8 sm:right-3 sm:top-3 sm:size-9" : "right-3 top-3 size-9",
              )}
            >
              <Heart
                className={cn(
                  "transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  fav ? "scale-110 fill-current -rotate-6" : "group-hover:scale-105",
                  compact ? "size-3.5 sm:size-4" : "size-4",
                )}
              />
            </button>

            {/* rating chip — a "New" pill until the listing has any reviews */}
            <div
              className={cn(
                "absolute flex items-center gap-1 rounded-full bg-black/55 backdrop-blur-md transition-transform duration-500 group-hover:-translate-y-0.5",
                compact ? "left-1.5 top-1.5 px-1.5 py-0.5 sm:left-3 sm:top-3 sm:px-2 sm:py-1" : "left-3 top-3 px-2 py-1",
              )}
            >
              {isUnrated(r.ratingsCount) ? (
                <>
                  <Sparkles className="size-3 fill-ember-400 text-ember-400" />
                  <span className={cn("font-bold text-white", compact ? "text-[10px] sm:text-xs" : "text-xs")}>New</span>
                </>
              ) : (
                <>
                  <Star className="size-3 fill-gold-400 text-gold-400" />
                  <span className={cn("font-bold text-white", compact ? "text-[10px] sm:text-xs" : "text-xs")}>
                    {r.rating.toFixed(1)}
                  </span>
                </>
              )}
            </div>

            {/* offer ribbon */}
            {r.offer && (
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-r from-chili-600/95 to-chili-500/80 backdrop-blur-sm",
                  compact ? "px-2 py-1 sm:px-3.5 sm:py-2" : "px-3.5 py-2",
                )}
              >
                <Percent className="size-3.5 shrink-0 text-white" strokeWidth={2.6} />
                <span className={cn("truncate font-bold tracking-wide text-white", compact ? "text-[10px] sm:text-xs" : "text-xs")}>
                  {r.offer}
                </span>
              </div>
            )}

            {r.pureVeg && (
              <div
                className={cn(
                  "absolute left-3 bottom-3 flex items-center gap-1 rounded-full bg-mint-500/90 px-2 py-0.5",
                  compact && "hidden sm:flex",
                )}
              >
                <Sparkles className="size-3 text-emerald-950" />
                <span className="text-[10px] font-bold text-emerald-950">PURE VEG</span>
              </div>
            )}
          </div>

          {/* meta */}
          <div
            className={cn(
              "min-w-0",
              compact
                ? "flex flex-1 flex-col justify-center px-3 py-1.5 sm:block sm:px-1.5 sm:py-0 sm:pt-3"
                : "px-1 pt-2.5 md:px-1.5 md:pt-3",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <h3
                className={cn(
                  "truncate font-display font-bold tracking-tight text-cream-50 transition-colors duration-300 group-hover:text-ember-300",
                  compact ? "text-[15px] sm:text-[16px] md:text-[17px]" : "text-[16px] md:text-[17px]",
                )}
              >
                {r.name}
              </h3>
              <span className={cn("shrink-0 pt-0.5 font-semibold text-cream-500", compact ? "text-[11px] sm:text-xs" : "text-xs")}>
                {priceSymbol(r.priceLevel)}
              </span>
            </div>
            <p className={cn("truncate text-cream-500", compact ? "mt-0.5 text-[11px] sm:text-[13px]" : "mt-0.5 text-[13px]")}>
              {r.cuisines.join(" · ")}
            </p>

            {compact && (
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-cream-400 sm:hidden">
                {r.pureVeg && (
                  <span className="inline-flex items-center gap-1 text-mint-300">
                    <Sparkles className="size-2.5" /> Veg
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-semibold",
                    r.openNow ? "text-mint-300" : "text-cream-500",
                  )}
                >
                  <span aria-hidden className={cn("size-1.5 rounded-full", r.openNow ? "bg-mint-400" : "bg-cream-600")} />
                  {r.openNow ? "Open" : "Closed"}
                </span>
                {r.openNow && (
                  <span className={r.deliveryAvailable ? "text-cream-300" : "text-cream-500"}>
                    {r.deliveryAvailable ? "Delivery" : "No delivery"}
                  </span>
                )}
              </div>
            )}

            <div
              className={cn(
                "flex items-center gap-1.5 text-xs text-cream-400",
                compact ? "mt-1 text-[11px] sm:mt-1.5 sm:gap-2 sm:text-xs" : "mt-1 md:mt-1.5 md:gap-2",
              )}
            >
              <span className="flex items-center gap-1">
                <Clock3 className={cn("text-ember-400", compact ? "size-3 sm:size-3.5" : "size-3.5")} />
                {r.deliveryMinutes} min
              </span>
              <span aria-hidden className="text-cream-600">•</span>
              <span>{formatDistance(r.distanceKm)}</span>
              <span aria-hidden className="text-cream-600">•</span>
              <span className="truncate">{r.locality}</span>
            </div>
          </div>
        </div>
      </TiltCard>
    </Reveal>
  );
}
