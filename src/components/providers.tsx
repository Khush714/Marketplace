"use client";

import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart";
import { LocationProvider, useLocation } from "@/lib/location";
import { ProfileProvider } from "@/lib/profile";
import { ToastProvider } from "@/lib/toast";
import { LocationPicker } from "@/components/location-picker";
import { SearchProvider } from "@/components/search-overlay";

function LocationPickerHost() {
  const { isPickerOpen } = useLocation();
  return isPickerOpen ? <LocationPicker /> : null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocationProvider>
      <ProfileProvider>
        <CartProvider>
          <ToastProvider>
            <SearchProvider>
              {children}
              <LocationPickerHost />
            </SearchProvider>
          </ToastProvider>
        </CartProvider>
      </ProfileProvider>
    </LocationProvider>
  );
}