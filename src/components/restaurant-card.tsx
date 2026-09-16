"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Clock3, Heart, Percent, Sparkles, Star } from "lucide-react";
import { BLUR_DATA } from "@/components/atoms";
import { Reveal, TiltCard } from "@/components/motion-primitives";
import { cn, priceSymbol } from "@/lib/domain";
import { useProfile } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";

/**
 * Premium restaurant card — pointer-tracked 3D tilt, cursor glare, sheen sweep,
 * blur-up imagery and a favorite pop. Navigation logic is untouched.
 */
export function RestaurantCard({
  restaurant,
  className,
  priority = false,
  size = "md",
  index = 0,
}: {
  restaurant: RestaurantDto;
  className?: string;
  priority?: boolean;
  size?: "md" | "lg";
  index?: number;
}) {
  const r = restaurant;
  const router = useRouter();
  const { isFavorite, toggleFavorite, hydrated } = useProfile();
  const { toast } = useToast();
  const fav = hydrated && isFavorite(r.slug);

  return (
    <Reveal variant="flip" delay={(index % 4) * 80} className={className}>
      <TiltCard className="group relative h-full rounded-3xl">
        <div
          role="link"
          tabIndex={0}
          aria-label={r.name}
          onClick={() => router.push(`/restaurants/${r.slug}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(`/restaurants/${r.slug}`);
          }}
          className="relative cursor-pointer select-none rounded-3xl outline-none press"
        >
          {/* image */}
          <div
            className={cn(
              "relative overflow-hidden rounded-3xl shadow-lift ring-1 ring-white/8 transition-shadow duration-500 group-hover:shadow-float group-hover:ring-white/20",
              size === "lg" ? "aspect-[4/3] md:aspect-[16/10]" : "aspect-[4/3]",
            )}
          >
            <Image
              src={r.imageUrl}
              alt={r.name}
              fill
              priority={priority}
              sizes={
                size === "lg"
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
                toggleFavorite(r.slug);
                if (!fav) toast("Saved to favorites", { sub: r.name });
              }}
              className={cn(
                "press absolute right-3 top-3 grid size-9 place-items-center rounded-full transition-all duration-300",
                fav ? "bg-chili-500 text-white shadow-glow" : "glass-strong text-cream-50 hover:bg-white/20",
              )}
            >
              <Heart
                className={cn(
                  "size-4 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  fav ? "scale-110 fill-current -rotate-6" : "group-hover:scale-105",
                )}
              />
            </button>

            {/* rating chip */}
            <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 backdrop-blur-md transition-transform duration-500 group-hover:-translate-y-0.5">
              <Star className="size-3 fill-gold-400 text-gold-400" />
              <span className="text-xs font-bold text-white">{r.rating.toFixed(1)}</span>
            </div>

            {/* offer ribbon */}
            {r.offer && (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-r from-chili-600/95 to-chili-500/80 px-3.5 py-2 backdrop-blur-sm">
                <Percent className="size-3.5 shrink-0 text-white" strokeWidth={2.6} />
                <span className="truncate text-xs font-bold tracking-wide text-white">{r.offer}</span>
              </div>
            )}

            {r.pureVeg && (
              <div className="absolute left-3 bottom-3 flex items-center gap-1 rounded-full bg-mint-500/90 px-2 py-0.5">
                <Sparkles className="size-3 text-emerald-950" />
                <span className="text-[10px] font-bold text-emerald-950">PURE VEG</span>
              </div>
            )}
          </div>

          {/* meta */}
          <div className="px-1.5 pt-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate font-display text-[17px] font-bold tracking-tight text-cream-50 transition-colors duration-300 group-hover:text-ember-300">
                {r.name}
              </h3>
              <span className="shrink-0 pt-0.5 text-xs font-semibold text-cream-500">{priceSymbol(r.priceLevel)}</span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-cream-500">{r.cuisines.join(" · ")}</p>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-cream-400">
              <span className="flex items-center gap-1">
                <Clock3 className="size-3.5 text-ember-400" />
                {r.deliveryMinutes} min
              </span>
              <span aria-hidden className="text-cream-600">•</span>
              <span>{r.distanceKm.toFixed(1)} km</span>
              <span aria-hidden className="text-cream-600">•</span>
              <span className="truncate">{r.locality}</span>
            </div>
          </div>
        </div>
      </TiltCard>
    </Reveal>
  );
}


