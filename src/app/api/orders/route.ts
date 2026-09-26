import { NextRequest } from "next/server";
import { createOrder, recordIntegrationAudit, type CreateOrderInput } from "@/db/queries";
import { bindProviderOrderId, createPaymentRecord, isOnlinePayment } from "@/db/payments";
import { enqueuePosDelivery } from "@/integrations/pos/order-bridge";
import {
  createProviderOrder,
  providerMode,
  razorpayKeyId,
  type ProviderOrderResult,
} from "@/integrations/payments/provider-session";
import { orderTokensAvailable, signOrderToken } from "@/lib/order-token";

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
 */
export async function POST(req: NextRequest) {
  // Without a signing key no order would ever be readable by the customer who
  // just placed it, so this is refused up front rather than minting an order
  // whose only credential is an empty string.
  if (!orderTokensAvailable()) {
    return Response.json(
      { ok: false, error: "Checkout is temporarily unavailable", code: "ORDER_TOKENS_UNAVAILABLE" },
      { status: 503 },
    );
  }

  let body: CreateOrderInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  // Shape validation; all prices/totals are recomputed server-side from the DB.
  const phoneDigits = String(body?.phone ?? "").replace(/\D/g, "");
  const invalid =
    !body?.restaurantSlug ||
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    !body.customerName?.trim() ||
    !body.addressText?.trim() ||
    phoneDigits.length < 10;
  if (invalid) {
    return Response.json({ ok: false, error: "Missing or invalid required fields" }, { status: 400 });
  }
  body.phone = phoneDigits.slice(-10);

  const wantsOnline = isOnlinePayment(body.paymentMethod);
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

  const result = await createOrder(body);
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
      // The browser's only credential for this order from here on.
      orderToken: signOrderToken(result.order.code),
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
