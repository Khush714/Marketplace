import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Provider session allocation (Phase 6). At checkout the Marketplace asks the
 * provider for a payment ORDER whose id becomes the binding the capture
 * webhook resolves (see applyProviderPaymentEvent).
 *
 * Modes:
 *   razorpay     RAZORPAY_KEY_ID/KEY_SECRET present — real provider orders,
 *                hosted checkout.js, signature-verified captures.
 *   dev          no keys and not production — a local stand-in order id so the
 *                whole checkout → capture → POS flow is exercisable offline.
 *                NEVER reachable in production (see {@link providerMode}).
 *   unavailable  no keys in production — online checkout is refused outright
 *                rather than minting an order that can never be captured.
 *
 * Confirmation always comes from the provider webhook; this module only
 * allocates the order and verifies what the browser hands back.
 */

const CREATE_ORDER_TIMEOUT_MS = 6000;
const FETCH_PAYMENT_TIMEOUT_MS = 6000;
const RAZORPAY_API = "https://api.razorpay.com/v1";

export type ProviderMode = "razorpay" | "dev" | "unavailable";

function keys(): { keyId: string; keySecret: string } | null {
  const keyId = (process.env.RAZORPAY_KEY_ID ?? "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET ?? "").trim();
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export function razorpayConfigured(): boolean {
  return keys() !== null;
}

/** Publishable key handed to checkout.js. Null unless real keys are configured. */
export function razorpayKeyId(): string | null {
  return keys()?.keyId ?? null;
}

export function providerMode(): ProviderMode {
  if (keys()) return "razorpay";
  return process.env.NODE_ENV === "production" ? "unavailable" : "dev";
}

function basicAuth(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export interface ProviderOrderResult {
  providerOrderId: string | null;
  /** Failure code when no order could be allocated. */
  code: string | null;
  mode: ProviderMode;
}

export async function createProviderOrder(opts: {
  reference: string;
  amountCents: number;
  currency: string;
}): Promise<ProviderOrderResult> {
  const mode = providerMode();

  if (mode === "unavailable") {
    return { providerOrderId: null, code: "PROVIDER_NOT_CONFIGURED", mode };
  }

  if (mode === "dev") {
    // Local stand-in so the flow is testable without credentials. The id is
    // unguessable and carries no money meaning outside this deployment.
    return { providerOrderId: `dev_order_${randomBytes(10).toString("hex")}`, code: null, mode };
  }

  const { keyId, keySecret } = keys()!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_ORDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: {
        Authorization: basicAuth(keyId, keySecret),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // amount is the smallest currency unit (paise) — the same integer the
      // order row stores, so the capture amount check is an exact comparison.
      body: JSON.stringify({
        amount: opts.amountCents,
        currency: opts.currency,
        receipt: opts.reference,
        notes: { pk: opts.reference },
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      return {
        providerOrderId: typeof data.id === "string" && data.id ? data.id : null,
        code: data.id ? null : "PROVIDER_ORDER_NO_ID",
        mode,
      };
    }
    return { providerOrderId: null, code: `PROVIDER_ORDER_HTTP_${res.status}`, mode };
  } catch {
    return { providerOrderId: null, code: "PROVIDER_UNREACHABLE", mode };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the signature checkout.js returns after a successful payment:
 * `HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)`.
 *
 * This is the only thing standing between "the browser says it paid" and "the
 * provider says it paid" — a client cannot produce a valid value without the
 * secret, so a verified result is provider evidence, not a client claim.
 */
export function verifyCheckoutSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): boolean {
  const keySecret = keys()?.keySecret;
  if (!keySecret) return false;
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return false;
  const expected = createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(razorpaySignature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ProviderPaymentView {
  id: string;
  orderId: string | null;
  status: string;
  amount: number;
  currency: string;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

/** Read a payment straight from the provider (used to confirm before the webhook lands). */
export async function fetchProviderPayment(paymentId: string): Promise<ProviderPaymentView | null> {
  const creds = keys();
  if (!creds || !paymentId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_PAYMENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${RAZORPAY_API}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: basicAuth(creds.keyId, creds.keySecret), Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      id?: string;
      order_id?: string | null;
      status?: string;
      amount?: number;
      currency?: string;
      method?: string | null;
      error_code?: string | null;
      error_description?: string | null;
    };
    if (!d.id) return null;
    return {
      id: d.id,
      orderId: d.order_id ?? null,
      status: d.status ?? "",
      amount: Number(d.amount ?? 0),
      currency: (d.currency ?? "INR").toUpperCase(),
      method: d.method ?? null,
      errorCode: d.error_code ?? null,
      errorDescription: d.error_description ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
