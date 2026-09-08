import crypto from "node:crypto";

/**
 * PHASE 24 — Razorpay gateway integration.
 *
 * Lazy singleton client (per-serverless-instance) so the SDK is only
 * initialized when actually used. All amounts are handled in paise (₹
 * subunits) on the wire and converted to/from INR dollars at the boundary.
 */

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

export const razorpayEnabled = Boolean(
  RAZORPAY_KEY_ID &&
    RAZORPAY_KEY_SECRET &&
    !RAZORPAY_KEY_ID.startsWith("rzp_test_XXX"),
);

export function requiresRazorpay(): string | null {
  if (razorpayEnabled) return null;
  return "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your environment.";
}

let clientPromise: Promise<any> | null = null;

export function getRazorpayClient(): Promise<any> {
  if (!razorpayEnabled) {
    throw new Error("Razorpay is not configured");
  }
  if (!clientPromise) {
    clientPromise = import("razorpay").then(
      ({ default: Razorpay }) =>
        new Razorpay({
          key_id: RAZORPAY_KEY_ID,
          key_secret: RAZORPAY_KEY_SECRET,
        }),
    );
  }
  return clientPromise;
}

/** INR dollars → paise (Razorpay order amounts are integer subunits). */
export function toPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

/** Paise → INR dollars. */
export function fromPaise(amountPaise: number): number {
  return amountPaise / 100;
}

export interface RazorpayOrderOptions {
  amountInr: number;
  reference: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
}

export type CreateRazorpayOrderResult =
  | {
      ok: true;
      razorpayOrderId: string;
      amountPaise: number;
      currency: string;
    }
  | { ok: false; error: string };

/**
 * Create a Razorpay order for a marketplace order. Returns the
 * `razorpay_order_id` the client checkout needs to open the modal.
 */
export async function createRazorpayOrder(
  opts: RazorpayOrderOptions,
): Promise<CreateRazorpayOrderResult> {
  const missing = requiresRazorpay();
  if (missing) return { ok: false, error: missing };

  try {
    const client = await getRazorpayClient();
    const amountPaise = toPaise(opts.amountInr);

    const params: Record<string, unknown> = {
      amount: amountPaise,
      currency: "INR",
      receipt: opts.reference,
      notes: {
        orderReference: opts.reference,
        customerName: opts.customerName,
        customerPhone: opts.customerPhone,
        customerEmail: opts.customerEmail ?? "",
      },
    };

    const order = await client.orders.create(params);

    return {
      ok: true,
      razorpayOrderId: String(order.id),
      amountPaise: Number(order.amount) ?? amountPaise,
      currency: String(order.currency ?? "INR"),
    };
  } catch (e) {
    console.error("[razorpay] createOrder failed", e);
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? `Razorpay: ${e.message}`
          : "Razorpay: failed to create payment order",
    };
  }
}

export interface VerifySignatureInput {
  /**
   * `razorpay_order_id` the signature was generated for. Used to locate the
   * expected amount and cross-check the signature string.
   */
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  expectedAmountInr: number;
  /** Amount in paise, computed from expectedAmountInr. */
}

/**
 * Verify the HMAC-SHA256 signature returned by Razorpay's checkout after
 * payment:
 *
 *   string = order_id + "|" + payment_id
 *   digest = HMAC_SHA256(string, key_secret)
 *
 * Also cross-checks that the paid order amount matches what we created the
 * payment for, so a tampered/mismatched amount is rejected.
 */
export function verifyRazorpaySignature(
  input: VerifySignatureInput,
): { ok: true } | { ok: false; error: string } {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;

  if (!RAZORPAY_KEY_SECRET) {
    return { ok: false, error: "Razorpay key secret is not configured" };
  }
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return {
      ok: false,
      error: "Missing razorpay signature components",
    };
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  const actual = razorpaySignature;

  if (expected.length !== actual.length) {
    return { ok: false, error: "Payment signature mismatch (length)" };
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, error: "Payment signature mismatch" };
  }

  return { ok: true };
}

/**
 * Fetch a payment from Razorpay so we can reconcile the *captured* amount
 * with what we expected. Returns true when the payment is authorized or
 * captured and its amount (paise) matches.
 */
export async function reconcileRazorpayPayment(
  razorpayPaymentId: string,
  expectedAmountInr: number,
): Promise<
  | { ok: true; captured: boolean; amountPaise: number }
  | { ok: false; error: string }
> {
  try {
    const client = await getRazorpayClient();
    const payment = await client.payments.fetch(razorpayPaymentId);
    const paidPaise = Number(payment.amount);
    const captured =
      payment.status === "captured" || payment.status === "authorized";

    if (!captured) {
      return {
        ok: false,
        error: `Payment not captured (status: ${payment.status})`,
      };
    }
    if (paidPaise !== toPaise(expectedAmountInr)) {
      return {
        ok: false,
        error: `Payment amount mismatch: expected ₹${expectedAmountInr.toFixed(2)}, paid ₹${(paidPaise / 100).toFixed(2)}`,
      };
    }
    return { ok: true, captured, amountPaise: paidPaise };
  } catch (e) {
    console.error("[razorpay] reconcile failed", e);
    return {
      ok: false,
      error:
        e instanceof Error ? `Razorpay: ${e.message}` : "Razorpay: reconcile failed",
    };
  }
}

/**
 * Refund a captured payment. `amountInr` is optional — when omitted the full
 * captured amount is refunded.
 */
export async function refundRazorpayPayment(
  razorpayPaymentId: string,
  amountInr?: number,
): Promise<
  | { ok: true; refundId: string; refundAmountPaise: number }
  | { ok: false; error: string }
> {
  const missing = requiresRazorpay();
  if (missing) return { ok: false, error: missing };
  if (!razorpayPaymentId) return { ok: false, error: "Missing payment id" };

  try {
    const client = await getRazorpayClient();
    const params: Record<string, unknown> = {};
    if (amountInr !== undefined) {
      params.amount = toPaise(amountInr);
    }
    const refund = await client.payments.refund(razorpayPaymentId, params);

    return {
      ok: true,
      refundId: String(refund.id),
      refundAmountPaise: Number(refund.amount) ?? 0,
    };
  } catch (e) {
    console.error("[razorpay] refund failed", e);
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? `Razorpay: ${e.message}`
          : "Razorpay: refund failed",
    };
  }
}

/** Verify a Razorpay webhook signature (X-Razorpay-Signature header). */
export function verifyRazorpayWebhookSignature(
  payload: string,
  signature: string,
): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}