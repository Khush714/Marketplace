"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgePercent, ShoppingBag, Trash2, Truck } from "lucide-react";
import { AddButton } from "@/components/add-button";
import { BLUR_DATA, EmptyState, VegDot } from "@/components/atoms";
import { AnimatedPrice } from "@/components/motion-primitives";
import { estimateBill, formatINR } from "@/lib/domain";
import { useCart } from "@/lib/cart";

export default function CartPage() {
  const cart = useCart();

  if (!cart.hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 md:px-6">
        <div className="skeleton h-8 w-48" />
        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-24 rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-14 md:px-6">
        <EmptyState
          icon={<ShoppingBag className="size-6" />}
          title="Your cart is craving food"
          sub="It's beautifully empty. That won't last — explore kitchens around you."
          action={
            <Link
              href="/restaurants"
              className="press mt-2 flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
            >
              Discover restaurants <ArrowRight className="size-4" />
            </Link>
          }
        />
      </div>
    );
  }

  const bill = estimateBill(cart.subtotalCents);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-40 pt-6 md:px-6 md:pb-12 md:pt-9">
      <Link href="/restaurants" className="press inline-flex items-center gap-1.5 text-sm font-medium text-cream-400 transition-colors hover:text-cream-50">
        <ArrowLeft className="size-4" /> Add more dishes
      </Link>

      <header className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">Your order</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
          The {cart.restaurantName} <span className="text-gradient">haul</span>
        </h1>
      </header>

      <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* items */}
        <section className="min-w-0">
          <ul className="space-y-3">
            {cart.items.map((i, idx) => (
              <li
                key={i.menuItemId}
                style={{ animationDelay: `${idx * 50}ms` }}
                className="animate-rise glass lift flex items-center gap-4 rounded-3xl p-3.5 hover:shadow-lift"
              >
                <span className="relative size-20 shrink-0 overflow-hidden rounded-2xl md:size-24">
                  <Image
                    src={i.imageUrl}
                    alt={i.name}
                    fill
                    sizes="96px"
                    placeholder="blur"
                    blurDataURL={BLUR_DATA}
                    className="object-cover"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <VegDot veg={i.isVeg} />
                    <h3 className="truncate font-display text-[15px] font-bold text-cream-50">{i.name}</h3>
                  </div>
                  <p className="mt-0.5 text-xs text-cream-500 tabular-nums">{formatINR(i.priceCents)} each</p>
                  <p className="mt-1 text-sm font-bold text-cream-50 tabular-nums">
                    {formatINR(i.priceCents * i.quantity)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <AddButton
                    item={{ menuItemId: i.menuItemId, name: i.name, priceCents: i.priceCents, imageUrl: i.imageUrl, isVeg: i.isVeg }}
                    restaurantSlug={cart.restaurantSlug}
                    restaurantName={cart.restaurantName}
                    compact
                  />
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={cart.clear}
            className="press mt-5 flex items-center gap-1.5 text-sm font-medium text-cream-500 transition-colors hover:text-chili-400"
          >
            <Trash2 className="size-4" /> Clear cart
          </button>
        </section>

        {/* bill */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="glass rounded-3xl p-5 md:p-6">
            <h2 className="font-display text-base font-bold text-cream-50">Bill details</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-cream-400">Item total</dt>
                <dd className="font-semibold text-cream-50 tabular-nums">{formatINR(cart.subtotalCents)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-cream-400">
                  <Truck className="size-3.5" /> Delivery fee
                </dt>
                <dd className="font-semibold tabular-nums">
                  {bill.freeDelivery ? (
                    <span className="text-mint-400">FREE</span>
                  ) : (
                    <span className="text-cream-50">{formatINR(bill.deliveryFee)}</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-cream-400">Platform fee</dt>
                <dd className="font-semibold text-cream-50 tabular-nums">{formatINR(bill.platformFee)}</dd>
              </div>
              {!bill.freeDelivery && (
                <p className="rounded-xl bg-mint-500/8 px-3 py-2 text-xs text-mint-400">
                  Add {formatINR(49900 - cart.subtotalCents)} more for free delivery
                </p>
              )}
              <div className="flex items-center gap-1.5 rounded-xl bg-chili-500/8 px-3 py-2 text-xs text-chili-300">
                <BadgePercent className="size-3.5 shrink-0" />
                Restaurant offers are auto-applied at checkout
              </div>
            </dl>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
              <span className="font-display text-base font-bold text-cream-50">To pay</span>
              <AnimatedPrice cents={bill.total} className="font-display text-xl font-bold text-cream-50" />
            </div>
          </div>

          {/* desktop CTA */}
          <Link
            href="/checkout"
            className="press mt-4 hidden items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-4 text-[15px] font-bold text-white shadow-glow transition-shadow hover:shadow-[0_16px_52px_-8px_rgba(255,90,60,0.65)] lg:flex"
          >
            Proceed to checkout <ArrowRight className="size-4.5" />
          </Link>
        </aside>
      </div>

      {/* mobile sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-void/85 p-4 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <Link
          href="/checkout"
          className="press flex items-center justify-between rounded-2xl bg-gradient-to-r from-ember-500 to-chili-600 px-5 py-3.5 font-bold text-white shadow-glow"
        >
          <span className="text-left leading-tight">
            <span className="block text-[11px] font-medium text-white/75">{cart.itemCount} items</span>
            <AnimatedPrice cents={bill.total} className="block text-base font-bold" />
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            Checkout <ArrowRight className="size-4.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}
