import { NextRequest } from "next/server";
import { createOrder, recordIntegrationAudit } from "@/db/queries";
import { bindProviderOrderId, createPaymentRecord, isOnlinePayment } from "@/db/payments";
import { validateCheckout, type CheckoutResult } from "@/lib/order-input-core";
import { enqueuePosDelivery } from "@/integrations/pos/order-bridge";
import {
  createProviderOrder,
  providerMode,
  razorpayKeyId,
  type ProviderOrderResult,
} from "@/integrations/payments/provider-session";
import { orderTokensAvailable, signOrderToken } from "@/lib/order-token";
import { guardWrite, readJsonBody } from "@/lib/abuse";

export const dynamic = "force-dynamic";

/**
 * Checkout. The order is created FIRST and the payment second — an online
 * order is held out of the POS (`PAYMENT_PENDING`) until the provider confirms
 * the capture, so nothing reaches the kitchen for an order nobody paid for.
 *
 * The response carries everything the browser needs to drive provider checkout:
 * the provider order id, the publishable key, and the order's access token.
 * A failed provider allocation is reported, not swallowed: the order stays
 * payable via POST /api/orders/[code]/pay/start instead of being lost.
 *
 * The request itself is never handed to createOrder as received: it is
 * validated and rebuilt from a whitelist by validateCheckout (quantities, cart
 * size and the payment method are rejected outright when out of policy, and
 * client price/restaurant fields are never carried through). All totals are
 * recomputed server-side from the DB regardless.
 */
export async function POST(req: NextRequest) {
  // Unauthenticated and expensive: this route writes a row, allocates a real
  // provider order and enqueues a delivery event, so it is both the most
  // attractive thing to spam and the most expensive to serve. Budgeted before
  // any parsing or database work. See ABUSE_BUDGETS.checkout for why the limit
  // is sized for shared mobile IPs rather than for the attack rate.
  const blocked = await guardWrite(req, "checkout");
  if (blocked) return blocked;

  try {
    return await checkout(req);
  } catch (e) {
    // A thrown DB/driver error would otherwise surface as Next's HTML error
    // page, which the checkout page cannot read and which Safari reports as a
    // DOMException ("The string did not match the expected pattern"). Always
    // answer with JSON so the browser shows the real failure.
    console.error("[orders] checkout failed:", e);
    return Response.json(
      { ok: false, error: "Something went wrong placing your order. Please try again.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

async function checkout(req: NextRequest) {
  // Without a signing key no order would ever be readable by the customer who
  // just placed it, so this is refused up front rather than minting an order
  // whose only credential is an empty string.
  if (!orderTokensAvailable()) {
    return Response.json(
      { ok: false, error: "Checkout is temporarily unavailable", code: "ORDER_TOKENS_UNAVAILABLE" },
      { status: 503 },
    );
  }

  let validated: CheckoutResult;
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    // Rebuild from a whitelist: required fields, then cart (empty, per-line
    // quantity, cart size), then payment method. The result carries no client
    // price or restaurant-name fields at all.
    validated = validateCheckout(parsed.body);
  }
  if (!validated.ok) {
    return Response.json(
      { ok: false, error: validated.error, code: validated.code },
      { status: 400 },
    );
  }

  const wantsOnline = isOnlinePayment(validated.request.paymentMethod);
  if (wantsOnline && providerMode() === "unavailable") {
    // Refuse BEFORE creating anything: an order that can never be paid for is an
    // order that can never reach the kitchen, and the customer should be told to
    // use cash on delivery rather than discovering it on a payment screen.
    return Response.json(
      {
        ok: false,
        error: "Online payment is unavailable right now. Please choose cash on delivery.",
        code: "PROVIDER_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const result = await createOrder(validated.request);
  if (!result.ok) {
    // Phase 7 — deterministic outlet errors surface as 422 (client sent a bad
    // branch/outlet claim), everything else stays a client 400.
    const status =
      result.code === "OUTLET_NOT_MAPPED" || result.code === "INTEGRATION_NOT_CONNECTED" ? 422 : 400;
    return Response.json(result, { status });
  }

  // Phase 6 — payment lifecycle. Online methods open a PAYMENT_PENDING record
  // and the order is HELD out of the POS until the provider confirms the
  // capture (payments/webhook → coordinateCaptureDelivery). COD/cash stay
  // UNPAID and ship to the POS immediately (collection is the POS cash flow).
  const online = isOnlinePayment(result.order.paymentMethod);
  const payment = await createPaymentRecord({
    order: result.order,
    paymentMethod: result.order.paymentMethod,
  });

  let session: ProviderOrderResult = { providerOrderId: null, code: null, mode: providerMode() };
  if (online) {
    // Allocate the provider ORDER that the capture webhook will resolve.
    session = await createProviderOrder({
      reference: payment.reference,
      amountCents: result.order.totalCents,
      currency: "INR",
    });
    if (session.providerOrderId) {
      await bindProviderOrderId(payment.reference, session.providerOrderId);
    } else {
      await recordIntegrationAudit(result.order.restaurantId, "PAYMENT_EXCEPTION", { actor: "system" }, {
        order_id: result.order.id,
        external_order_id: result.order.externalOrderId,
        payment_reference: payment.reference,
        failure_code: session.code,
        failure_message: "provider order allocation failed; order awaits a payment retry",
      });
    }
  }

  if (!online) {
    // Phase 4 — durable at-least-once POS delivery. Journaled synchronously so
    // the checkout response is never blocked on the POS; the retry worker owns
    // the actual POST (immediate attempt + backoff drain until DELIVERED/FAILED).
    await enqueuePosDelivery(result.order.id);
  }

  return Response.json(
    {
      ...result,
      // The browser's code-bound access token for this order from here on.
      orderToken: signOrderToken(result.order.code),
      // `result` also carries the Phase 6 trackingToken on a fresh order — the
      // customer's URL becomes /order/<tracking-token>. Omitted on an
      // idempotent retry, when only the hash exists and the browser already
      // received the plaintext the first time.
      payment: {
        reference: payment.reference,
        provider: online ? "razorpay" : "cash",
        providerOrderId: session.providerOrderId,
        keyId: online ? razorpayKeyId() : null,
        amountCents: result.order.totalCents,
        currency: "INR",
        method: result.order.paymentMethod,
        status: payment.status,
        mode: session.mode,
        /** Set when the provider order could not be allocated — retryable. */
        error: session.code,
      },
    },
    { status: 201 },
  );
}
