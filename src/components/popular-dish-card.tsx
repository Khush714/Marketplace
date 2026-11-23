import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Flame } from "lucide-react";
import { BLUR_DATA, VegDot } from "@/components/atoms";
import { cn, formatINR } from "@/lib/domain";
import type { PopularDishDto } from "@/lib/types";

/**
 * A popularity card is a search/discovery link, not a cart control. Deep-linking
 * with `?dish=` lands on the kitchen's highlighted dish, which is the same
 * entry point Phase 1's dish-first search uses.
 */
export function PopularDishCard({
  dish,
  index = 0,
  className,
}: {
  dish: PopularDishDto;
  index?: number;
  className?: string;
}) {
  return (
    <Link
      href={`/restaurants/${dish.restaurantSlug}?dish=${dish.id}`}
      aria-label={`Open ${dish.name} from ${dish.restaurantName}`}
      style={{ animationDelay: `${(index % 6) * 55}ms` }}
      className={cn(
        "press animate-rise group flex w-[78vw] max-w-[300px] shrink-0 snap-start items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-3 transition-colors hover:border-ember-400/35 hover:bg-white/[0.06] md:w-[300px]",
        className,
      )}
    >
      <span className="relative size-[76px] shrink-0 overflow-hidden rounded-xl shadow-lift">
        <Image
          src={dish.imageUrl}
          alt={dish.name}
          fill
          sizes="76px"
          placeholder="blur"
          blurDataURL={BLUR_DATA}
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <VegDot veg={dish.isVeg} />
          <span className="flex items-center gap-1 rounded-full bg-ember-400/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ember-300">
            <Flame className="size-2.5" /> Trending
          </span>
        </span>
        <span className="mt-1.5 block truncate font-display text-[15px] font-bold tracking-tight text-cream-50">
          {dish.name}
        </span>
        <span className="mt-0.5 block text-sm font-semibold text-cream-200">{formatINR(dish.priceCents)}</span>
        <span className="mt-0.5 block truncate text-xs text-cream-500">{dish.restaurantName}</span>
        <span className="mt-1 block text-[11px] font-medium text-ember-300/80">
          {dish.orderCount} orders · last 30 days
        </span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 self-start text-cream-600 transition-colors group-hover:text-ember-400" />
    </Link>
  );
}
