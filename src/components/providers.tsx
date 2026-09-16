"use client";

import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart";
import { ProfileProvider } from "@/lib/profile";
import { ToastProvider } from "@/lib/toast";
import { SearchProvider } from "@/components/search-overlay";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ProfileProvider>
      <CartProvider>
        <ToastProvider>
          <SearchProvider>{children}</SearchProvider>
        </ToastProvider>
      </CartProvider>
    </ProfileProvider>
  );
}
