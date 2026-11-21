"use client";

import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart";
import { ConsentProvider } from "@/lib/consent";
import { LocationProvider, useLocationPicker } from "@/lib/location";
import { ProfileProvider } from "@/lib/profile";
import { ToastProvider } from "@/lib/toast";
import { ConsentSurface } from "@/components/consent-banner";
import { LocationPicker } from "@/components/location-picker";
import { SearchProvider } from "@/components/search-overlay";

function LocationPickerHost() {
  const { isPickerOpen } = useLocationPicker();
  return isPickerOpen ? <LocationPicker /> : null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocationProvider>
      {/* Above ProfileProvider, which reads the consent record to decide whether
          it may record favourites and recent searches. ConsentSurface has to sit
          below both — it needs the record to render and the profile to clear. */}
      <ConsentProvider>
        <ProfileProvider>
          <CartProvider>
            <ToastProvider>
              <SearchProvider>
                {children}
                <LocationPickerHost />
                <ConsentSurface />
              </SearchProvider>
            </ToastProvider>
          </CartProvider>
        </ProfileProvider>
      </ConsentProvider>
    </LocationProvider>
  );
}