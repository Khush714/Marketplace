"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
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
import { PaymentStage } from "@/components/payment-stage";
import { cn, estimateBill, formatINR, type BillBreakdown } from "@/lib/domain";
import { useCart, cartModifierTotalCents, type CartItem } from "@/lib/cart";
import { useProfileIdentity, useProfileOrders, useProfileReady, type Address } from "@/lib/profile";
import type { PaymentTarget, ProviderMode } from "@/lib/razorpay-checkout";
import { LEGAL, LEGAL_ROUTES } from "@/lib/site-legal";
import { useToast } from "@/lib/toast";
import type { OrderDto } from "@/lib/types";

/**
 * "online" is charged by the provider; "cod" is collected by the rider and
 * never creates a provider order. The instrument for online payments (UPI
 * intent, card, netbanking, wallet) is chosen inside Razorpay's own checkout.
 */
type PayChoice = "online" | "cod";
type PlaceState = "idle" | "loading" | "success" | "error";

interface CartLinePayload {
  menuItemId: number;
  quantity: number;
  priceCents?: number;
  modifiers?: { optionId: number; quantity: number }[];
}

interface PlacedOrder {
  code: string;
  restaurantName: string;
  paid: boolean;
  method: PayChoice;
  trackingToken?: string;
}

/**
 * Cart → wire lines. `priceCents` is a client-held snapshot (the server flags a
 * mismatch as stale rather than trusting it) and each modifier rides its
 * optionId, which is all computeBill needs to re-resolve the real price.
 */
function cartLines(items: CartItem[]): CartLinePayload[] {
  return items.map((i) => ({
    menuItemId: i.menuItemId,
    quantity: i.quantity,
    priceCents: i.priceCents,
    ...(i.modifiers?.length
      ? { modifiers: i.modifiers.map((m) => ({ optionId: m.optionId, quantity: m.quantity })) }
      : {}),
  }));
}

