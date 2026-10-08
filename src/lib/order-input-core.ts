/**
 * Checkout input validation, as pure functions.
 *
 * Split from `api/orders/route.ts` for the usual reason — the decisions worth
 * asserting live where `node --test` can import them without `server-only` —
 * but the split also marks a boundary the route used to blur: what the CLIENT
 * is allowed to assert about an order, versus what the server derives.
 *
 * Pricing was never client-trusted. `computeBill` resolves the restaurant by
 * slug and prices every line from the menu row, and `createOrder` stores only
 * that bill — no total the client sends is ever read. What was missing was the
 * validation around it:
 *
 *   - Quantity was silently clamped inside `computeBill` (1..20), so a cart line
 *     of 0 became 1 and a line of 999 became 20: accepted, then quietly
 *     rewritten. A customer should be told "no" rather than charged a number
 *     they did not ask for, so both ends now reject outright.
 *   - Cart size was bounded only by the JSON body cap, so one request could
 *     name more distinct menu items than the browse page will ever render and
 *     force a single `inArray` lookup to resolve them all.
 *   - `paymentMethod` was an arbitrary string. Anything outside the online
 *     allowlist was treated as cash, so a crafted body could store "paypal"
 *     and have the order queued to the POS as a COD-style collection.
 *   - The parsed body was forwarded to `createOrder` as received, so trust
 *     rested on that function ignoring fields it was never given.
 *     `validateCheckout` builds the input from a whitelist instead: the client
 *     price/restaurant fields (`total`, `subtotal`, `discount`, `deliveryFee`,
 *     `price`, `restaurantName`) are not merely unused — they are never carried
 *     into the request at all.
 *
 * The bill preview (`api/orders/bill`) shares the cart half via `sanitizeCart`,
 * so the payment screen cannot preview a cart that checkout would refuse, and
 * `computeBill` imports `MAX_ITEM_QUANTITY` so its backstop clamp is the same
 * bound the routes enforce.
 */

/** Largest quantity one cart line may request. */
export const MAX_ITEM_QUANTITY = 99;

/** Most distinct menu items one cart may name. */
export const MAX_CART_ITEMS = 50;

/**
 * The payment methods checkout accepts: UPI and card go through the provider,
 * cash on delivery settles at the door. Anything else — `netbanking`, `wallet`,
 * `paypal`, an attacker's invented string — would previously have been stored
 * verbatim and classified as cash by `isOnlinePayment`.
 */
export const CHECKOUT_PAYMENT_METHODS = ["upi", "card", "cod"] as const;

export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

export type OrderInputErrorCode =
  | "MISSING_FIELDS"
  | "EMPTY_CART"
  | "QUANTITY_OUT_OF_RANGE"
  | "CART_TOO_LARGE"
  | "PAYMENT_METHOD_NOT_ALLOWED";

/**
 * A cart line after validation: every field read here was checked, every other
 * field the client sent was dropped.
 */
export interface SanitizedCartLine {
  menuItemId: number;
  quantity: number;
  /** Client-held price snapshot; advisory only (flagged stale, billed at DB price). */
  priceCents?: number;
  modifiers?: { optionId: number; quantity?: number }[];
}

export type CartResult =
  | { ok: true; items: SanitizedCartLine[] }
  | { ok: false; error: string; code: OrderInputErrorCode };

/**
 * The order input `createOrder` receives, rebuilt from a whitelist. Structurally
 * assignable to `CreateOrderInput` — and deliberately narrower: there is no
 * field here through which a client can name a price or a restaurant.
 */
export interface CheckoutRequest {
  restaurantSlug: string;
  items: SanitizedCartLine[];
  /** Absent when the client sent no usable label — the row keeps its "Home" default. */
  addressLabel?: string;
  addressText: string;
  customerName: string;
  /** Digits only, last 10. */
  phone: string;
  paymentMethod: CheckoutPaymentMethod;
  instructions?: string;
  clientRequestId?: string;
  outletId?: string;
}

export type CheckoutResult =
  | { ok: true; request: CheckoutRequest }
  | { ok: false; error: string; code: OrderInputErrorCode };

/** Coerce an unknown payment method to an accepted one, or null. */
export function checkoutPaymentMethod(raw: unknown): CheckoutPaymentMethod | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return (CHECKOUT_PAYMENT_METHODS as readonly string[]).includes(value)
    ? (value as CheckoutPaymentMethod)
    : null;
}

/**
 * A quantity is valid only as an integer in 1..MAX_ITEM_QUANTITY. Numeric
 * strings (`"3"`) are accepted because form state round-trips as text; anything
 * fractional, non-numeric, zero or above the bound is not.
 */
