"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/domain";
import { useCustomerAccountOptional } from "@/lib/customer-account";
import { useFavorites, useProfileReady } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";

export function FavoriteHeroButton({ restaurant }: { restaurant: RestaurantDto }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const hydrated = useProfileReady();
  const { toast } = useToast();
  const account = useCustomerAccountOptional();
  const fav = hydrated && isFavorite(restaurant.slug);

  return (
    <button
      type="button"
      aria-label={fav ? "Remove from favorites" : "Save to favorites"}
      aria-pressed={fav}
      onClick={() => {
        const wasFav = fav;
        toggleFavorite(restaurant.slug);
        toast(wasFav ? "Removed from favorites" : "Saved to favorites", {
          sub: restaurant.name,
          kind: wasFav ? "info" : "success",
        });
        // Best-effort cross-device sync when signed in (explicit account action).
        if (account?.status === "signedIn") {
          const slug = encodeURIComponent(restaurant.slug);
          void (wasFav
            ? account.accountFetch(`/api/customer/favorites?slug=${slug}`, { method: "DELETE", mutating: true })
            : account.accountFetch("/api/customer/favorites", {
                method: "POST",
                mutating: true,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slug: restaurant.slug }),
              })
          ).catch(() => {
            /* keep local UI responsive; account sync is best-effort */
          });
        }
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