async function postBill(
  restaurantSlug: string,
  items: CartLinePayload[],
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
  // Checkout needs identity, hydration and the order-slot write — and nothing
  // else. Reading the whole profile used to make a favorite tap or a saved
  // search re-render the entire payment form.
  const identity = useProfileIdentity();
  const hydrated = useProfileReady();
  const { rememberOrder } = useProfileOrders();
  const profile = useMemo(
    () => ({ ...identity, hydrated, rememberOrder }),
    [identity, hydrated, rememberOrder],
  );
  const router = useRouter();
  const { toast } = useToast();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [addressText, setAddressText] = useState("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payChoice, setPayChoice] = useState<PayChoice>("online");
  const [instructions, setInstructions] = useState("");
  /**
   * DPDP Act 2023 §5–6 / IT Act §43A: the notice must be given and consent
   * obtained by affirmative action. An unchecked box that merely links the
   * policies is not consent, so this gates order placement rather than sitting
   * beside it.
   */
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [openSummary, setOpenSummary] = useState(false);
  const [placeState, setPlaceState] = useState<PlaceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<BillBreakdown | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  /**
   * The Phase 6 bearer token the order was minted — kept alongside `payTarget`
   * here because `PaymentTarget` is shared with the payment stage and doesn't
   * carry it. It rides onto the placed-order state on every success path.
   */
  const [placedTrackingToken, setPlacedTrackingToken] = useState<string | null>(null);
  // Stable per-checkout-session idempotency key: retried place attempts reuse
  // it so a lost-response retry never creates a duplicate order.
  const [placeRequestId] = useState(() => crypto.randomUUID());

  const totalCents = bill?.totalCents ?? estimateBill(cart.subtotalCents).total;

  // fetch the authoritative bill for the current cart (mirrors createOrder)
  useEffect(() => {
    if (!cart.hydrated || cart.items.length === 0) return;
    let cancelled = false;
    setBillLoading(true);
    postBill(cart.restaurantSlug, cartLines(cart.items)).then((b) => {
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
    if (redirectIn === null || !placed) return;
    if (redirectIn <= 0) {
      router.replace(`/order/${placed.code}/success`);
      return;
    }
    const t = window.setTimeout(() => setRedirectIn((n) => (n === null ? n : n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [redirectIn, placed, router]);

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

  // An online order clears the cart before payment is taken, so an empty cart is
  // NOT the end of checkout — a pending `payTarget` still owes the customer a
  // payment stage. Without this, the empty state returned early and
  // <PaymentStage> below never mounted: Razorpay never opened, no capture
  // webhook arrived, and the order stayed held at PAYMENT_PENDING forever.
  if (cart.items.length === 0 && !placed && !payTarget) {
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
  /** Everything needed to actually submit: contact, address and consent. */
  const detailsComplete =
    name.trim().length > 0 && phoneDigits.length >= 10 && effectiveAddressText.trim().length > 10;
  const canPlace = detailsComplete && acceptedTerms;

  /**
   * Create the order first, then take the money. For online payments the server
   * holds the order at PAYMENT_PENDING and hands back a provider session; the
   * order is only released to the restaurant once the capture is confirmed.
   */
  const placeOrder = async (choice: PayChoice) => {
    if (!canPlace || placeState === "loading") return;
    setPlaceState("loading");
    setError(null);

    let newAddress = selectedAddress;
    if (showAddressForm && addressText.trim().length > 10) {
      newAddress = profile.addAddress(label || "Other", addressText.trim());
    }
    const digits = phoneDigits.slice(-10);
    profile.setIdentity(name.trim(), digits);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantSlug: cart.restaurantSlug,
          clientRequestId: placeRequestId,
          items: cartLines(cart.items),
          addressLabel: newAddress?.label ?? effectiveLabel,
          addressText: newAddress?.text ?? effectiveAddressText,
          customerName: name.trim(),
          phone: digits,
          paymentMethod: choice === "online" ? "upi" : "cod",
          instructions: instructions.trim(),
        }),
      });
      // Safari/WebKit throws a DOMException ("The string did not match the
      // expected pattern") when json() meets a non-JSON body, which hides the
      // real failure behind a validation-looking message. Parse defensively so
      // a non-JSON 500 still reports the status instead of a regex error.
      const raw = await res.text();
      let data: {
        ok?: boolean;
        order?: OrderDto;
        orderToken?: string;
        trackingToken?: string;
        error?: string;
        payment?: {
          reference?: string;
          providerOrderId?: string | null;
          keyId?: string | null;
          amountCents?: number;
          currency?: string;
          mode?: ProviderMode;
          error?: string | null;
        };
      };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          res.ok ? "Unexpected response from server" : `Server error (${res.status})`,
        );
      }
      if (!res.ok || !data.ok || !data.order || !data.orderToken) {
        throw new Error(data.error ?? "Could not place order");
      }

      const code = data.order.code;
      const token = data.orderToken;
      const trackingToken = data.trackingToken ?? null;
      setPlacedTrackingToken(trackingToken);
      profile.rememberOrder(code, token, trackingToken ?? undefined);
      cart.clear();
      toast("Order placed", { sub: `${data.order.restaurantName} · ${code}` });

      if (choice === "cod") {
        setPlaced({ code, restaurantName: data.order.restaurantName, paid: false, method: "cod", trackingToken: trackingToken ?? undefined });
        setPlaceState("success");
        setRedirectIn(10);
        return;
      }

      setPayTarget({
        code,
        token,
        reference: data.payment?.reference ?? "",
        providerOrderId: data.payment?.providerOrderId ?? null,
        keyId: data.payment?.keyId ?? null,
        amountCents: data.payment?.amountCents ?? data.order.totalCents,
        currency: data.payment?.currency ?? "INR",
        mode: data.payment?.mode ?? "unavailable",
        payeeName: data.order.restaurantName || "crave.",
        customerName: name.trim(),
        phone: digits,
      });
    } catch (e) {
      setPlaceState("error");
      setError(e instanceof Error ? e.message : "Something went wrong");
      toast("Order failed", { sub: "Please try again", kind: "error" });
    }
  };

  /** Make sure the authoritative total is in hand before we commit to an order. */
  const startCheckout = async () => {
    if (placeState === "loading") return;
    let target = bill;
    if (!target) {
      target = await postBill(cart.restaurantSlug, cartLines(cart.items));
      if (target) setBill(target);
    }
    void placeOrder(payChoice);
  };

  const markPaid = () => {
    if (!payTarget) return;
    setPayTarget(null);
    setPlaceState("success");
    setPlaced({
      code: payTarget.code,
      restaurantName: payTarget.payeeName,
      paid: true,
      method: "online",
      trackingToken: placedTrackingToken ?? undefined,
    });
    setRedirectIn(10);
  };

  /** Customer closed the provider window: the order exists but is unpaid. */
  const keepUnpaid = () => {
    if (!payTarget) return;
    setPayTarget(null);
    setPlaceState("success");
    setPlaced({ code: payTarget.code, restaurantName: payTarget.payeeName, paid: false, method: "online", trackingToken: placedTrackingToken ?? undefined });
    setRedirectIn(10);
  };

  const goToOrder = () => {
    setRedirectIn(null);
    const code = placed?.code ?? payTarget?.code;
    if (code) router.replace(`/order/${code}/success`);
  };

  /**
   * Leaving a still-confirming payment is navigation only. It must never run
   * `markPaid`: the capture is unproven, so the order keeps its real status and
   * the success page re-reads it from the server.
   */
  const viewUnconfirmedOrder = () => {
    const code = payTarget?.code ?? placed?.code;
    if (code) router.replace(`/order/${code}/success`);
  };

  if (placed) {
    return (
      <PlacedPanel
        placed={placed}
        redirectIn={redirectIn}
        onView={goToOrder}
        onTrack={() =>
          router.replace(
            placed.trackingToken
              ? `/order/track/${placed.trackingToken}`
              : `/order/${placed.code}/track`,
          )
        }
      />
    );
  }

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
            <div className="grid gap-2.5 sm:grid-cols-2">
              {PAY_CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPayChoice(c.id)}
                  className={cn(
                    "press flex items-start gap-3 rounded-2xl border p-4 text-left transition-all duration-200",
                    payChoice === c.id
                      ? "border-ember-400/50 bg-ember-400/8"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-all",
                      payChoice === c.id ? "border-ember-400" : "border-white/25",
                    )}
                  >
                    {payChoice === c.id && (
                      <span className="size-2.5 rounded-full bg-gradient-to-b from-ember-400 to-chili-500" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-cream-50">
                      {c.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-cream-400">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start gap-3">
                <input
                  id="accept-legal"
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="sr-only"
                />
                <label
                  htmlFor="accept-legal"
                  className={cn(
                    "press mt-0.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded-md border-2 transition-colors",
                    acceptedTerms
                      ? "border-ember-400 bg-ember-400 text-void"
                      : "border-white/25 bg-transparent",
                  )}
                >
                  {acceptedTerms ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </label>
                <p className="text-[11px] leading-relaxed text-cream-400">
                  I have read and accept the{" "}
                  <Link
                    href={LEGAL_ROUTES.terms}
                    target="_blank"
                    className="font-semibold text-ember-400 hover:text-ember-300"
                  >
                    Terms &amp; Conditions
                  </Link>
                  , the{" "}
                  <Link
                    href={LEGAL_ROUTES.privacy}
                    target="_blank"
                    className="font-semibold text-ember-400 hover:text-ember-300"
                  >
                    Privacy Policy
                  </Link>{" "}
                  and the{" "}
                  <Link
                    href={LEGAL_ROUTES.refunds}
                    target="_blank"
                    className="font-semibold text-ember-400 hover:text-ember-300"
                  >
                    Cancellation &amp; Refund Policy
                  </Link>
                  , and consent to {LEGAL.brand} collecting my contact and delivery details to
                  fulfil this order.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-500/10 text-mint-400">
                  <ShieldCheck className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-cream-50">
                    {payChoice === "online" ? "Pay securely online" : "Pay cash on delivery"}
                  </p>
                  <p className="truncate text-xs text-cream-500">
                    {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"} · {cart.restaurantName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={!canPlace || billLoading}
                onClick={startCheckout}
                className="press inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-3 text-sm font-bold text-white shadow-glow transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {payChoice === "online" ? "Pay" : "Place order"}{" "}
                {formatINR(totalCents)} <ArrowRight className="size-4" />
              </button>
            </div>
            {payChoice === "online" && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-cream-500">
                UPI, cards, netbanking and wallets are offered on the secure payment page. The
                restaurant only receives your order once the payment is confirmed.
              </p>
            )}
            {!detailsComplete && (
              <p className="mt-2.5 text-xs text-chili-300">
                Add a delivery address, name &amp; 10-digit phone to continue
              </p>
            )}
            {detailsComplete && !acceptedTerms && (
              <p className="mt-2.5 text-xs text-chili-300">
                Please accept the Terms &amp; Privacy Policy to continue
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
                  <li key={i.lineKey} className="flex items-start gap-3">
                    <span className="relative size-11 shrink-0 overflow-hidden rounded-xl">
                      <Image src={i.imageUrl} alt="" fill sizes="44px" className="object-cover" placeholder="blur" blurDataURL={BLUR_DATA} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <VegDot veg={i.isVeg} className="size-3" />
                        <span className="truncate text-[13px] font-medium text-cream-200">{i.name}</span>
                      </span>
                      {i.modifiers?.length ? (
                        <span className="mt-0.5 block text-[11px] leading-snug text-cream-500">
                          {i.modifiers
                            .map((m) => `${m.quantity > 1 ? `${m.quantity}× ` : ""}${m.name}`)
                            .join(", ")}
                        </span>
                      ) : null}
                      <span className="text-xs text-cream-500">× {i.quantity}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-cream-50 tabular-nums">
                      {formatINR(i.priceCents * i.quantity + cartModifierTotalCents(i))}
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
            onClick={startCheckout}
            className="mt-4 hidden lg:flex"
          />
          {!detailsComplete && (
            <p className="mt-2 hidden text-center text-xs text-cream-500 lg:block">
              Add a delivery address, name &amp; 10-digit phone to continue
            </p>
          )}
          {detailsComplete && !acceptedTerms && (
            <p className="mt-2 hidden text-center text-xs text-cream-500 lg:block">
              Accept the Terms &amp; Privacy Policy to continue
            </p>
          )}
          {error && <p className="mt-3 text-center text-sm text-chili-300">{error}</p>}
        </aside>
      </div>

      {/* mobile sticky place order */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-void/85 p-4 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <PlaceOrderButton
          state={placeState}
          disabled={!canPlace}
          busy={billLoading}
          totalCents={totalCents}
          label={payChoice === "online" ? "Pay" : "Place order"}
          onClick={startCheckout}
        />
      </div>

      {payTarget && (
        <PaymentStage
          target={payTarget}
          onPaid={markPaid}
          onViewOrder={viewUnconfirmedOrder}
          onAbandon={keepUnpaid}
          onClose={keepUnpaid}
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
          {cart.items
            .map((i) => {
              const extras = i.modifiers?.length ? ` (${i.modifiers.map((m) => m.name).join(", ")})` : "";
              return `${i.quantity}× ${i.name}${extras}`;
            })
            .join(", ")}
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
  label = "Pay",
  onClick,
  className,
}: {
  state: PlaceState;
  disabled: boolean;
  busy?: boolean;
  totalCents: number;
  label?: string;
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
          {label} {formatINR(totalCents)}
          <ArrowRight className="size-4.5" />
        </>
      )}
    </button>
  );
}

const PAY_CHOICES: { id: PayChoice; label: string; hint: string }[] = [
  {
    id: "online",
    label: "Pay online",
    hint: "UPI, card, netbanking or wallet on a secure page. Kitchen starts once it clears.",
  },
  {
    id: "cod",
    label: "Cash on delivery",
    hint: "Pay the rider in cash when the order arrives.",
  },
];

/**
 * Post-order confirmation. The copy states exactly what is true: a COD order is
 * with the restaurant and the rider collects the money; an online order says so
 * only when the server confirmed the capture. An unpaid online order is labelled
 * as such and links straight back to the payment step.
 */
function PlacedPanel({
  placed,
  redirectIn,
  onView,
  onTrack,
}: {
  placed: PlacedOrder;
  redirectIn: number | null;
  onView: () => void;
  onTrack: () => void;
}) {
  const unpaidOnline = placed.method === "online" && !placed.paid;

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center px-4 py-12 text-center">
      <span
        className={cn(
          "grid size-16 place-items-center rounded-full",
          placed.paid ? "bg-mint-500/15 text-mint-400" : "bg-ember-400/12 text-ember-300",
        )}
      >
        {placed.paid ? <Check className="size-7" strokeWidth={3} /> : <Banknote className="size-7" />}
      </span>

      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-cream-50">
        {placed.paid ? "Payment received" : unpaidOnline ? "Order saved, payment pending" : "Order placed"}
      </h1>
      <p className="mt-2 text-sm text-cream-500">
        <span className="font-semibold text-cream-200">{placed.restaurantName}</span> ·{" "}
        <span className="font-mono">{placed.code}</span>
      </p>

      <p className="mt-4 max-w-sm text-sm leading-relaxed text-cream-400">
        {placed.paid
          ? "We've sent your order to the kitchen. Track it live as it gets prepared."
          : unpaidOnline
            ? "We haven't taken any money yet. Complete the payment from your order page to release your order to the restaurant."
            : "The kitchen is preparing your order. Keep the exact amount ready for the rider."}
      </p>

      <div className="mt-7 flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={onView}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-4 text-sm font-bold text-white shadow-glow transition-opacity hover:opacity-95"
        >
          {unpaidOnline ? "Complete payment" : "Track order"} <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={onTrack}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 py-3.5 text-sm font-semibold text-cream-300 transition-colors hover:border-white/25 hover:text-cream-50"
        >
          View order details
        </button>
      </div>

      {redirectIn !== null && redirectIn > 0 && (
        <p className="mt-5 text-xs text-cream-600">Opening your order in {redirectIn}s…</p>
      )}
    </div>
  );
}
