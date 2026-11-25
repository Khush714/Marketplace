"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  Briefcase,
  Banknote,
  CalendarClock,
  Check,
  ChevronDown,
  CreditCard,
  Heart,
  House,
  LoaderCircle,
  MapPin,
  NotebookPen,
  Plus,
  ShieldCheck,
  Smartphone,
  Tag,
  TriangleAlert,
  Truck,
  X,
} from "lucide-react";
import { AddressPicker } from "@/components/address-picker";
import { BLUR_DATA, VegDot } from "@/components/atoms";
import { ensureInboxToken } from "@/lib/customer-notification-copy";
import {
  addressForOrder,
  addressSummary,
  loadSelectedAddressId,
  persistSelectedAddressId,
  type Address,
  type MapPoint,
} from "@/lib/delivery-address";
import { AnimatedPrice } from "@/components/motion-primitives";
import { CustomerAuthDialog } from "@/components/customer-auth-dialog";
import { PaymentStage } from "@/components/payment-stage";
import {
  MAX_SCHEDULE_DAYS,
  MAX_TIP_CENTS,
  MIN_SCHEDULE_LEAD_MS,
  parseScheduledFor,
  parseTipCents,
} from "@/lib/checkout-extras-core";
import { cn, estimateBill, formatDateTime, formatINR, localityNear, type BillBreakdown } from "@/lib/domain";
import { parseOfferCode, type PublicMerchantOffer } from "@/lib/merchant-offer";
import { useCart, cartModifierTotalCents, type CartItem } from "@/lib/cart";
import {
  checkoutBillKey,
  checkoutContactComplete,
  checkoutIssue,
  checkoutIssueMessage,
  checkoutPhoneDigits,
  previewForSelection,
  type CheckoutBillLine,
} from "@/lib/checkout-form-core";
import { useMenuAvailability } from "@/lib/menu-availability";
import { availableCartSubtotalCents, cartItemIsSoldOut } from "@/lib/menu-availability-core";
import { useCustomerAccount } from "@/lib/customer-account";
import { useLocation } from "@/lib/location";
import { useProfileIdentity, useProfileOrders, useProfileReady } from "@/lib/profile";
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
type AddressPickerMode = "list" | "location";

type CartLinePayload = CheckoutBillLine;

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

/**
 * The locality picker persists its choice in the URL and in localStorage. The
 * server rechecks it against the restaurant's served locality; this only needs
 * to forward the customer's current selection, never a price or a decision.
 */
function currentLocalityKey(): string | undefined {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("loc");
    if (fromUrl) return fromUrl;
    const raw = localStorage.getItem("crave.location.v1");
    const parsed = raw ? (JSON.parse(raw) as { key?: unknown }) : null;
    return typeof parsed?.key === "string" ? parsed.key : undefined;
  } catch {
    return undefined;
  }
}

/** Coordinates attached to a structured picker address, if it has a pin. */
function pointFromAddress(address: Address | null): MapPoint | undefined {
  if (
    !address ||
    typeof address.latitude !== "number" ||
    typeof address.longitude !== "number"
  ) {
    return undefined;
  }
  return { latitude: address.latitude, longitude: address.longitude };
}

function localityKeyForPoint(point: MapPoint): string | undefined {
  const match = localityNear(point.latitude, point.longitude);
  return match.served ? match.locality.key : undefined;
}

interface DroppedCartItem {
  menuItemId: number;
  name: string;
  reason: string;
}

interface BillPreview {
  ok?: boolean;
  bill?: BillBreakdown;
  dropped?: DroppedCartItem[];
  offer?: string | null;
  offerAvailable?: boolean;
  promo?: PublicMerchantOffer | null;
  promoCode?: string | null;
  error?: string;
  code?: string;
}

interface BillPreviewState {
  /** The exact cart + offer selection this preview was requested for. */
  key: string;
  preview: BillPreview | null;
  promoError: string | null;
  billError: string | null;
}

/**
 * The bill route answers with structured errors (an expired code, a code that
 * belongs to another kitchen, …). Returning the full body rather than collapsing
 * a refusal to `null` is what lets the offer picker explain why a selection did
 * not take instead of silently charging the undiscounted total.
 */
const PROMO_ERROR_CODES = new Set([
  "INVALID_PROMO_CODE",
  "PROMO_NOT_FOUND",
  "OFFER_UNAVAILABLE",
  "OFFER_NOT_STARTED",
  "OFFER_ENDED",
  "OFFER_EXHAUSTED",
  "MIN_ORDER_NOT_MET",
]);

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduleInputToIso(raw: string): string {
  if (!raw) return "";
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : raw;
}

