"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  House,
  LoaderCircle,
  MapPin,
  NotebookPen,
  Plus,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { BLUR_DATA, VegDot } from "@/components/atoms";
import { AnimatedPrice } from "@/components/motion-primitives";
import { PaymentStage, type SettleResult } from "@/components/payment-stage";
import { cn, estimateBill, formatINR, type BillBreakdown } from "@/lib/domain";
import { useCart } from "@/lib/cart";
import { useProfile, type Address } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { OrderDto } from "@/lib/types";
import type { OrderLine } from "@/payment/lib/checkout";

type PayMethod = "upi" | "card" | "cod";
type PlaceState = "idle" | "loading" | "success" | "error";

async function postBill(
  restaurantSlug: string,
  items: { menuItemId: number; quantity: number }[],
): Promise<BillBreakdown | null> {
  try {
    const res = await fetch("/api/orders/bill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantSlug, items }),
    });
    const data = (await res.json()) as { ok?: boolean; bill?: BillBreakdown };
    return res.ok && data.ok && data.bill ? data.bill : null;
  } catch {
    return null;
  }
}

export default function CheckoutPage() {
  const cart = useCart();
  const profile = useProfile();
  const router = useRouter();
  const { toast } = useToast();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [addressText, setAddressText] = useState("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [openSummary, setOpenSummary] = useState(false);
  const [placeState, setPlaceState] = useState<PlaceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<BillBreakdown | null>(null);
  const [paidBill, setPaidBill] = useState<BillBreakdown | null>(null);
  const [placedCode, setPlacedCode] = useState<string | null>(null);
  const [redirectIn, setRedirectIn] = useState<number | null>(null);

  const totalCents = bill?.totalCents ?? estimateBill(cart.subtotalCents).total;

  const payLines = useMemo<OrderLine[]>(() => {
    const b = paidBill ?? bill;
    const itemLines = cart.items.map((i) => ({
      label: `${i.quantity}× ${i.name}`,
      value: Math.round((i.priceCents * i.quantity) / 100),
    }));
    if (!b) {
      const itemRupees = itemLines.reduce((sum, l) => sum + l.value, 0);
      const totalRupees = Math.round(estimateBill(cart.subtotalCents).total / 100);
      if (totalRupees > itemRupees) {
        itemLines.push({ label: "Delivery & fees", value: totalRupees - itemRupees });
      }
      return itemLines;
    }
    if (b.discountCents > 0) {
      itemLines.push({ label: "Restaurant discount", value: -Math.round(b.discountCents / 100) });
    }
    const feesRupees = Math.round((b.deliveryFeeCents + b.platformFeeCents) / 100);
    if (feesRupees > 0) {
      itemLines.push({ label: "Delivery & fees", value: feesRupees });
    }
    const totalRupees = Math.round(b.totalCents / 100);
    const sum = itemLines.reduce((acc, l) => acc + l.value, 0);
    if (sum !== totalRupees) {
      itemLines.push({ label: "Rounding", value: totalRupees - sum });
    }
    return itemLines;
  }, [cart.items, cart.subtotalCents, bill, paidBill]);

  // fetch the authoritative bill for the current cart (mirrors createOrder)
  useEffect(() => {
    if (!cart.hydrated || cart.items.length === 0) return;
    let cancelled = false;
    setBillLoading(true);
    postBill(
      cart.restaurantSlug,
      cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
    ).then((b) => {
      if (cancelled) return;
      setBill(b);
      setBillLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cart.hydrated, cart.restaurantSlug, cart.items]);

  // 10s grace on the success screen before auto-navigating to the order
  useEffect(() => {
    if (redirectIn === null || !placedCode) return;
    if (redirectIn <= 0) {
      router.replace(`/order/${placedCode}/success`);
      return;
    }
    const t = window.setTimeout(() => setRedirectIn((n) => (n === null ? n : n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [redirectIn, placedCode, router]);

  // prefill from profile after hydration
  useEffect(() => {
    if (!profile.hydrated) return;
    setName((n) => n || profile.name);
    setPhone((p) => p || profile.phone);
    setAddressId((a) => a ?? profile.addresses[0]?.id ?? null);
  }, [profile.hydrated, profile.name, profile.phone, profile.addresses]);

  if (!cart.hydrated || !profile.hydrated) {
    return (
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-8 md:px-6">
        <div className="skeleton h-8 w-52" />
        <div className="mt-8 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-32 rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  if (cart.items.length === 0 && placeState !== "success") {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-14 text-center md:px-6">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/6 text-cream-400">
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-cream-50">Nothing to check out yet</h1>
        <p className="mt-1.5 text-sm text-cream-500">Your cart is empty — add a dish or two first.</p>
        <Link
          href="/restaurants"
          className="press mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
        >
          Browse restaurants <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  const selectedAddress: Address | null =
    (showAddressForm ? null : profile.addresses.find((a) => a.id === addressId)) ?? null;
  const effectiveAddressText = showAddressForm ? addressText : selectedAddress?.text ?? "";
  const effectiveLabel = showAddressForm ? label || "Other" : selectedAddress?.label ?? "Home";
  const phoneDigits = phone.replace(/\D/g, "");
  const canPlace =
    name.trim().length > 0 && phoneDigits.length >= 10 && effectiveAddressText.trim().length > 10;

  const placeOrder = async (channel: PayMethod) => {
    if (!canPlace || placeState === "loading") return;
    setPlaceState("loading");
    setError(null);

    let newAddress = selectedAddress;
    if (showAddressForm && addressText.trim().length > 10) {
      newAddress = profile.addAddress(label || "Other", addressText.trim());
    }
    profile.setIdentity(name.trim(), phoneDigits.slice(-10));

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantSlug: cart.restaurantSlug,
          items: cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
          addressLabel: newAddress?.label ?? effectiveLabel,
          addressText: newAddress?.text ?? effectiveAddressText,
          customerName: name.trim(),
          phone: phoneDigits.slice(-10),
          paymentMethod: channel,
          instructions: instructions.trim(),
        }),
      });
      const data = (await res.json()) as { ok: boolean; order?: OrderDto; error?: string };
      if (!res.ok || !data.ok || !data.order) {
        throw new Error(data.error ?? "Could not place order");
      }
      setPlaceState("success");
      profile.rememberOrder(data.order.code);
      cart.clear();
      setPlacedCode(data.order.code);
      setRedirectIn(10);
      toast("Order placed", { sub: `${data.order.restaurantName} · ${data.order.code}` });
    } catch (e) {
      setPlaceState("error");
      setError(e instanceof Error ? e.message : "Something went wrong");
      toast("Order failed", { sub: "Please try again", kind: "error" });
    }
  };

  const openStage = async () => {
    if (placeState === "loading") return;
    let target = bill;
    if (!target) {
      target = await postBill(
        cart.restaurantSlug,
        cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      );
      if (target) setBill(target);
    }
    setPaidBill(target);
    setPayOpen(true);
  };

  const handleClose = () => {
    if (placedCode) {
      setRedirectIn(null);
      router.replace(`/order/${placedCode}/success`);
    } else {
      setPayOpen(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-36 pt-6 md:px-6 md:pb-12 md:pt-9">
      <Link href="/cart" className="press inline-flex items-center gap-1.5 text-sm font-medium text-cream-400 transition-colors hover:text-cream-50">
        <ArrowLeft className="size-4" /> Back to cart
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Checkout</h1>
      <p className="mt-1 text-sm text-cream-500">
        From <span className="font-semibold text-cream-300">{cart.restaurantName}</span> · arrives in ~30 min
      </p>

      <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          {/* ------------------------------ address ------------------------------ */}
          <Section step={1} title="Delivery address" Icon={MapPin}>
            <div className="space-y-2.5">
              {profile.addresses.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    "press flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all duration-200",
                    !showAddressForm && addressId === a.id
                      ? "border-ember-400/50 bg-ember-400/8"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  )}
                >
                  <input
                    type="radio"
                    name="address"
                    className="sr-only"
                    checked={!showAddressForm && addressId === a.id}
                    onChange={() => {
                      setAddressId(a.id);
                      setShowAddressForm(false);
                    }}
                  />
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-all",
                      !showAddressForm && addressId === a.id ? "border-ember-400" : "border-white/25",
                    )}
                  >
                    {!showAddressForm && addressId === a.id && <span className="size-2.5 rounded-full bg-gradient-to-b from-ember-400 to-chili-500" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-cream-50">
                      <House className="size-3.5 text-cream-400" /> {a.label}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-cream-400">{a.text}</span>
                  </span>
                </label>
              ))}

              {showAddressForm ? (
                <div className="animate-fade-in space-y-2.5 rounded-2xl border border-ember-400/40 bg-ember-400/6 p-4">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Label — Home, Work, Gym…"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
                  />
                  <textarea
                    value={addressText}
                    onChange={(e) => setAddressText(e.target.value)}
                    placeholder="Flat, street, landmark, city, pincode"
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
                  />
                  <button type="button" onClick={() => setShowAddressForm(false)} className="press text-xs font-semibold text-cream-400 hover:text-cream-200">
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddressForm(true)}
                  className="press flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 py-3 text-sm font-semibold text-cream-300 transition-colors hover:border-ember-400/40 hover:text-ember-300"
                >
                  <Plus className="size-4" /> Add new address
                </button>
              )}
            </div>
          </Section>

          {/* ------------------------------ contact ------------------------------ */}
          <Section step={2} title="Contact details" Icon={Smartphone}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ""))}
                placeholder="10-digit mobile"
                inputMode="tel"
                autoComplete="tel"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
              />
            </div>
            {phone.length > 0 && phoneDigits.length < 10 && (
              <p className="mt-2 text-xs text-chili-300">Enter a 10-digit mobile number</p>
            )}
          </Section>

          {/* ------------------------------ payment ------------------------------ */}
          <Section step={3} title="Payment" Icon={CreditCard}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
                  <ShieldCheck className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-cream-50">Secure express checkout</p>
                  <p className="truncate text-xs text-cream-500">
                    UPI · Card · Cash on delivery — {cart.itemCount} item
                    {cart.itemCount === 1 ? "" : "s"} · {cart.restaurantName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={!canPlace || billLoading}
                onClick={openStage}
                className="press inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-3 text-sm font-bold text-white shadow-glow transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Pay {formatINR(totalCents)} <ArrowRight className="size-4" />
              </button>
            </div>
            {!canPlace && (
              <p className="mt-2.5 text-xs text-chili-300">
                Add a delivery address, name & 10-digit phone to continue
              </p>
            )}
          </Section>

          {/* --------------------------- instructions --------------------------- */}
          <Section step={4} title="Anything we should know?" Icon={NotebookPen} optional>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Extra spicy, ring the bell twice, no cutlery"
              rows={2}
              className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
            />
          </Section>
        </div>

        {/* ------------------------------ summary ------------------------------ */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <CheckoutSummary
            open={openSummary}
            onToggle={() => setOpenSummary((o) => !o)}
            totalCents={totalCents}
            itemsNode={
              <ul className="space-y-3">
                {cart.items.map((i) => (
                  <li key={i.menuItemId} className="flex items-center gap-3">
                    <span className="relative size-11 shrink-0 overflow-hidden rounded-xl">
                      <Image src={i.imageUrl} alt="" fill sizes="44px" className="object-cover" placeholder="blur" blurDataURL={BLUR_DATA} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <VegDot veg={i.isVeg} className="size-3" />
                        <span className="truncate text-[13px] font-medium text-cream-200">{i.name}</span>
                      </span>
                      <span className="text-xs text-cream-500">× {i.quantity}</span>
                    </span>
                    <span className="text-[13px] font-semibold text-cream-50 tabular-nums">
                      {formatINR(i.priceCents * i.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            }
          />
          <PlaceOrderButton
            state={placeState}
            disabled={!canPlace}
            busy={billLoading}
            totalCents={totalCents}
            onClick={openStage}
            className="mt-4 hidden lg:flex"
          />
          {!canPlace && (
            <p className="mt-2 hidden text-center text-xs text-cream-500 lg:block">
              Add a delivery address, name & 10-digit phone to continue
            </p>
          )}
          {error && <p className="mt-3 text-center text-sm text-chili-300">{error}</p>}
        </aside>
      </div>

      {/* mobile sticky place order */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-void/85 p-4 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <PlaceOrderButton state={placeState} disabled={!canPlace} busy={billLoading} totalCents={totalCents} onClick={openStage} />
      </div>

      {payOpen && (
        <PaymentStage
          amountCents={(paidBill ?? bill)?.totalCents ?? estimateBill(cart.subtotalCents).total}
          payee={cart.restaurantName || "CODEXR"}
          lines={payLines}
          redirect={redirectIn !== null && placedCode ? { code: placedCode, in: redirectIn } : null}
          onViewOrder={() => {
            setRedirectIn(null);
            if (placedCode) router.replace(`/order/${placedCode}/success`);
          }}
          onSettled={(r: SettleResult) => {
            if (r.phase === "success") placeOrder(r.channel === "cash" ? "cod" : r.channel);
          }}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

/* ------------------------------ pieces ------------------------------ */

function Section({
  step,
  title,
  Icon,
  optional,
  children,
}: {
  step: number;
  title: string;
  Icon: typeof MapPin;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="glass rounded-3xl p-5 md:p-6">
      <h2 className="mb-4 flex items-center gap-2.5 font-display text-base font-bold text-cream-50">
        <span className="grid size-7 place-items-center rounded-lg bg-white/8 text-xs font-bold text-ember-300 tabular-nums">
          {step}
        </span>
        <Icon className="size-4 text-cream-400" />
        {title}
        {optional && <span className="text-xs font-medium text-cream-600">(optional)</span>}
      </h2>
      {children}
    </section>
  );
}

function CheckoutSummary({
  open,
  onToggle,
  totalCents,
  itemsNode,
}: {
  open: boolean;
  onToggle: () => void;
  totalCents: number;
  itemsNode: ReactNode;
}) {
  const cart = useCart();
  return (
    <div className="glass rounded-3xl p-5">
      <button type="button" onClick={onToggle} className="press flex w-full items-center justify-between">
        <h2 className="font-display text-base font-bold text-cream-50">
          Order summary
          <span className="ml-2 text-xs font-medium text-cream-500">{cart.itemCount} items</span>
        </h2>
        <ChevronDown className={cn("size-4 text-cream-400 transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div className={cn("grid transition-all duration-300 ease-out", open ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">{itemsNode}</div>
      </div>
      {!open && (
        <p className="mt-3 animate-fade-in truncate text-[13px] text-cream-500">
          {cart.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-cream-500">Total</span>
        <AnimatedPrice cents={totalCents} className="font-display text-lg font-bold text-cream-50" />
      </div>
    </div>
  );
}

function PlaceOrderButton({
  state,
  disabled,
  busy,
  totalCents,
  onClick,
  className,
}: {
  state: PlaceState;
  disabled: boolean;
  busy?: boolean;
  totalCents: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled || state === "loading" || state === "success" || busy}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-bold transition-all duration-200 press",
        state === "success"
          ? "bg-mint-500 text-emerald-950"
          : state === "error"
            ? "bg-chili-600 text-white"
            : "bg-gradient-to-b from-ember-400 to-chili-600 text-white shadow-glow hover:shadow-[0_16px_52px_-8px_rgba(255,90,60,0.65)]",
        disabled && state === "idle" && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {state === "loading" ? (
        <>
          <LoaderCircle className="size-4.5 animate-spin-slow" /> Placing your order…
        </>
      ) : state === "success" ? (
        <>
          <Check className="size-5" strokeWidth={3} /> Order placed
        </>
      ) : state === "error" ? (
        "Try again"
      ) : busy ? (
        <>
          <LoaderCircle className="size-4.5 animate-spin-slow" /> Computing total…
        </>
      ) : (
        <>
          Pay {formatINR(totalCents)}
          <ArrowRight className="size-4.5" />
        </>
      )}
    </button>
  );
}
