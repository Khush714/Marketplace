import Link from "next/link";
import { ChevronRight, Percent } from "lucide-react";
import { withLoc } from "@/lib/domain";
import type { RestaurantDto } from "@/lib/types";

/**
 * Compact offer discovery. Keeps deals on the first screen without letting a
 * full-height promo banner push restaurant discovery below the fold.
 */
export function OfferStrip({
  restaurants,
  localityKey,
  localityName,
}: {
  restaurants: RestaurantDto[];
  localityKey: string;
  localityName: string;
}) {
  const withOffers = restaurants.filter((r) => r.offer);
  if (withOffers.length === 0) return null;

  return (
    <section className="mx-auto mt-8 max-w-7xl px-4 md:mt-12 md:px-6" aria-labelledby="offer-strip-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="offer-strip-title" className="font-display text-[19px] font-bold tracking-tight text-cream-50 md:text-2xl">
            Offers near you
          </h2>
          <p className="mt-0.5 text-xs text-cream-500 md:text-sm">Deals worth crossing the street for in {localityName}</p>
        </div>
        <Link
          href={withLoc("/restaurants?offers=1", localityKey)}
          className="press group flex shrink-0 items-center gap-1 text-sm font-semibold text-ember-300 transition-colors hover:text-ember-400"
        >
          See all
          <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {withOffers.slice(0, 8).map((r) => (
          <Link
            key={r.slug}
            href={withLoc(`/restaurants/${r.slug}`, localityKey)}
            className="press flex shrink-0 snap-start items-center gap-2 rounded-full border border-chili-500/25 bg-chili-500/[0.08] px-3.5 py-2 text-xs font-semibold text-cream-100 transition-colors hover:bg-chili-500/15 md:py-2.5 md:text-sm"
          >
            <Percent className="size-3.5 shrink-0 text-chili-300" />
            <span className="max-w-[42vw] truncate md:max-w-[190px]">{r.offer}</span>
            <span aria-hidden className="text-cream-600">·</span>
            <span className="max-w-[26vw] truncate font-medium text-cream-500 md:max-w-[130px]">{r.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