export function quantityIsValid(raw: unknown): boolean {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_ITEM_QUANTITY;
}

/**
 * Malformed modifier selectors are dropped rather than rejected: the authority
 * on whether a modifier belongs is `computeBill`, which resolves every option
 * against its linked group and fails the cart if one does not fit.
 */
function sanitizeModifiers(raw: unknown): { optionId: number; quantity?: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { optionId: number; quantity?: number }[] = [];
  for (const entry of raw) {
    const rec = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const optionId = Number(rec.optionId);
    if (!Number.isInteger(optionId) || optionId <= 0) continue;
    const quantity = Number(rec.quantity);
    out.push({ optionId, ...(Number.isInteger(quantity) && quantity >= 1 ? { quantity } : {}) });
  }
  return out.length ? out : undefined;
}

/**
 * Validate a submitted cart: non-empty, every line well-formed, every quantity
 * inside the bound, no more than MAX_CART_ITEMS distinct items. Rejected
 * wholesale on the first bad line — a preview that silently omits a line is a
 * preview that disagrees with the order it claims to preview.
 */
export function sanitizeCart(raw: unknown): CartResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Your cart is empty", code: "EMPTY_CART" };
  }

  const items: SanitizedCartLine[] = [];
  for (const entry of raw) {
    const rec = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const menuItemId = Number(rec.menuItemId);
    if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
      return { ok: false, error: "Missing or invalid required fields", code: "MISSING_FIELDS" };
    }
    if (!quantityIsValid(rec.quantity)) {
      return {
        ok: false,
        error: `Each item's quantity must be between 1 and ${MAX_ITEM_QUANTITY}`,
        code: "QUANTITY_OUT_OF_RANGE",
      };
    }
    const priceCents =
      typeof rec.priceCents === "number" && Number.isFinite(rec.priceCents)
        ? rec.priceCents
        : undefined;
    const modifiers = sanitizeModifiers(rec.modifiers);
    items.push({
      menuItemId,
      quantity: Number(rec.quantity),
      ...(priceCents !== undefined ? { priceCents } : {}),
      ...(modifiers ? { modifiers } : {}),
    });
  }

  if (new Set(items.map((i) => i.menuItemId)).size > MAX_CART_ITEMS) {
    return {
      ok: false,
      error: `Carts are limited to ${MAX_CART_ITEMS} different items`,
      code: "CART_TOO_LARGE",
    };
  }

  return { ok: true, items };
}

/**
 * Validate a checkout request and rebuild it as a whitelist input for
 * `createOrder`. Order of checks: required fields, then cart, then payment
 * method — the cheapest refusals first, and the cart is never priced for a
 * request that cannot pay for it.
 */
export function validateCheckout(raw: unknown): CheckoutResult {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const restaurantSlug = typeof body.restaurantSlug === "string" ? body.restaurantSlug.trim() : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const addressText = typeof body.addressText === "string" ? body.addressText.trim() : "";
  const digits = String(body.phone ?? "").replace(/\D/g, "");
  if (!restaurantSlug || !customerName || !addressText || digits.length < 10) {
    return { ok: false, error: "Missing or invalid required fields", code: "MISSING_FIELDS" };
  }

  const cart = sanitizeCart(body.items);
  if (!cart.ok) return cart;

  const paymentMethod = checkoutPaymentMethod(body.paymentMethod);
  if (!paymentMethod) {
    return {
      ok: false,
      error: "Choose UPI, card or cash on delivery",
      code: "PAYMENT_METHOD_NOT_ALLOWED",
    };
  }

  const addressLabel =
    typeof body.addressLabel === "string" && body.addressLabel.trim()
      ? body.addressLabel.trim().slice(0, 80)
      : undefined;
  const instructions = typeof body.instructions === "string" ? body.instructions : undefined;
  const clientRequestId =
    typeof body.clientRequestId === "string" && body.clientRequestId.trim()
      ? body.clientRequestId.trim().slice(0, 80)
      : undefined;
  const outletId =
    typeof body.outletId === "string" && body.outletId.trim()
      ? body.outletId.trim().slice(0, 64)
      : undefined;

  return {
    ok: true,
    request: {
      restaurantSlug,
      items: cart.items,
      ...(addressLabel !== undefined ? { addressLabel } : {}),
      addressText,
      customerName,
      phone: digits.slice(-10),
      paymentMethod,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(clientRequestId !== undefined ? { clientRequestId } : {}),
      ...(outletId !== undefined ? { outletId } : {}),
    },
  };
}
