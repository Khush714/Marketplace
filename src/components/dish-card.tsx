"use client";

import Image from "next/image";
import { forwardRef } from "react";
import { Flame } from "lucide-react";
import { AddButton } from "@/components/add-button";
import { BLUR_DATA, VegDot } from "@/components/atoms";
import { cssVars } from "@/components/motion-primitives";
import { cn, formatINR } from "@/lib/domain";
import type { MenuItemDto } from "@/lib/types";

export const DishCard = forwardRef<
  HTMLDivElement,
  {
    item: MenuItemDto;
    restaurantSlug: string;
    restaurantName: string;
    highlighted?: boolean;
    index?: number;
  }
>(function DishCard({ item, restaurantSlug, restaurantName, highlighted, index = 0 }, ref) {
  return (
    <div
      ref={ref}
      id={`dish-${item.id}`}
      data-reveal="up"
      style={cssVars({ "--rd": `${(index % 6) * 55}ms` })}
      className={cn(
        "group relative flex gap-4 rounded-2xl p-3 transition-colors duration-300",
        highlighted
          ? "animate-fade-in bg-ember-400/8 ring-1 ring-ember-400/40"
          : "hover:bg-white/[0.035]",
      )}
    >
      {/* info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <VegDot veg={item.isVeg} />
          {item.isBestseller && (
            <span className="flex items-center gap-1 rounded-full bg-gold-400/12 px-1.5 py-0.5 text-[10px] font-bold text-gold-400">
              <Flame className="size-2.5" /> BESTSELLER
            </span>
          )}
        </div>
        <h4 className="mt-1.5 font-display text-[15px] font-bold tracking-tight text-cream-50 md:text-base">
          {item.name}
        </h4>
        <p className="mt-0.5 text-sm font-semibold text-cream-200">{formatINR(item.priceCents)}</p>
        {item.description && (
          <p className="mt-1.5 line-clamp-2 max-w-md text-[13px] leading-relaxed text-cream-500">
            {item.description}
          </p>
        )}
      </div>

      {/* image + action */}
      <div className="relative w-28 shrink-0 md:w-32">
        <div className="relative aspect-square overflow-hidden rounded-2xl shadow-lift">
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="128px"
            placeholder="blur"
            blurDataURL={BLUR_DATA}
            className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
          />
        </div>
        <div className="absolute inset-x-2 -bottom-3.5 flex justify-center">
          <AddButton
            item={{
              menuItemId: item.id,
              name: item.name,
              priceCents: item.priceCents,
              imageUrl: item.imageUrl,
              isVeg: item.isVeg,
            }}
            restaurantSlug={restaurantSlug}
            restaurantName={restaurantName}
            className="w-full justify-center"
            compact
          />
        </div>
      </div>
    </div>
  );
});
