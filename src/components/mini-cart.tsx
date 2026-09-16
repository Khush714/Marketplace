"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { AddButton } from "@/components/add-button";
import { BLUR_DATA, VegDot } from "@/components/atoms";
import { AnimatedPrice } from "@/components/motion-primitives";
import { formatINR } from "@/lib/domain";
import { useCart } from "@/lib/cart";

/** Desktop sticky side-cart on the restaurant page. Logic lives in the cart engine. */
export function MiniCart({ restaurantSlug, restaurantName }: { restaurantSlug: string; restaurantName: string }) {
  const cart = useCart();
  if (!cart.hydrated) return null;

  const mine = cart.restaurantSlug === restaurantSlug && cart.items.length > 0;

  return (
    <div className="sticky top-[136px]">
      <div className="glass rounded-3xl p-5">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
          <ShoppingBag className="size-4.5 text-ember-400" /> Your cart
        </h3>

        {mine ? (
          <div className="animate-fade-in">
            <ul className="mt-4 space-y-3.5">
              {cart.items.map((i) => (
                <li key={i.menuItemId} className="flex items-center gap-2.5">
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-lg">
                    <Image src={i.imageUrl} alt="" fill sizes="40px" className="object-cover" placeholder="blur" blurDataURL={BLUR_DATA} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <VegDot veg={i.isVeg} className="size-3" />
                      <span className="truncate text-[13px] font-medium text-cream-200">{i.name}</span>
                    </span>
                    <span className="text-xs text-cream-500 tabular-nums">{formatINR(i.priceCents * i.quantity)}</span>
                  </span>
                  <AddButton
                    item={{ menuItemId: i.menuItemId, name: i.name, priceCents: i.priceCents, imageUrl: i.imageUrl, isVeg: i.isVeg }}
                    restaurantSlug={restaurantSlug}
                    restaurantName={restaurantName}
                    compact
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
              <span className="text-sm text-cream-400">Subtotal</span>
              <AnimatedPrice cents={cart.subtotalCents} className="text-sm font-bold text-cream-50" />
            </div>
            <Link
              href="/checkout"
              className="press mt-4 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow transition-shadow hover:shadow-[0_14px_48px_-8px_rgba(255,90,60,0.6)]"
            >
              Checkout <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : cart.items.length > 0 ? (
          <div className="animate-fade-in mt-3">
            <p className="text-sm leading-relaxed text-cream-400">
              Your cart has items from <span className="font-semibold text-cream-200">{cart.restaurantName}</span>.
            </p>
            <Link
              href="/cart"
              className="press mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white/8 py-3 text-sm font-bold text-cream-50 transition-colors hover:bg-white/12"
            >
              Review cart <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-cream-500">
            Tap <span className="font-bold text-ember-300">ADD</span> on anything that catches your eye.
          </p>
        )}
      </div>
    </div>
  );
}
