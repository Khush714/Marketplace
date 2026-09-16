"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/domain";
import { useProfile } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";

export function FavoriteHeroButton({ restaurant }: { restaurant: RestaurantDto }) {
  const { isFavorite, toggleFavorite, hydrated } = useProfile();
  const { toast } = useToast();
  const fav = hydrated && isFavorite(restaurant.slug);

  return (
    <button
      type="button"
      aria-label={fav ? "Remove from favorites" : "Save to favorites"}
      aria-pressed={fav}
      onClick={() => {
        toggleFavorite(restaurant.slug);
        toast(fav ? "Removed from favorites" : "Saved to favorites", { sub: restaurant.name, kind: fav ? "info" : "success" });
      }}
      className={cn(
        "press glass-strong flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300",
        fav ? "bg-chili-500/80 text-white shadow-glow" : "text-cream-50 hover:bg-white/15",
      )}
    >
      <Heart className={cn("size-4 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]", fav && "fill-current scale-110")} />
      {fav ? "Saved" : "Save"}
    </button>
  );
}
