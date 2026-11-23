"use client";

import { useEffect, useRef } from "react";
import type { RecentRestaurant } from "@/lib/recent-items";
import { useProfileReady, useRecentItems } from "@/lib/profile";

/**
 * Records a restaurant open without adding view-tracking to unrelated detail
 * components. The route template remounts on navigation, so one mount equals
 * one genuine visit; the ref keeps React StrictMode's development double-run
 * from adding the same restaurant twice.
 */
export function RecentRestaurantRecorder({ restaurant }: { restaurant: RecentRestaurant }) {
  const hydrated = useProfileReady();
  const { rememberRestaurant } = useRecentItems();
  const recordedSlug = useRef<string | null>(null);

  useEffect(() => {
    // Wait for the profile read: recording first would be overwritten by the
    // hydration that follows, and would also write before consent is known.
    if (!hydrated || recordedSlug.current === restaurant.slug) return;
    recordedSlug.current = restaurant.slug;
    rememberRestaurant(restaurant);
  }, [hydrated, rememberRestaurant, restaurant]);

  return null;
}
