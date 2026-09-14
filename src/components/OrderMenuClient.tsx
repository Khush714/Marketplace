"use client";

import { useState, useMemo, useEffect } from "react";
import { currency } from "@/lib/format";
import { priceCart, type LineModifierSelection } from "@/lib/pricing";
import {
  readRecentOrders,
  persistRecentOrder,
  type RecentOrder,
} from "@/lib/recent-orders";
import { RazorpayCheckoutButton } from "./RazorpayCheckoutButton";
import { ArrowLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, XIcon } from "./ui/icons";

type MenuItem = {
  id: number;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  available: boolean;
  popular: boolean;
  vegetarian: boolean;
  modifierGroups: ModifierGroup[];
};

type ModifierGroup = {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
};

type Modifier = {
  id: number;
  name: string;
  priceDelta: number;
  available: boolean;
};

type CartItem = {
  menuItemId: number;
  name: string;
  basePrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
};

type SelectedModifier = {
  groupId: number;
  groupName: string;
  modifierId: number;
  modifierName: string;
  priceDelta: number;
};

type RestaurantInfo = {
  slug: string;
  name: string;
  taxRate: number;
  deliveryFee: number;
  minOrder: number;
  accepts: { delivery: boolean; pickup: boolean };
};

type View = "menu" | "checkout" | "confirmation";

const inputCls =
  "mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8";

