"use client";

import { useEffect, useState } from "react";
import {
  menuAvailabilityFromSections,
  type MenuAvailabilityMap,
} from "@/lib/menu-availability-core";
import type { MenuSection } from "@/lib/types";

const EMPTY_AVAILABILITY: MenuAvailabilityMap = {};

/**
 * Cart lines are a localStorage snapshot, so their availability can go stale
 * while a customer is filling in checkout. Re-read the published menu for the
 * cart's restaurant; the server still rechecks every line when the order is
 * placed, this only keeps what the customer sees honest.
 *
 * The fetched map is keyed by the slug it belongs to. A slug change (or a
 * disabled hook) therefore falls back to the empty map during render instead
 * of clearing state inside the effect, which would cascade another render.
 */
export function useMenuAvailability(restaurantSlug: string, enabled = true): MenuAvailabilityMap {
  const [loaded, setLoaded] = useState<{ slug: string; map: MenuAvailabilityMap }>({
    slug: "",
    map: EMPTY_AVAILABILITY,
  });

  useEffect(() => {
    if (!enabled || !restaurantSlug) return;
    let cancelled = false;
    fetch(`/api/restaurants/${encodeURIComponent(restaurantSlug)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.resolve(null)))
      .then((data: { sections?: MenuSection[] } | null) => {
        if (cancelled) return;
        setLoaded({
          slug: restaurantSlug,
          map: Array.isArray(data?.sections) ? menuAvailabilityFromSections(data.sections) : EMPTY_AVAILABILITY,
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ slug: restaurantSlug, map: EMPTY_AVAILABILITY });
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantSlug, enabled]);

  if (!enabled || !restaurantSlug || loaded.slug !== restaurantSlug) return EMPTY_AVAILABILITY;
  return loaded.map;
}