export default function CheckoutPage() {
  const cart = useCart();
  const availability = useMenuAvailability(cart.restaurantSlug);
  // Checkout needs identity, hydration and the order-slot write — and nothing
  // else. Reading the whole profile used to make a favorite tap or a saved
  // search re-render the entire payment form.
  const identity = useProfileIdentity();
  const hydrated = useProfileReady();
  const { rememberOrder } = useProfileOrders();
  const accountAuth = useCustomerAccount();
  const profile = useMemo(
    () => ({ ...identity, hydrated, rememberOrder }),
    [identity, hydrated, rememberOrder],
  );
  const router = useRouter();
  const { toast } = useToast();
  const { setLocality } = useLocation();
  const [accountAddresses, setAccountAddresses] = useState<Address[]>([]);
  const [accountAddressesLoaded, setAccountAddressesLoaded] = useState(false);

  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [addressPickerMode, setAddressPickerMode] = useState<AddressPickerMode>("list");
  /** Pinned locality used when the URL has not caught up with the router replace yet. */
  const [deliveryLocalityKey, setDeliveryLocalityKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payChoice, setPayChoice] = useState<PayChoice>("online");
  const [instructions, setInstructions] = useState("");
  /** -1 means the bounded custom tip input; presets store paise directly. */
  const [tipChoice, setTipChoice] = useState(0);
  const [customTipRupees, setCustomTipRupees] = useState("");
  const [scheduleInput, setScheduleInput] = useState("");
  /**
   * DPDP Act 2023 §5–6 / IT Act §43A: the notice must be given and consent
   * obtained by affirmative action. An unchecked box that merely links the
   * policies is not consent, so this gates order placement rather than sitting
   * beside it.
   */
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [openSummary, setOpenSummary] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [placeState, setPlaceState] = useState<PlaceState>("idle");
  const [error, setError] = useState<string | null>(null);
  /**
   * One preview, tagged with the exact selection it prices. All displayed bill
   * fields are derived from the entry matching the current selection, so a slow
   * reply to an older offer choice can never overwrite the visible total.
   */
  const [billState, setBillState] = useState<BillPreviewState | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  /** Offers are opt-in by default — a customer must tick the box to use one. */
  const [applyOffer, setApplyOffer] = useState(false);
  /** Merchant App promotions for this listing, published by the kitchen. */
  const [merchantOffers, setMerchantOffers] = useState<PublicMerchantOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoInput, setPromoInput] = useState("");
  /** A malformed typed code fails before a request; server refusals live in billState. */
  const [promoInputError, setPromoInputError] = useState<string | null>(null);
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
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  // The persisted address id is applied once, after account addresses have had
  // a chance to load, so a signed-in customer lands back on their last choice.
  const addressSelectionInitialized = useRef(false);

  const allAddresses = useMemo(() => {
    if (!accountAddresses.length) return profile.addresses;
    const seen = new Set(accountAddresses.map((a) => `${a.label}::${a.text}`.toLowerCase()));
    const local = profile.addresses.filter((a) => !seen.has(`${a.label}::${a.text}`.toLowerCase()));
    return [...accountAddresses, ...local];
  }, [accountAddresses, profile.addresses]);

  const cartPayload = useMemo(() => cartLines(cart.items), [cart.items]);
  const parsedTip = parseTipCents(
    tipChoice === -1 ? Math.round((Number(customTipRupees) || 0) * 100) : tipChoice,
  );
  const tipError = parsedTip.ok ? null : parsedTip.error;
  const tipCents = parsedTip.ok ? parsedTip.tipCents : 0;
  const parsedSchedule = parseScheduledFor(scheduleInputToIso(scheduleInput));
  const scheduleError = parsedSchedule.ok ? null : parsedSchedule.error;
  const scheduledFor = parsedSchedule.ok ? parsedSchedule.scheduledFor : "";
  const postBill = useCallback(
    async (
      restaurantSlug: string,
      items: CartLinePayload[],
      applyOffer: boolean,
      promoCode: string,
    ): Promise<BillPreview | null> => {
      try {
        const res = await fetch("/api/orders/bill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantSlug, items, applyOffer, promoCode, tipCents, scheduledFor }),
        });
        return (await res.json()) as BillPreview;
      } catch {
        return null;
      }
    },
    [tipCents, scheduledFor],
  );
  const scheduleBounds = useMemo(() => {
    const now = new Date();
    return {
      min: toLocalInputValue(new Date(now.getTime() + MIN_SCHEDULE_LEAD_MS)),
      max: toLocalInputValue(new Date(now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000)),
    };
  }, []);
  const selectionKey = useMemo(
    () =>
      `${checkoutBillKey({
        restaurantSlug: cart.restaurantSlug,
        items: cartPayload,
        applyOffer,
        promoCode,
      })}|${tipCents}|${scheduledFor}`,
    [cart.restaurantSlug, cartPayload, applyOffer, promoCode, tipCents, scheduledFor],
  );

  // Only the preview priced for THIS cart and THIS offer choice may drive the
  // visible bill. Everything else is treated as if it never arrived.
  const activeBillState = previewForSelection(billState, billState?.key, selectionKey);
  const activePreview = activeBillState?.preview ?? null;
  const bill = activePreview?.ok && activePreview.bill ? activePreview.bill : null;
  const dropped = activePreview?.ok && Array.isArray(activePreview.dropped) ? activePreview.dropped : [];
  const offer = activePreview?.offer ?? null;
  const offerAvailable = activePreview?.offerAvailable ?? false;
  const appliedPromo = activePreview?.promo ?? null;
  const promoError = promoInputError ?? activeBillState?.promoError ?? null;
  const billError = activeBillState?.billError ?? null;

  // Until the authoritative preview lands, the client estimate supplies the
  // same breakdown shape so the final bill never shows a missing delivery fee.
  // Sold-out cart lines are excluded here because computeBill drops them too.
  const activeSubtotalCents = availableCartSubtotalCents(cart.items, availability);
  const estimate = estimateBill(activeSubtotalCents);
  const totalCents = bill?.totalCents ?? estimate.total;

  const applyPreview = useCallback((preview: BillPreview | null, key: string) => {
    const promoFailed = Boolean(
      preview && preview.ok === false && preview.code && PROMO_ERROR_CODES.has(preview.code),
    );
    const billFailed = preview === null || (preview.ok === false && !promoFailed);
    setBillState({
      key,
      preview,
      promoError: promoFailed ? preview?.error ?? "That offer could not be applied." : null,
      billError:
        billFailed && !promoFailed
          ? preview?.error ?? "We couldn't calculate the final bill. Please try again."
          : null,
    });
  }, []);

  // The route template animates with a transform, which becomes the containing
  // block for descendant `fixed` elements. Portal the sticky bar to the body so
  // it pins to the viewport instead of the bottom of the animated page.
  useEffect(() => setPortalHost(document.body), []);

  // Merchant-created promotions are public, but they are scoped to the listing
  // in the cart. Loading them here (rather than at build time) means a code the
  // kitchen creates or edits is visible on the very next checkout visit.
  useEffect(() => {
    if (!cart.hydrated || !cart.restaurantSlug) {
      setMerchantOffers([]);
      return;
    }
    let cancelled = false;
    setOffersLoading(true);
    fetch(`/api/restaurants/${encodeURIComponent(cart.restaurantSlug)}/offers`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.resolve({ offers: [] })))
      .then((data: { offers?: PublicMerchantOffer[] }) => {
        if (cancelled) return;
        setMerchantOffers(Array.isArray(data.offers) ? data.offers : []);
      })
      .catch(() => {
        if (!cancelled) setMerchantOffers([]);
      })
      .finally(() => {
        if (!cancelled) setOffersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cart.hydrated, cart.restaurantSlug]);

  // A code belongs to one kitchen. If the shopper swaps carts, drop the old
  // selection instead of carrying a discount into a restaurant that never
  // published it.
  useEffect(() => {
    setPromoCode("");
    setPromoInput("");
    setPromoInputError(null);
  }, [cart.restaurantSlug]);

  // Fetch the authoritative bill for the current cart (mirrors createOrder).
  // The request key travels with the response so a late reply for an earlier
  // offer choice is discarded instead of overwriting the current total.
  useEffect(() => {
    if (!cart.hydrated || cart.items.length === 0) return;
    let cancelled = false;
    setBillLoading(true);
    postBill(cart.restaurantSlug, cartPayload, applyOffer, promoCode).then((preview) => {
      if (cancelled) return;
      applyPreview(preview, selectionKey);
      setBillLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cart.hydrated, cart.restaurantSlug, cart.items.length, cartPayload, applyOffer, promoCode, postBill, selectionKey, applyPreview]);

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

  // prefill from profile/account after hydration
  useEffect(() => {
    if (!profile.hydrated) return;
    const accountName = accountAuth.account?.name?.trim() ?? "";
    const accountPhoneDigits = (accountAuth.account?.phoneE164 ?? "").replace(/\D/g, "").slice(-10);
    setName((n) => n || accountName || profile.name);
    setPhone((p) => p || accountPhoneDigits || profile.phone);
  }, [
    profile.hydrated,
    profile.name,
    profile.phone,
    accountAuth.account?.name,
    accountAuth.account?.phoneE164,
  ]);

  useEffect(() => {
    if (addressSelectionInitialized.current) return;
    if (!profile.hydrated || accountAuth.status === "loading") return;
    // Signed-in customers may have saved the address on their account; wait for
    // that list before deciding the persisted id is stale.
    if (accountAuth.status === "signedIn" && !accountAddressesLoaded) return;
    addressSelectionInitialized.current = true;
    const savedId = loadSelectedAddressId();
    setAddressId(
      savedId && allAddresses.some((a) => a.id === savedId)
        ? savedId
        : allAddresses[0]?.id ?? null,
    );
  }, [profile.hydrated, accountAuth.status, accountAddressesLoaded, allAddresses]);

  const refreshAccountAddresses = useCallback(async () => {
    const { accountFetch, status } = accountAuth;
    if (status !== "signedIn") {
      setAccountAddresses([]);
      setAccountAddressesLoaded(true);
      return;
    }
    setAccountAddressesLoaded(false);
    try {
      const res = await accountFetch("/api/customer/addresses", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; addresses?: { id: string | number; label: string; text: string }[] }
        | null;
      if (res.ok && data?.ok && Array.isArray(data.addresses)) {
        setAccountAddresses(
          data.addresses.map((a) => ({
            id: String(a.id),
            label: a.label || "Other",
            text: a.text || "",
          })),
        );
      } else {
        setAccountAddresses([]);
      }
    } catch {
      setAccountAddresses([]);
    } finally {
      setAccountAddressesLoaded(true);
    }
  }, [accountAuth]);

  useEffect(() => {
    void refreshAccountAddresses();
  }, [refreshAccountAddresses]);

  const startCheckoutRef = useRef<() => Promise<void>>(async () => {});
  const signedInDuringAuthRef = useRef(false);

  useEffect(() => {
    if (!pendingCheckout || authOpen) return;
    if (accountAuth.status !== "signedIn") return;
    setPendingCheckout(false);
    void startCheckoutRef.current();
  }, [pendingCheckout, authOpen, accountAuth.status]);

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

  const selectedAddress: Address | null = allAddresses.find((a) => a.id === addressId) ?? null;
  const addressText = selectedAddress ? addressForOrder(selectedAddress) : "";
  const deliveryLocation = pointFromAddress(selectedAddress);
  // A pin from the address picker is more specific than the header's locality
  // pick; fall back to the URL/localStorage claim for legacy text addresses.
  const localityKey =
    deliveryLocalityKey ??
    (deliveryLocation ? localityKeyForPoint(deliveryLocation) : undefined) ??
    currentLocalityKey();
  const phoneDigits = checkoutPhoneDigits(phone);
  /** Everything needed to actually submit: contact, address and consent. */
  const detailsComplete = checkoutContactComplete({
    name,
    phone,
    addressText,
  });
  const hasBillableItems = cart.items.some((i) => !cartItemIsSoldOut(availability, i.menuItemId));
  const unavailableNames = dropped.length
    ? dropped.map((d) => d.name)
    : cart.items
        .filter((i) => cartItemIsSoldOut(availability, i.menuItemId))
        .map((i) => i.name);
  // An unapplied code must not look successful, and an order must never be
  // placed from the optimistic fallback. Both the code and the final total come
  // from the authoritative preview for the current selection.
  const extrasValid = !tipError && !scheduleError;
  const canPlace =
    detailsComplete && acceptedTerms && !promoError && !billError && hasBillableItems && !!bill && extrasValid;
  const issueMessage = checkoutIssueMessage(
    checkoutIssue({ detailsComplete, acceptedTerms, promoError, billError, hasBillableItems }),
    billError,
  );

  const selectPromo = (code: string) => {
    setPromoCode(code);
    setPromoInput(code);
    setPromoInputError(null);
    // Only one discount per order. A promo selection replaces the legacy flag;
    // ticking the legacy offer below clears the promo instead.
    setApplyOffer(false);
  };

  const clearPromo = () => {
    setPromoCode("");
    setPromoInput("");
    setPromoInputError(null);
  };

  const applyTypedPromo = () => {
    const parsed = parseOfferCode(promoInput);
    if (!parsed) {
      setPromoInputError("Enter a valid offer code");
      return;
    }
    selectPromo(parsed);
  };

  /** Align the header locality with a newly chosen, pinned address. */
  const applyAddressLocality = (address: Address) => {
    const point = pointFromAddress(address);
    const key = point ? localityKeyForPoint(point) : undefined;
    setDeliveryLocalityKey(key ?? null);
    if (key) setLocality(key);
  };

  /** `location` opens the picker straight into the add-address flow. */
  const openAddressPicker = (mode: AddressPickerMode = "list") => {
    setAddressPickerMode(mode);
    setAddressPickerOpen(true);
  };

  const chooseAddress = (id: string) => {
    const next = allAddresses.find((a) => a.id === id);
    if (!next) return;
    setAddressId(id);
    persistSelectedAddressId(id);
    applyAddressLocality(next);
  };

  const saveAddressFromPicker = (raw: Address, saveToAccount: boolean) => {
    const saved = profile.saveDeliveryAddress(raw);
    setAddressId(saved.id);
    persistSelectedAddressId(saved.id);
    applyAddressLocality(saved);
    if (saveToAccount && accountAuth.status === "signedIn" && saved.text.trim()) {
      void (async () => {
        try {
          const res = await accountAuth.accountFetch("/api/customer/addresses", {
            method: "POST",
            mutating: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: saved.label || "Other", text: saved.text }),
          });
          if (res.ok) await refreshAccountAddresses();
        } catch {
          /* The local address is already saved; the account copy is best-effort. */
        }
      })();
    }
  };

  const deleteAddress = (id: string) => {
    profile.removeAddress(id);
    if (addressId !== id) return;
    const remaining = allAddresses.find((a) => a.id !== id && profile.addresses.some((p) => p.id === a.id));
    setAddressId(remaining?.id ?? null);
    persistSelectedAddressId(remaining?.id ?? null);
    setDeliveryLocalityKey(null);
    if (remaining) applyAddressLocality(remaining);
  };

  /** Live feedback while a pin is dragged, before the address is saved. */
  const handlePinChange = (point: MapPoint) => {
    const key = localityKeyForPoint(point);
    setDeliveryLocalityKey(key ?? null);
    if (key) setLocality(key);
  };

  /**
   * Create the order first, then take the money. For online payments the server
   * holds the order at PAYMENT_PENDING and hands back a provider session; the
   * order is only released to the restaurant once the capture is confirmed.
   */
  const placeOrder = async (choice: PayChoice) => {
    if (!canPlace || placeState === "loading") return;
    setPlaceState("loading");
    setError(null);

    const digits = phoneDigits.slice(-10);
    profile.setIdentity(name.trim(), digits);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantSlug: cart.restaurantSlug,
          clientRequestId: placeRequestId,
          // Device-scoped inbox: this high-entropy token stays in localStorage;
          // the server stores only its SHA-256 hash on the order.
          inboxToken: ensureInboxToken(),
          items: cartLines(cart.items),
          addressLabel: selectedAddress?.label ?? "Home",
          addressText,
          // Used only for the delivery-area admission check, never stored.
          deliveryLocation,
          customerName: name.trim(),
          phone: digits,
          paymentMethod: choice === "online" ? "upi" : "cod",
          instructions: instructions.trim(),
          // Explicit customer selection; the server re-checks the literal and
          // recomputes the discount from the restaurant's own offer terms.
          applyOffer,
          // Explicit code selection, re-resolved and repriced by the server.
          promoCode,
          // Bounded customer choice; the server validates and re-adds the tip.
          tipCents,
          scheduledFor,
          // The server re-checks this: `canPlace` only gates the button.
          acceptedTerms,
          // Customer's active delivery area, rechecked against this restaurant.
          localityKey,
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
        code?: string;
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
      if (res.status === 401 && data.code === "ACCOUNT_REQUIRED") {
        setPlaceState("idle");
        signedInDuringAuthRef.current = false;
        setPendingCheckout(true);
        setAuthOpen(true);
        return;
      }
      if (!res.ok || !data.ok || !data.order || !data.orderToken) {
        throw new Error(data.error ?? "Could not place order");
      }

      const code = data.order.code;
      const token = data.orderToken;
      const trackingToken = data.trackingToken ?? null;
      setPlacedTrackingToken(trackingToken);
      profile.rememberOrder(code, token, trackingToken ?? undefined);

      void fetch("/api/orders/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: [{ code, token }] }),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {
        /* best-effort session migration */
      });
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
    if (placeState === "loading" || billLoading) return;
    if (accountAuth.status === "loading") return;
    if (accountAuth.status !== "signedIn") {
      signedInDuringAuthRef.current = false;
      setPendingCheckout(true);
      setAuthOpen(true);
      return;
    }
    if (billError) return;
    let target = bill;
    if (!target) {
      const preview = await postBill(cart.restaurantSlug, cartPayload, applyOffer, promoCode);
      applyPreview(preview, selectionKey);
      if (!preview?.ok || !preview.bill) {
        setPlaceState("error");
        setError(preview?.error ?? "We couldn't calculate the final bill. Please try again.");
        return;
      }
      target = preview.bill;
    }
    void placeOrder(payChoice);
  };
  // eslint-disable-next-line react-hooks/refs -- latest-callback ref for pending checkout resume
  startCheckoutRef.current = startCheckout;

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

  /** Switch a failed/unpaid online payment to cash-on-delivery. */
  const switchToCash = async () => {
    if (!payTarget) return;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (payTarget.token) headers["x-order-token"] = payTarget.token;
      const res = await fetch(`/api/orders/${encodeURIComponent(payTarget.code)}/pay/switch-cod`, {
        method: "POST",
        headers,
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        toast(data?.error ?? "Could not switch to cash on delivery", { kind: "error" });
        return;
      }
      const code = payTarget.code;
      const name = payTarget.payeeName;
      const trackingToken = placedTrackingToken ?? undefined;
      setPayTarget(null);
      setPlaceState("success");
      setPlaced({ code, restaurantName: name, paid: false, method: "cod", trackingToken });
      setRedirectIn(10);
      toast("Switched to cash on delivery");
    } catch {
      toast("Could not switch to cash on delivery", { kind: "error" });
    }
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
    <div className="mx-auto max-w-5xl px-4 pb-40 pt-6 md:px-6 md:pb-12 md:pt-9">
      <Link href="/cart" className="press inline-flex items-center gap-1.5 text-sm font-medium text-cream-400 transition-colors hover:text-cream-50">
        <ArrowLeft className="size-4" /> Back to cart
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Checkout</h1>
      <p className="mt-1 text-sm text-cream-500">
        From <span className="font-semibold text-cream-300">{cart.restaurantName}</span> · arrives in ~30 min
      </p>

      <div className="mt-6 grid gap-5 md:mt-5 lg:grid-cols-[1fr_340px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          <Section title="Delivery details" Icon={MapPin}>
            <div className="space-y-2.5">
              {selectedAddress ? (
                <div className="flex items-start gap-3 rounded-2xl border border-ember-400/45 bg-ember-400/7 p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-chili-500/18 text-chili-400">
                    {selectedAddress.label === "Work" ? (
                      <Briefcase className="size-4" />
                    ) : selectedAddress.label === "Other" ? (
                      <MapPin className="size-4" />
                    ) : (
                      <House className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-ember-300">
                      Deliver to {selectedAddress.label}
                    </p>
                    <p className="mt-1 break-words text-[13px] leading-relaxed text-cream-200">
                      {addressSummary(selectedAddress)}
                    </p>
                    {selectedAddress.instructions && (
                      <p className="mt-1 text-xs text-cream-500">
                        Note: {selectedAddress.instructions}
                      </p>
                    )}
                    {deliveryLocation && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-mint-300">
                        <Check className="size-3" /> Pin placed on map
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openAddressPicker("list")}
                      className="press rounded-full border border-white/15 bg-white/6 px-3 py-1.5 text-xs font-bold text-cream-200 transition-colors hover:bg-white/12"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => openAddressPicker("location")}
                      className="press inline-flex items-center gap-1 rounded-full border border-ember-400/45 bg-ember-400/12 px-3 py-1.5 text-xs font-bold text-ember-200 transition-colors hover:bg-ember-400/20"
                    >
                      <Plus className="size-3.5" /> Add address
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => openAddressPicker("list")}
                    className="press flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ember-400/40 bg-ember-400/5 py-3.5 text-sm font-bold text-ember-200 transition-colors hover:bg-ember-400/10"
                  >
                    <MapPin className="size-4" /> Choose a delivery address
                  </button>
                  <button
                    type="button"
                    onClick={() => openAddressPicker("location")}
                    className="press flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-white/6 py-3.5 text-sm font-bold text-cream-200 transition-colors hover:bg-white/12"
                  >
                    <Plus className="size-4" /> Add address
                  </button>
                </div>
              )}
              <p className="text-xs text-cream-500">
                {accountAuth.status === "signedIn"
                  ? "Saved account addresses and addresses on this device are both available in the picker."
                  : "Search by area, drop a map pin or type your address. Saved addresses stay on this device."}
              </p>
            </div>

            <div className="mt-4 border-t border-white/8 pt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cream-500">
                <Smartphone className="size-3.5" /> Contact for delivery
              </p>
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
            </div>
          </Section>

          <Section title="Payment" Icon={CreditCard}>
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

            <div className="mt-4 flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-mint-500/10 text-mint-400">
                <ShieldCheck className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-cream-50">
                  {payChoice === "online" ? "Pay securely online" : "Pay cash on delivery"}
                </p>
                <p className="text-xs leading-relaxed text-cream-500">
                  {payChoice === "online"
                    ? "UPI, cards and netbanking open in Razorpay. The kitchen starts only after payment is confirmed."
                    : `${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"} from ${cart.restaurantName}. Keep the exact amount ready for the rider.`}
                </p>
              </div>
            </div>

            {issueMessage && (
              <p role="status" className="mt-3 text-xs font-medium text-chili-300">
                {issueMessage}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-xs font-medium text-chili-300">
                {error}
              </p>
            )}
            {canPlace && accountAuth.status !== "signedIn" && accountAuth.status !== "loading" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ember-300">
                <ShieldCheck className="size-3.5" /> You’ll sign in or create an account when you place your order.
              </p>
            )}
          </Section>

          <section className="glass rounded-3xl p-5 md:p-6">
            <button
              type="button"
              onClick={() => setShowExtras((show) => !show)}
              aria-expanded={showExtras}
              aria-controls="checkout-extras"
              className="press flex w-full items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2.5 font-display text-base font-bold text-cream-50">
                <Tag className="size-4 shrink-0 text-cream-400" /> Offers &amp; delivery note
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {(promoCode || instructions.trim()) && (
                  <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mint-300">
                    Added
                  </span>
                )}
                <ChevronDown className={cn("size-4 text-cream-400 transition-transform duration-300", showExtras && "rotate-180")} />
              </span>
            </button>
            <div
              id="checkout-extras"
              hidden={!showExtras}
              className="mt-4 animate-fade-in space-y-4 border-t border-white/8 pt-4"
            >
              <OfferPicker
                offers={merchantOffers}
                loading={offersLoading}
                selectedCode={promoCode}
                codeInput={promoInput}
                error={promoError}
                subtotalCents={cart.subtotalCents}
                onCodeInput={setPromoInput}
                onApplyCode={applyTypedPromo}
                onSelect={selectPromo}
                onClear={clearPromo}
              />
              <label className="block">
                <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-cream-300">
                  <NotebookPen className="size-3.5" /> Delivery note (optional)
                </span>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Extra spicy, ring the bell twice, no cutlery"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
                />
              </label>
            </div>
          </section>
        </div>

        <aside className="order-first lg:order-none lg:sticky lg:top-24 lg:self-start">
          {unavailableNames.length > 0 && (
            <div role="status" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-chili-500/25 bg-chili-500/8 px-4 py-3 text-sm leading-relaxed text-chili-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {unavailableNames.join(", ")} {unavailableNames.length === 1 ? "is" : "are"} sold out and will not be charged. Remove {unavailableNames.length === 1 ? "it" : "them"} from your cart to clear this notice.
              </span>
            </div>
          )}
          <div className="mb-4">
            <TipSchedulePicker
              tipChoice={tipChoice}
              onTipChoice={setTipChoice}
              customTipRupees={customTipRupees}
              onCustomTip={setCustomTipRupees}
              scheduleInput={scheduleInput}
              onSchedule={setScheduleInput}
              scheduleMin={scheduleBounds.min}
              scheduleMax={scheduleBounds.max}
              tipError={tipError}
              scheduleError={scheduleError}
            />
          </div>
          <CheckoutSummary
            open={openSummary}
            onToggle={() => setOpenSummary((o) => !o)}
            totalCents={totalCents}
            subtotalCents={bill?.subtotalCents ?? activeSubtotalCents}
            discountCents={bill?.discountCents ?? 0}
            deliveryFeeCents={bill?.deliveryFeeCents ?? estimate.deliveryFee}
            platformFeeCents={bill?.platformFeeCents ?? estimate.platformFee}
            tipCents={bill ? tipCents : 0}
            scheduledFor={bill ? scheduledFor : ""}
            offer={offer}
            offerAvailable={offerAvailable}
            applyOffer={applyOffer}
            promoCode={promoCode}
            appliedPromo={appliedPromo}
            onToggleOffer={(value) => {
              // One discount per order: selecting the listing offer clears any
              // code. The selection key changes immediately, so the old total
              // stops driving the summary while the new preview is fetched.
              if (value) clearPromo();
              setApplyOffer(value);
            }}
            onClearPromo={clearPromo}
            unavailableNames={unavailableNames}
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
                        {cartItemIsSoldOut(availability, i.menuItemId) && (
                          <span className="shrink-0 rounded-full bg-chili-500/18 px-1.5 py-0.5 text-[9px] font-bold text-chili-300">
                            SOLD OUT
                          </span>
                        )}
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
            disabled={!canPlace || accountAuth.status === "loading"}
            busy={billLoading}
            totalCents={totalCents}
            label={accountAuth.status !== "signedIn" ? "Sign in to place order" : payChoice === "online" ? "Pay" : "Place order"}
            onClick={startCheckout}
            className="mt-4 hidden lg:flex"
          />
        </aside>
      </div>

      {/* mobile sticky place order — portalled out of the animated route wrapper */}
      {portalHost &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-void/85 p-4 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            {(issueMessage ?? error) && (
              <p className="mb-2 text-center text-[11px] font-medium text-chili-300">{issueMessage ?? error}</p>
            )}
            <PlaceOrderButton
              state={placeState}
              disabled={!canPlace || accountAuth.status === "loading"}
              busy={billLoading}
              totalCents={totalCents}
              label={accountAuth.status !== "signedIn" ? "Sign in to place order" : payChoice === "online" ? "Pay" : "Place order"}
              onClick={startCheckout}
            />
          </div>,
          portalHost,
        )}

      {payTarget && (
        <PaymentStage
          target={payTarget}
          onPaid={markPaid}
          onViewOrder={viewUnconfirmedOrder}
          onAbandon={keepUnpaid}
          onSwitchToCash={switchToCash}
          onClose={keepUnpaid}
        />
      )}

      {addressPickerOpen && (
        <AddressPicker
          key={addressPickerMode}
          addresses={allAddresses}
          selectedId={addressId}
          signedIn={accountAuth.status === "signedIn"}
          initialView={addressPickerMode}
          deletableIds={new Set(profile.addresses.map((a) => a.id))}
          onClose={() => setAddressPickerOpen(false)}
          onSelect={(id) => {
            chooseAddress(id);
            setAddressPickerOpen(false);
          }}
          onSave={(address, saveToAccount) => {
            saveAddressFromPicker(address, saveToAccount);
            setAddressPickerOpen(false);
          }}
          onDelete={deleteAddress}
          onPinChange={handlePinChange}
        />
      )}

      <CustomerAuthDialog
        open={authOpen}
        onClose={() => {
          setAuthOpen(false);
          if (!signedInDuringAuthRef.current) setPendingCheckout(false);
          signedInDuringAuthRef.current = false;
        }}
        onSignedIn={() => {
          signedInDuringAuthRef.current = true;
          setPendingCheckout(true);
          setAuthOpen(false);
        }}
        title="Sign in to place your order"
        message="Create an account or sign in with your phone number to continue. After verification, we'll pick up right where you left off and place your order."
      />
    </div>
  );
}