/** PHASE 32 — scheduling windows. Server enforces the same bounds. */
const SCHEDULE_BUFFER_MS = 5 * 60_000;
const SCHEDULE_HORIZON_MS = 14 * 24 * 60 * 60_000;

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scheduleLabel(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OrderMenuClient({
  categories,
  restaurant,
}: {
  categories: { name: string; items: MenuItem[] }[];
  restaurant: RestaurantInfo;
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [itemModifiers, setItemModifiers] = useState<
    Record<number, number[]>
  >({});
  const [itemQty, setItemQty] = useState(1);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  // PHASE 30 — live rider tracking: capture dropoff coords at checkout so the
  // tracker can render a real map (and the rider app a navigation destination).
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<
    "delivery" | "pickup"
  >("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [notes, setNotes] = useState("");
  // PHASE 32 — scheduled delivery window. ASAP by default; "later" opens a
  // datetime-local picker bounded to +5 min … +14 days from "now".
  const [scheduleLater, setScheduleLater] = useState(false);
  const [scheduledForValue, setScheduledForValue] = useState("");
  const [confirmedScheduled, setConfirmedScheduled] = useState<Date | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<number | null>(null);

  // PHASE — recent orders persisted to localStorage so history survives
  // navigating away and back to this page (state alone is lost on remount).
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>(() =>
    readRecentOrders(),
  );

  // Hide the app-level footer tab bar while an ordering overlay is open so
  // its buttons can never be covered on mobile. Cleanup removes the class.
  useEffect(() => {
    const active = cartOpen || selectedItem !== null || view === "checkout";
    document.body.classList.toggle("ordering-overlay-open", active);
    return () => document.body.classList.remove("ordering-overlay-open");
  }, [cartOpen, selectedItem, view]);

  function saveOrder(
    reference: string,
    restaurantSlug: string,
    restaurantName: string,
    total: number,
  ) {
    setRecentOrders(
      persistRecentOrder({
        reference,
        restaurantSlug,
        restaurantName,
        total,
        placedAt: new Date().toISOString(),
      }),
    );
  }

  const thisRestaurantOrders = useMemo(
    () => recentOrders.filter((o) => o.restaurantSlug === restaurant.slug),
    [recentOrders, restaurant.slug],
  );

  const cartCount = useMemo(
    () => cart.reduce((s, c) => s + c.quantity, 0),
    [cart],
  );

  const pricing = useMemo(() => {
    const lines = cart.map((c) => ({
      menuItemId: c.menuItemId,
      name: c.name,
      basePrice: c.basePrice,
      quantity: c.quantity,
      modifiers: c.selectedModifiers,
    }));
    return priceCart({
      lines,
      taxRate: restaurant.taxRate,
      deliveryFee: restaurant.deliveryFee,
      fulfillment: fulfillmentType,
    });
  }, [cart, fulfillmentType, restaurant.taxRate, restaurant.deliveryFee]);

  function toggleModifier(groupId: number, modifierId: number, max: number) {
    setItemModifiers((prev) => {
      const current = prev[groupId] ?? [];
      const idx = current.indexOf(modifierId);
      const next =
        idx >= 0
          ? current.filter((id) => id !== modifierId)
          : current.length < max
            ? [...current, modifierId]
            : current;
      return { ...prev, [groupId]: next };
    });
  }

  function addToCart() {
    if (!selectedItem) return;

    const selectedMods: SelectedModifier[] = [];
    for (const group of selectedItem.modifierGroups) {
      const ids = itemModifiers[group.id] ?? [];
      for (const mid of ids) {
        const mod = group.modifiers.find((m) => m.id === mid);
        if (mod) {
          selectedMods.push({
            groupId: group.id,
            groupName: group.name,
            modifierId: mod.id,
            modifierName: mod.name,
            priceDelta: mod.priceDelta,
          });
        }
      }
    }

    const key = `${selectedItem.id}-${selectedMods.map((m) => m.modifierId).sort().join(",")}`;
    setCart((prev) => {
      const existing = prev.find(
        (c) =>
          `${c.menuItemId}-${c.selectedModifiers.map((m) => m.modifierId).sort().join(",")}` ===
          key,
      );
      if (existing) {
        return prev.map((c) =>
          c === existing ? { ...c, quantity: c.quantity + itemQty } : c,
        );
      }
      return [
        ...prev,
        {
          menuItemId: selectedItem.id,
          name: selectedItem.name,
          basePrice: selectedItem.price,
          quantity: itemQty,
          selectedModifiers: selectedMods,
        },
      ];
    });

    setSelectedItem(null);
    setItemModifiers({});
    setItemQty(1);
  }

  function updateCartQty(index: number, delta: number) {
    setCart((prev) => {
      const next = prev.map((c, i) =>
        i === index ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c,
      );
      return next.filter((c) => c.quantity > 0);
    });
  }

  function removeCartItem(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setOrderError("Location isn't supported by this browser.");
      return;
    }
    setLocating(true);
    setOrderError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDropoffCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setOrderError(
          "Couldn't get your location. Enable location access to auto-fill the dropoff map pin.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submitOrder() {
    setOrderError(null);
    if (!customerName.trim() || !customerPhone.trim()) {
      setOrderError("Name and phone are required.");
      return;
    }
    if (fulfillmentType === "delivery" && !customerAddress.trim()) {
      setOrderError("Delivery address is required.");
      return;
    }
    if (cart.length === 0) {
      setOrderError("Your cart is empty.");
      return;
    }

    // PHASE 32 — resolve + validate the scheduled window client-side. The
    // server revalidates (bounds shift between render and submit), so this is
    // a fast-fail convenience, not the authority.
    let scheduledIso: string | null = null;
    if (scheduleLater) {
      if (!scheduledForValue) {
        setOrderError("Choose a delivery time, or pick ASAP.");
        return;
      }
      const sched = new Date(scheduledForValue);
      const now = Date.now();
      if (Number.isNaN(sched.getTime())) {
        setOrderError("That delivery time doesn't look right.");
        return;
      }
      if (sched.getTime() < now + SCHEDULE_BUFFER_MS) {
        setOrderError("Choose a time at least 5 minutes from now.");
        return;
      }
      if (sched.getTime() > now + SCHEDULE_HORIZON_MS) {
        setOrderError("Choose a time within the next 14 days.");
        return;
      }
      scheduledIso = sched.toISOString();
      setConfirmedScheduled(sched);
    } else {
      setConfirmedScheduled(null);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/marketplace/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant: restaurant.slug,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: customerAddress.trim(),
          dropoffLat: fulfillmentType === "delivery" ? dropoffCoords?.lat ?? null : null,
          dropoffLng: fulfillmentType === "delivery" ? dropoffCoords?.lng ?? null : null,
          fulfillmentType,
          paymentMethod,
          notes: notes.trim(),
          scheduledFor: scheduledIso,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            quantity: c.quantity,
            modifierIds: c.selectedModifiers.map((m) => m.modifierId),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOrderError(data.error ?? "Failed to place order.");
        return;
      }
      confirmOrder(data.reference, Number(data.total) || 0);
    } catch {
      setOrderError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /** PHASE 24 — Razorpay checkout success path (shared with cash submit). */
  function confirmOrder(reference: string, total: number) {
    setOrderRef(reference);
    setOrderTotal(total);
    saveOrder(reference, restaurant.slug, restaurant.name, total);
    setView("confirmation");
    setCart([]);
    setCartOpen(false);
  }

  const cartForPayment = useMemo(
    () =>
      cart.map((c) => ({
        menuItemId: c.menuItemId,
        quantity: c.quantity,
        modifierIds: c.selectedModifiers.map((m) => m.modifierId),
      })),
    [cart],
  );

  if (view === "confirmation" && orderRef) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 text-2xl text-emerald-400">
          ✓
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          {confirmedScheduled ? "Order scheduled!" : "Order placed!"}
        </h2>
        <p className="mt-2 text-sm text-white/50">
          Your order reference is{" "}
          <span className="font-mono font-bold text-ember-400">{orderRef}</span>
        </p>
        {confirmedScheduled && (
          <p className="mt-1 text-sm text-white/50">
            Scheduled for{" "}
            <span className="font-bold text-sky-400">
              {scheduleLabel(confirmedScheduled)}
            </span>
          </p>
        )}
        {orderTotal !== null && (
          <p className="mt-1 text-sm text-white/50">
            Total: {currency(orderTotal)}
          </p>
        )}
        <a
          href={`/orders/${orderRef}`}
          className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-ember-500 px-6 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
        >
          Track order <ChevronRightIcon className="text-base" />
        </a>
        <button
          type="button"
          onClick={() => {
            setView("menu");
            setOrderRef(null);
            setOrderTotal(null);
            setScheduleLater(false);
            setScheduledForValue("");
            setConfirmedScheduled(null);
          }}
          className="mt-3 text-sm font-semibold text-white/45 transition-colors hover:text-white/80"
        >
          Back to menu
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ─── Cart floating button ─── */}
      {cartCount > 0 && view === "menu" && (
        <button
          type="button"
          key={cartCount}
          onClick={() => setCartOpen(true)}
          className="fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 animate-cart-pop rounded-2xl bg-ember-500 px-6 py-3.5 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.4)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] md:bottom-6"
        >
          View cart ({cartCount}) — {currency(pricing.total)}
        </button>
      )}

      {/* ─── Item detail drawer ─── */}
      {selectedItem && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
          <div className="card-lift max-h-sheet flex w-full max-w-lg flex-col rounded-3xl border border-white/8 bg-ink-850 shadow-2xl sm:my-4">
            <div className="flex items-start justify-between px-6 pb-4 pt-6">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">
                  {selectedItem.name}
                </h3>
                <p className="mt-1 text-sm text-white/45">
                  {selectedItem.description}
                </p>
                <p className="mt-2 font-semibold text-ember-400">
                  {currency(selectedItem.price)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedItem(null);
                  setItemModifiers({});
                  setItemQty(1);
                }}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
              >
                <XIcon className="text-base" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-2">
              {selectedItem.modifierGroups.map((group) => (
                <div key={group.id} className="mt-5">
                  <p className="text-sm font-bold text-white">
                    {group.name}
                    {group.minSelect > 0 && (
                      <span className="ml-1 text-xs font-normal text-white/40">
                        (choose at least {group.minSelect})
                      </span>
                    )}
                  </p>
                  <div className="mt-2 space-y-2">
                    {group.modifiers
                      .filter((m) => m.available)
                      .map((mod) => {
                        const checked =
                          (itemModifiers[group.id] ?? []).includes(mod.id);
                        return (
                          <label
                            key={mod.id}
                            className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 text-sm transition-colors ${
                              checked
                                ? "border-ember-500/50 bg-ember-500/10"
                                : "border-white/8 bg-white/5 hover:bg-white/10"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  toggleModifier(
                                    group.id,
                                    mod.id,
                                    group.maxSelect,
                                  )
                                }
                                className="h-4 w-4 accent-ember-500"
                              />
                              <span className="text-white/80">{mod.name}</span>
                            </div>
                            {mod.priceDelta !== 0 && (
                              <span className="text-xs text-white/40">
                                {mod.priceDelta > 0 ? "+" : ""}
                                {currency(mod.priceDelta)}
                              </span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-4 border-t border-white/6 bg-ink-850 px-6 py-4">
              <div className="flex items-center rounded-2xl border border-white/10 bg-white/5">
                <button
                  type="button"
                  onClick={() => setItemQty((q) => Math.max(1, q - 1))}
                  className="grid h-11 w-11 place-items-center text-white/70 transition-colors hover:text-white"
                >
                  <MinusIcon />
                </button>
                <span className="w-10 text-center text-sm font-bold text-white">
                  {itemQty}
                </span>
                <button
                  type="button"
                  onClick={() => setItemQty((q) => q + 1)}
                  className="grid h-11 w-11 place-items-center text-white/70 transition-colors hover:text-white"
                >
                  <PlusIcon />
                </button>
              </div>
              <button
                type="button"
                onClick={addToCart}
                className="min-w-0 flex-1 truncate rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
              >
                Add to cart — {currency(
                  (selectedItem.price +
                    selectedItem.modifierGroups.reduce((sum, g) => {
                      const ids = itemModifiers[g.id] ?? [];
                      return (
                        sum +
                        ids.reduce((s, mid) => {
                          const mod = g.modifiers.find((m) => m.id === mid);
                          return s + (mod?.priceDelta ?? 0);
                        }, 0)
                      );
                    }, 0)) * itemQty,
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Cart drawer ─── */}
      {cartOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
          <div className="max-h-sheet-tight flex w-full max-w-lg flex-col rounded-3xl border border-white/8 bg-ink-850 shadow-2xl sm:my-4">
            <div className="flex items-center justify-between border-b border-white/6 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Your cart</h3>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
              >
                <XIcon className="text-base" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 py-12 text-center text-sm text-white/40">
                Your cart is empty
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {cart.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between border-b border-white/5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">
                          {item.name}
                        </p>
                        {item.selectedModifiers.length > 0 && (
                          <p className="mt-0.5 text-xs text-white/40">
                            {item.selectedModifiers
                              .map((m) => m.modifierName)
                              .join(", ")}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateCartQty(i, -1)}
                            className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-white/70 transition-colors hover:bg-white/10"
                          >
                            <MinusIcon className="text-sm" />
                          </button>
                          <span className="w-8 text-center text-sm font-bold text-white">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(i, 1)}
                            className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-white/70 transition-colors hover:bg-white/10"
                          >
                            <PlusIcon className="text-sm" />
                          </button>
<button
  type="button"
  onClick={() => removeCartItem(i)}
  className="ml-2 rounded-lg px-3 py-2.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
>
  Remove
</button>
                        </div>
                      </div>
                      <p className="ml-4 text-sm font-semibold text-white/90">
                        {currency(
                          (item.basePrice +
                            item.selectedModifiers.reduce(
                              (s, m) => s + m.priceDelta,
                              0,
                            )) *
                            item.quantity,
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-white/6 px-6 py-4">
                  <div className="space-y-1 text-sm text-white/60">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{currency(pricing.subtotal)}</span>
                    </div>
                    {pricing.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-400">
                        <span>Discount</span>
                        <span>−{currency(pricing.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Tax</span>
                      <span>{currency(pricing.taxAmount)}</span>
                    </div>
                    {fulfillmentType === "delivery" && (
                      <div className="flex justify-between">
                        <span>Delivery fee</span>
                        <span>{currency(pricing.deliveryFee)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-white/6 pt-1 text-base font-bold text-white">
                      <span>Total</span>
                      <span>{currency(pricing.total)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCartOpen(false);
                      setView("checkout");
                    }}
                    className="mt-4 w-full rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
                  >
                    Checkout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Checkout form ─── */}
      {view === "checkout" && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-ink-950">
          <div className="mx-auto max-w-lg px-6 py-8">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setView("menu")}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
              >
                <ArrowLeftIcon className="text-base" />
              </button>
              <h2 className="text-lg font-bold text-white">Checkout</h2>
            </div>

            <div className="mt-6 space-y-4">
              {/* Fulfillment */}
              <div>
                <label className="text-sm font-bold text-white">
                  Order type
                </label>
                <div className="mt-2 flex gap-2">
                  {restaurant.accepts.delivery && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType("delivery")}
                      className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                        fulfillmentType === "delivery"
                          ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
                          : "border-white/10 text-white/60 hover:bg-white/5"
                      }`}
                    >
                      Delivery
                    </button>
                  )}
                  {restaurant.accepts.pickup && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType("pickup")}
                      className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                        fulfillmentType === "pickup"
                          ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
                          : "border-white/10 text-white/60 hover:bg-white/5"
                      }`}
                    >
                      Pickup
                    </button>
                  )}
                </div>
              </div>

              {/* Payment */}
              <div>
                <label className="text-sm font-bold text-white">
                  Payment
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("cash")}
                    className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      paymentMethod === "cash"
                        ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
                        : "border-white/10 text-white/60 hover:bg-white/5"
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("card")}
                    className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      paymentMethod === "card"
                        ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
                        : "border-white/10 text-white/60 hover:bg-white/5"
                    }`}
                  >
                    Pay online
                  </button>
                </div>
                {paymentMethod === "card" && (
                  <p className="mt-1.5 text-xs text-white/40">
                    Cards, UPI, netbanking & wallets via Razorpay.
                  </p>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="text-sm font-bold text-white">
                  Your name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Jane Smith"
                  className={inputCls}
                />
              </div>

              {/* Phone */}
              <div>
                <label className="text-sm font-bold text-white">
                  Phone
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className={inputCls}
                />
              </div>

              {/* Address */}
              {fulfillmentType === "delivery" && (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-white">
                      Delivery address
                    </label>
                    <button
                      type="button"
                      onClick={useMyLocation}
                      disabled={locating}
                      className="inline-flex items-center gap-1 text-xs font-bold text-ember-400 transition-colors hover:text-ember-300 disabled:opacity-50"
                    >
                      {locating ? "Locating…" : "Use my location"}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="123 Main St, Apt 4B"
                    className={inputCls}
                  />
                  {dropoffCoords && (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Dropoff pin saved ({dropoffCoords.lat}, {dropoffCoords.lng})
                    </p>
                  )}
                </div>
              )}

              {/* When — PHASE 32 scheduling */}
              <div>
                <label className="text-sm font-bold text-white">
                  When&nbsp;·&nbsp;
                  <span className="font-normal text-white/45">
                    {scheduleLater
                      ? scheduledForValue
                        ? scheduleLabel(scheduledForValue)
                        : "pick a time"
                      : "as soon as possible"}
                  </span>
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleLater(false)}
                    className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      !scheduleLater
                        ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
                        : "border-white/10 text-white/60 hover:bg-white/5"
                    }`}
                  >
                    ASAP
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleLater(true)}
                    className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      scheduleLater
                        ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
                        : "border-white/10 text-white/60 hover:bg-white/5"
                    }`}
                  >
                    Schedule for later
                  </button>
                </div>
                {scheduleLater && (
                  <input
                    type="datetime-local"
                    value={scheduledForValue}
                    onChange={(e) => setScheduledForValue(e.target.value)}
                    min={toLocalInput(new Date(Date.now() + SCHEDULE_BUFFER_MS))}
                    max={toLocalInput(new Date(Date.now() + SCHEDULE_HORIZON_MS))}
                    step={900}
                    className={inputCls}
                  />
                )}
                {scheduleLater && scheduledForValue && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-sky-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                    Scheduled {scheduleLabel(scheduledForValue)} — the rider
                    can&apos;t deliver before this window.
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="text-sm font-bold text-white">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Allergies, special requests..."
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>
            </div>

            {/* Order summary */}
            <div className="card-lift mt-6 rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
              <p className="text-sm font-bold text-white">Order summary</p>
              <div className="mt-3 space-y-1.5 text-sm text-white/60">
                {cart.map((item, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="min-w-0 flex-1 truncate">
                      {item.quantity} × {item.name}
                    </span>
                    <span className="ml-2 shrink-0">
                      {currency(
                        (item.basePrice +
                          item.selectedModifiers.reduce(
                            (s, m) => s + m.priceDelta,
                            0,
                          )) *
                          item.quantity,
                      )}
                    </span>
                  </div>
                ))}
                <div className="border-t border-white/6 pt-1.5">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{currency(pricing.subtotal)}</span>
                  </div>
                  {pricing.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Discount</span>
                      <span>−{currency(pricing.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{currency(pricing.taxAmount)}</span>
                  </div>
                  {fulfillmentType === "delivery" && (
                    <div className="flex justify-between">
                      <span>Delivery</span>
                      <span>{currency(pricing.deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-white/6 pt-1.5 text-base font-bold text-white">
                    <span>Total</span>
                    <span>{currency(pricing.total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {orderError && (
              <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {orderError}
              </p>
            )}

            {pricing.total < restaurant.minOrder && restaurant.minOrder > 0 && (
              <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                Minimum order is {currency(restaurant.minOrder)}. Add{" "}
                {currency(restaurant.minOrder - pricing.total)} more.
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setView("menu")}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
              >
                Back
              </button>
              {paymentMethod === "cash" ? (
                <button
                  type="button"
                  onClick={submitOrder}
                  disabled={submitting}
                  className="flex-1 rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-50"
                >
                  {submitting
                    ? "Placing order..."
                    : scheduleLater
                      ? "Schedule order"
                      : "Place order"}
                </button>
              ) : (
                <div className="flex-1">
                  <RazorpayCheckoutButton
                    restaurant={restaurant.slug}
                    amountInr={pricing.total}
                    customerName={customerName.trim()}
                    customerPhone={customerPhone.trim()}
                    customerAddress={customerAddress.trim()}
                    dropoffLat={
                      fulfillmentType === "delivery"
                        ? dropoffCoords?.lat ?? null
                        : null
                    }
                    dropoffLng={
                      fulfillmentType === "delivery"
                        ? dropoffCoords?.lng ?? null
                        : null
                    }
                    fulfillmentType={fulfillmentType}
                    notes={notes.trim()}
                    scheduledFor={
                      scheduleLater && scheduledForValue
                        ? new Date(scheduledForValue).toISOString()
                        : null
                    }
                    items={cartForPayment}
                    onSuccess={(result) => {
                      if (scheduleLater && scheduledForValue) {
                        setConfirmedScheduled(new Date(scheduledForValue));
                      }
                      confirmOrder(result.reference, result.total);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Recent orders ─── */}
      {view === "menu" && thisRestaurantOrders.length > 0 && (
        <section className="card-lift mb-10 rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-white/40">
            Your orders from {restaurant.name}
          </h2>
          <div className="mt-3 space-y-2">
            {thisRestaurantOrders.map((o) => (
              <a
                key={o.reference}
                href={`/orders/${encodeURIComponent(o.reference)}`}
                className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/5 px-4 py-3 transition-colors hover:border-ember-500/30 hover:bg-ember-500/5"
              >
                <div>
                  <p className="font-mono text-sm font-bold text-white">
                    {o.reference}
                  </p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {new Date(o.placedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-white/80">
                    {currency(o.total)}
                  </span>
                  <span className="rounded-xl bg-ember-500 px-3 py-1.5 text-xs font-bold text-ink-950">
                    Track
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ─── Menu grid ─── */}
      {view === "menu" &&
        categories.map((cat) => (
          <section key={cat.name} className="mb-10">
            <h2 className="sticky top-16 z-10 -mx-4 border-b border-white/6 bg-ink-950/95 px-4 py-3 text-lg font-bold tracking-tight text-white backdrop-blur sm:-mx-6 sm:px-6">
              {cat.name}
            </h2>

            <div className="mt-4 space-y-4">
              {cat.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.available}
                  onClick={() => {
                    setSelectedItem(item);
                    setItemModifiers({});
                    setItemQty(1);
                  }}
                  className={`card-lift flex w-full gap-4 rounded-3xl border border-white/8 bg-ink-850 p-4 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-colors hover:border-white/15 ${
                    !item.available ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">
                        {item.name}
                      </h3>
                      {item.popular && (
                        <span className="shrink-0 rounded-full border border-ember-500/25 bg-ember-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ember-400">
                          Popular
                        </span>
                      )}
                      {item.vegetarian && (
                        <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                          Veg
                        </span>
                      )}
                    </div>

                    {item.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-white/45">
                        {item.description}
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-3">
                      <p className="text-sm font-semibold text-white/90">
                        {currency(item.price)}
                      </p>
                      {item.available && (
                        <span className="rounded-xl bg-ember-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-950">
                          Add
                        </span>
                      )}
                    </div>

                    {!item.available && (
                      <p className="mt-1 text-xs font-medium text-red-400">
                        Currently unavailable
                      </p>
                    )}
                  </div>

                  {item.imageUrl && (
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-white/8 bg-ink-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}