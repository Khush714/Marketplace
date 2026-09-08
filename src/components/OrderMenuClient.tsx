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
  const [fulfillmentType, setFulfillmentType] = useState<
    "delivery" | "pickup"
  >("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<number | null>(null);

  // PHASE — recent orders persisted to localStorage so history survives
  // navigating away and back to this page (state alone is lost on remount).
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);

  useEffect(() => {
    setRecentOrders(readRecentOrders());
  }, []);

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
    setCartOpen(true);
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

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant: restaurant.slug,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: customerAddress.trim(),
          fulfillmentType,
          paymentMethod,
          notes: notes.trim(),
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
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">
          ✓
        </div>
        <h2 className="text-xl font-bold text-slate-900">Order placed!</h2>
        <p className="mt-2 text-sm text-slate-500">
          Your order reference is{" "}
          <span className="font-mono font-bold text-slate-900">{orderRef}</span>
        </p>
        {orderTotal !== null && (
          <p className="mt-1 text-sm text-slate-500">
            Total: {currency(orderTotal)}
          </p>
        )}
        <a
          href={`/orders/${orderRef}`}
          className="mt-6 rounded-xl bg-orange-500 px-6 py-3 text-sm font-bold text-white hover:bg-orange-600"
        >
          Track order
        </a>
        <button
          type="button"
          onClick={() => {
            setView("menu");
            setOrderRef(null);
            setOrderTotal(null);
          }}
          className="mt-3 text-sm font-semibold text-slate-500 hover:text-slate-700"
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
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-2xl bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg hover:bg-orange-600"
        >
          View cart ({cartCount}) — {currency(pricing.total)}
        </button>
      )}

      {/* ─── Item detail drawer ─── */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedItem.name}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedItem.description}
                </p>
                <p className="mt-2 font-semibold text-slate-900">
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
                className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            {selectedItem.modifierGroups.map((group) => (
              <div key={group.id} className="mt-5">
                <p className="text-sm font-bold text-slate-900">
                  {group.name}
                  {group.minSelect > 0 && (
                    <span className="ml-1 text-xs font-normal text-slate-400">
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
                          className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                            checked
                              ? "border-orange-400 bg-orange-50"
                              : "border-slate-200 bg-white hover:bg-slate-50"
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
                              className="h-4 w-4 accent-orange-500"
                            />
                            <span className="text-slate-700">{mod.name}</span>
                          </div>
                          {mod.priceDelta !== 0 && (
                            <span className="text-xs text-slate-400">
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

            <div className="mt-6 flex items-center gap-4">
              <div className="flex items-center rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setItemQty((q) => Math.max(1, q - 1))}
                  className="grid h-10 w-10 place-items-center text-lg font-bold text-slate-500 hover:bg-slate-50"
                >
                  −
                </button>
                <span className="w-10 text-center text-sm font-bold text-slate-900">
                  {itemQty}
                </span>
                <button
                  type="button"
                  onClick={() => setItemQty((q) => q + 1)}
                  className="grid h-10 w-10 place-items-center text-lg font-bold text-slate-500 hover:bg-slate-50"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={addToCart}
                className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600"
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-900">Your cart</h3>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 py-12 text-center text-sm text-slate-400">
                Your cart is empty
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {cart.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between border-b border-slate-50 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {item.name}
                        </p>
                        {item.selectedModifiers.length > 0 && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            {item.selectedModifiers
                              .map((m) => m.modifierName)
                              .join(", ")}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateCartQty(i, -1)}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-xs font-bold text-slate-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(i, 1)}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCartItem(i)}
                            className="ml-2 text-xs text-red-400 hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <p className="ml-4 text-sm font-semibold text-slate-900">
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

                <div className="border-t border-slate-100 px-6 py-4">
                  <div className="space-y-1 text-sm text-slate-600">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{currency(pricing.subtotal)}</span>
                    </div>
                    {pricing.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-600">
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
                    <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-bold text-slate-900">
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
                    className="mt-4 w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600"
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
          <div className="mx-auto max-w-lg px-6 py-8">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setView("menu")}
                className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                ←
              </button>
              <h2 className="text-lg font-bold text-slate-900">Checkout</h2>
            </div>

            <div className="mt-6 space-y-4">
              {/* Fulfillment */}
              <div>
                <label className="text-sm font-bold text-slate-900">
                  Order type
                </label>
                <div className="mt-2 flex gap-2">
                  {restaurant.accepts.delivery && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType("delivery")}
                      className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                        fulfillmentType === "delivery"
                          ? "border-orange-400 bg-orange-50 text-orange-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Delivery
                    </button>
                  )}
                  {restaurant.accepts.pickup && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType("pickup")}
                      className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                        fulfillmentType === "pickup"
                          ? "border-orange-400 bg-orange-50 text-orange-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Pickup
                    </button>
                  )}
                </div>
              </div>

              {/* Payment */}
              <div>
                <label className="text-sm font-bold text-slate-900">
                  Payment
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("cash")}
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                      paymentMethod === "cash"
                        ? "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("card")}
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                      paymentMethod === "card"
                        ? "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Pay online
                  </button>
                </div>
                {paymentMethod === "card" && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    Cards, UPI, netbanking & wallets via Razorpay.
                  </p>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="text-sm font-bold text-slate-900">
                  Your name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Jane Smith"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="text-sm font-bold text-slate-900">
                  Phone
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {/* Address */}
              {fulfillmentType === "delivery" && (
                <div>
                  <label className="text-sm font-bold text-slate-900">
                    Delivery address
                  </label>
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="123 Main St, Apt 4B"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-sm font-bold text-slate-900">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Allergies, special requests..."
                  rows={2}
                  className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
            </div>

            {/* Order summary */}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-900">Order summary</p>
              <div className="mt-3 space-y-1.5 text-sm text-slate-600">
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
                <div className="border-t border-slate-200 pt-1.5">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{currency(pricing.subtotal)}</span>
                  </div>
                  {pricing.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600">
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
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
                    <span>Total</span>
                    <span>{currency(pricing.total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {orderError && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                {orderError}
              </p>
            )}

            {pricing.total < restaurant.minOrder && restaurant.minOrder > 0 && (
              <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Minimum order is {currency(restaurant.minOrder)}. Add{" "}
                {currency(restaurant.minOrder - pricing.total)} more.
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setView("menu")}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Back
              </button>
              {paymentMethod === "cash" ? (
                <button
                  type="button"
                  onClick={submitOrder}
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {submitting ? "Placing order..." : "Place order"}
                </button>
              ) : (
                <div className="flex-1">
                  <RazorpayCheckoutButton
                    restaurant={restaurant.slug}
                    amountInr={pricing.total}
                    customerName={customerName.trim()}
                    customerPhone={customerPhone.trim()}
                    customerAddress={customerAddress.trim()}
                    fulfillmentType={fulfillmentType}
                    notes={notes.trim()}
                    items={cartForPayment}
                    onSuccess={(result) =>
                      confirmOrder(result.reference, result.total)
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Recent orders ─── */}
      {view === "menu" && thisRestaurantOrders.length > 0 && (
        <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
            Your orders from {restaurant.name}
          </h2>
          <div className="mt-3 space-y-2">
            {thisRestaurantOrders.map((o) => (
              <a
                key={o.reference}
                href={`/orders/${encodeURIComponent(o.reference)}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 transition hover:border-orange-200 hover:bg-orange-50"
              >
                <div>
                  <p className="font-mono text-sm font-bold text-slate-900">
                    {o.reference}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {new Date(o.placedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-700">
                    {currency(o.total)}
                  </span>
                  <span className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white">
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
            <h2 className="sticky top-0 z-10 -mx-4 border-b border-slate-100 bg-white/95 px-4 py-3 text-lg font-bold tracking-tight text-slate-900 backdrop-blur sm:-mx-6 sm:px-6">
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
                  className={`flex w-full gap-4 rounded-xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:shadow-md ${
                    !item.available ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">
                        {item.name}
                      </h3>
                      {item.popular && (
                        <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
                          Popular
                        </span>
                      )}
                      {item.vegetarian && (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-600">
                          Veg
                        </span>
                      )}
                    </div>

                    {item.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                        {item.description}
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {currency(item.price)}
                      </p>
                      {item.available && (
                        <span className="rounded-lg bg-orange-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
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
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
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
