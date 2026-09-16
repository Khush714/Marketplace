"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, ShoppingBag, TriangleAlert } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { EmberField } from "@/components/ember-field";
import { ScrollProgress } from "@/components/scroll-progress";
import { SiteHeader } from "@/components/site-header";
import { AnimatedPrice, RevealObserver } from "@/components/motion-primitives";
import { useCart } from "@/lib/cart";

const CART_BAR_HIDDEN = ["/cart", "/checkout"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideCartBar = CART_BAR_HIDDEN.includes(pathname) || pathname.startsWith("/order/");

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <RevealObserver />
      <ScrollProgress />
      <SiteHeader />
      <EmberField />
      <main className="flex-1 pb-28 md:pb-12">{children}</main>
      {!hideCartBar && <FloatingCartBar />}
      <BottomNav />
      <CartConflictDialog />
      <SiteFooter />
    </div>
  );
}

function FloatingCartBar() {
  const { itemCount, subtotalCents, restaurantName, bump, hydrated } = useCart();
  if (!hydrated || itemCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-[84px] z-40 flex justify-center px-4 md:bottom-6">
      <Link
        href="/cart"
        className="animate-pop-in group relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-ember-500 via-chili-500 to-chili-600 py-3 pl-4 pr-3 shadow-glow transition-transform duration-300 hover:-translate-y-0.5 press"
      >
        {/* moving sheen */}
        <span
          aria-hidden
          className="sheen-band animate-sheen absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:opacity-100"
        />
        <span className="relative grid size-9 place-items-center rounded-xl bg-white/18">
          <ShoppingBag className="size-4.5 text-white" strokeWidth={2.2} />
          <span
            key={bump}
            className="animate-jelly absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-white px-1 py-px text-[10px] font-bold text-chili-600"
          >
            {itemCount}
          </span>
        </span>
        <span className="relative min-w-0 flex-1 text-left">
          <span className="block text-[11px] font-medium leading-tight text-white/75">
            {itemCount} item{itemCount > 1 ? "s" : ""} · {restaurantName}
          </span>
          <AnimatedPrice cents={subtotalCents} className="block text-sm font-bold leading-tight text-white" />
        </span>
        <span className="relative flex items-center gap-1 text-sm font-bold text-white">
          View cart
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </span>
      </Link>
    </div>
  );
}

function CartConflictDialog() {
  const { conflict, resolveConflict, restaurantName } = useCart();
  if (!conflict) return null;

  return (
    <div role="alertdialog" aria-modal="true" aria-label="Replace cart" className="fixed inset-0 z-[85] grid place-items-center px-4">
      <button
        aria-label="Dismiss"
        onClick={() => resolveConflict(false)}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm"
      />
      <div className="glass-strong animate-pop-in relative w-full max-w-sm rounded-3xl p-6 text-center">
        <span className="animate-jelly mx-auto grid size-12 place-items-center rounded-2xl bg-chili-500/15 text-chili-400">
          <TriangleAlert className="size-6" />
        </span>
        <h3 className="mt-4 font-display text-lg font-bold text-cream-50">Start a fresh cart?</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-cream-400">
          Your cart has dishes from <span className="font-semibold text-cream-200">{restaurantName}</span>.
          Adding from <span className="font-semibold text-cream-200">{conflict.restaurantName}</span> will
          replace them.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => resolveConflict(false)}
            className="press rounded-xl bg-white/8 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            Keep current
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveConflict(true)}
            className="press relative overflow-hidden rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-2.5 text-sm font-bold text-white shadow-glow"
          >
            Start fresh
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/6 py-8 text-center">
      <p className="text-xs text-cream-600">
        crave<span className="text-chili-500">.</span> — a marketplace experience · Crafted with fire in
        Bengaluru
      </p>
    </footer>
  );
}