/* ------------------------------ pieces ------------------------------ */

function Section({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <section className="glass rounded-3xl p-5 md:p-6">
      <h2 className="mb-4 flex items-center gap-2.5 font-display text-base font-bold text-cream-50">
        <Icon className="size-4 text-cream-400" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function OfferPicker({
  offers,
  loading,
  selectedCode,
  codeInput,
  error,
  subtotalCents,
  onCodeInput,
  onApplyCode,
  onSelect,
  onClear,
}: {
  offers: PublicMerchantOffer[];
  loading: boolean;
  selectedCode: string;
  codeInput: string;
  error: string | null;
  subtotalCents: number;
  onCodeInput: (value: string) => void;
  onApplyCode: () => void;
  onSelect: (code: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={codeInput}
          onChange={(e) => onCodeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApplyCode();
            }
          }}
          placeholder="Have a code? Enter it here"
          aria-label="Offer code"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm uppercase tracking-wide text-cream-50 placeholder:normal-case placeholder:tracking-normal placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={onApplyCode}
          disabled={!codeInput.trim()}
          className="press shrink-0 rounded-xl border border-ember-400/35 bg-ember-500/10 px-4 text-sm font-bold text-ember-200 transition-colors hover:bg-ember-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
      </div>
      {error && <p className="text-xs font-medium text-chili-300">{error}</p>}

      {loading ? (
        <p className="text-xs text-cream-500">Loading this kitchen&apos;s offers…</p>
      ) : offers.length === 0 ? (
        <p className="text-xs text-cream-500">This kitchen has not published any offers.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {offers.map((offer) => {
            const shortfall = Math.max(0, offer.minOrderCents - subtotalCents);
            const selected = selectedCode === offer.code;
            const disabled = !offer.available || shortfall > 0;
            return (
              <button
                key={offer.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(offer.code)}
                className={cn(
                  "press min-w-0 rounded-2xl border p-3 text-left transition-all duration-200",
                  selected
                    ? "border-mint-400/50 bg-mint-500/10"
                    : disabled
                      ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-60"
                      : "border-white/10 bg-white/[0.03] hover:border-ember-400/40 hover:bg-white/[0.06]",
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-cream-100">{offer.title}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-ember-300">{offer.discountLabel}</span>
                  </span>
                  <code className="shrink-0 rounded-lg bg-black/25 px-2 py-1 text-[10px] font-bold tracking-wide text-ember-300">
                    {offer.code}
                  </code>
                </span>
                {offer.description && (
                  <span className="mt-2 block text-[11px] leading-snug text-cream-500">{offer.description}</span>
                )}
                <span className="mt-2 block text-[11px] font-medium text-cream-400">
                  {selected
                    ? "Selected"
                    : shortfall > 0
                      ? `Add ${formatINR(shortfall)} more`
                      : !offer.available
                        ? offer.unavailableReason
                        : "Select offer"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedCode && (
        <button
          type="button"
          onClick={onClear}
          className="press inline-flex items-center gap-1.5 text-xs font-semibold text-cream-400 transition-colors hover:text-cream-100"
        >
          <X className="size-3.5" /> Remove {selectedCode}
        </button>
      )}
      <p className="text-[11px] leading-relaxed text-cream-600">
        Offers are applied only when you select one. The final discount is recalculated from your
        cart and the kitchen&apos;s offer terms when you place the order.
      </p>
    </div>
  );
}

function TipSchedulePicker({
  tipChoice,
  onTipChoice,
  customTipRupees,
  onCustomTip,
  scheduleInput,
  onSchedule,
  scheduleMin,
  scheduleMax,
  tipError,
  scheduleError,
}: {
  tipChoice: number;
  onTipChoice: (value: number) => void;
  customTipRupees: string;
  onCustomTip: (value: string) => void;
  scheduleInput: string;
  onSchedule: (value: string) => void;
  scheduleMin: string;
  scheduleMax: string;
  tipError: string | null;
  scheduleError: string | null;
}) {
  const presets = [0, 2_000, 5_000, 10_000];
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="font-display text-base font-bold text-cream-50">
        Tip &amp; schedule <span className="ml-1 text-xs font-medium text-cream-500">optional</span>
      </h2>
      <p className="mt-1 text-[11px] text-cream-500">
        Tips go to the kitchen and delivery team. Scheduled orders need at least 30 minutes&apos;
        notice.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tip amount">
        {presets.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tipChoice === value}
            onClick={() => onTipChoice(value)}
            className={cn(
              "press rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
              tipChoice === value
                ? "bg-ember-400/20 text-ember-300 ring-1 ring-ember-400/40"
                : "bg-white/6 text-cream-400 hover:text-cream-100",
            )}
          >
            {value === 0 ? "No tip" : formatINR(value)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={tipChoice === -1}
          onClick={() => onTipChoice(-1)}
          className={cn(
            "press rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
            tipChoice === -1
              ? "bg-ember-400/20 text-ember-300 ring-1 ring-ember-400/40"
              : "bg-white/6 text-cream-400 hover:text-cream-100",
          )}
        >
          Custom
        </button>
      </div>
      {tipChoice === -1 && (
        <label htmlFor="custom-tip" className="mt-3 block text-xs font-semibold text-cream-300">
          Custom tip in rupees
          <input
            id="custom-tip"
            type="number"
            min={0}
            max={MAX_TIP_CENTS / 100}
            step="1"
            value={customTipRupees}
            onChange={(event) => {
              onCustomTip(event.target.value);
              onTipChoice(-1);
            }}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-cream-100 focus:border-ember-400/50 focus:outline-none"
          />
        </label>
      )}
      {tipError && <p role="alert" className="mt-2 text-xs text-chili-300">{tipError}</p>}
      <label htmlFor="schedule-time" className="mt-4 block text-xs font-semibold text-cream-300">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 text-ember-400" /> Schedule for later
        </span>
        <input
          id="schedule-time"
          type="datetime-local"
          min={scheduleMin}
          max={scheduleMax}
          value={scheduleInput}
          onChange={(event) => onSchedule(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-cream-100 focus:border-ember-400/50 focus:outline-none"
        />
      </label>
      {scheduleError && <p role="alert" className="mt-2 text-xs text-chili-300">{scheduleError}</p>}
    </div>
  );
}

function CheckoutSummary({
  open,
  onToggle,
  totalCents,
  subtotalCents,
  discountCents,
  deliveryFeeCents,
  platformFeeCents,
  tipCents,
  scheduledFor,
  itemsNode,
  offer,
  offerAvailable,
  applyOffer,
  promoCode,
  appliedPromo,
  onToggleOffer,
  onClearPromo,
  unavailableNames,
}: {
  open: boolean;
  onToggle: () => void;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  platformFeeCents: number;
  tipCents: number;
  scheduledFor: string;
  itemsNode: ReactNode;
  offer: string | null;
  offerAvailable: boolean;
  applyOffer: boolean;
  promoCode: string;
  appliedPromo: PublicMerchantOffer | null;
  onToggleOffer: (value: boolean) => void;
  onClearPromo: () => void;
  unavailableNames: string[];
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
              const soldOut = unavailableNames.includes(i.name) ? " — sold out" : "";
              return `${i.quantity}× ${i.name}${extras}${soldOut}`;
            })
            .join(", ")}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 text-[13px]">
        <div className="flex items-center justify-between">
          <span className="text-cream-500">Item total</span>
          <span className="font-semibold text-cream-100 tabular-nums">{formatINR(subtotalCents)}</span>
        </div>
        {discountCents > 0 && (
          <div className="flex items-center justify-between text-mint-400">
            <span className="flex items-center gap-1.5">
              <BadgePercent className="size-3.5" />
              {promoCode ? `Offer ${promoCode}` : "Restaurant offer"}
            </span>
            <span className="font-semibold tabular-nums">−{formatINR(discountCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-cream-500">
            <Truck className="size-3.5" /> Delivery fee
          </span>
          <span className="font-semibold tabular-nums">
            {deliveryFeeCents === 0 ? (
              <span className="text-mint-400">FREE</span>
            ) : (
              <span className="text-cream-100">{formatINR(deliveryFeeCents)}</span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-cream-500">Platform fee</span>
          <span className="font-semibold text-cream-100 tabular-nums">{formatINR(platformFeeCents)}</span>
        </div>
        {tipCents > 0 && (
          <div className="flex items-center justify-between text-mint-400">
            <span className="flex items-center gap-1.5">
              <Heart className="size-3.5" /> Tip
            </span>
            <span className="font-semibold tabular-nums">{formatINR(tipCents)}</span>
          </div>
        )}
        {scheduledFor && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-cream-500">
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 shrink-0 text-ember-400" /> Scheduled
            </span>
            <span className="truncate text-cream-300">{formatDateTime(scheduledFor)}</span>
          </div>
        )}
      </div>
      {promoCode && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-mint-400/25 bg-mint-500/8 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-mint-300">
              {appliedPromo?.title ?? `Promo ${promoCode}`}
            </span>
            <span className="block text-[11px] text-cream-500">
              Code {promoCode} · recalculated on the final bill
            </span>
          </span>
          <button
            type="button"
            onClick={onClearPromo}
            aria-label={`Remove offer ${promoCode}`}
            className="press grid size-7 shrink-0 place-items-center rounded-lg text-cream-400 transition-colors hover:bg-white/8 hover:text-cream-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {offerAvailable && !promoCode && (
        <label className="press mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-ember-400/25 bg-ember-500/8 px-3 py-2.5">
          <input
            type="checkbox"
            checked={applyOffer}
            onChange={(event) => onToggleOffer(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-mint-400"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-cream-100">
              Apply restaurant offer{offer ? `: ${offer}` : ""}
            </span>
            <span className="block text-[11px] leading-snug text-cream-500">
              Optional — never applied unless you select it
            </span>
          </span>
        </label>
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
      data-checkout-cta=""
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
