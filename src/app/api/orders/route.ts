import { NextRequest } from "next/server";
import { bindOrderCodesToSession, createOrder, getOrderByCode, recordIntegrationAudit } from "@/db/queries";
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
import { appendCustomerSessionCookie, ensureCustomerSession, resolveCustomerSession } from "@/lib/customer-session";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { toPublicOrder } from "@/lib/order-public";
import { resolveAccountSession } from "@/lib/security/customer-account-session";
import { listOrdersByCustomerAccountId } from "@/db/customer-accounts";
import { hashInboxToken, recordOrderNotification } from "@/lib/customer-notifications";

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

  // Authenticated customer account required for placing orders.
  // Guest browsing/cart remain available; order placement requires sign-in.
  const accountSession = await resolveAccountSession(req);
  if (!accountSession) {
    return Response.json(
      {
        ok: false,
        error: "Please sign in or create an account to place your order.",
        code: "ACCOUNT_REQUIRED",
      },
      { status: 401 },
    );
  }

  // The raw inbox token is a browser capability: hash it once here and never
  // pass the plaintext into the order write. Stripping it also keeps the checkout
  // whitelist from widening the order insert surface.
  const { inboxToken, ...orderInput } = validated.request;
  const customerInboxHash = inboxToken ? hashInboxToken(inboxToken) : null;

  // Explicit/proven account link: attribute the new order to the signed-in account
  // (server-resolved, never client-trusted).
  const result = await createOrder({
    ...orderInput,
    customerInboxHash,
    customerAccountId: accountSession.account.id,
    // The URL claim is server-read; a client body value cannot replace it with
    // another restaurant's locality without also matching that restaurant.
    urlLocalityKey: req.nextUrl.searchParams.get("loc"),
  });
  if (!result.ok) {
    // Phase 7 — deterministic outlet errors surface as 422 (client sent a bad
    // branch/outlet claim), everything else stays a client 400.
    const status =
      result.code === "OUTLET_NOT_MAPPED" ||
      result.code === "INTEGRATION_NOT_CONNECTED" ||
      result.code === "OUTSIDE_SERVICE_AREA"
        ? 422
        : 400;
    return Response.json(result, { status });
  }

  // Best-effort: the order is already committed, so a notification failure must
  // not turn a successful checkout into an error. The emitter dedupes retries.
  await recordOrderNotification({ orderId: result.order.id, kind: "order_placed" });

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

  const orderToken = signOrderToken(result.order.code);
  const res = Response.json(
    {
      ...result,
      // The browser's code-bound access token for this order from here on.
      orderToken,
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

  // Bind here, in the same response that mints the order, rather than asking
  // the browser to call /attach afterwards: the cookie and the code land
  // together, so clearing localStorage cannot strand a freshly placed order.
  // Best-effort by design — the signed token above is still a complete
  // credential, so a session/DB hiccup must not report a placed order as failed.
  try {
    const ensured = await ensureCustomerSession(req);
    await bindOrderCodesToSession(ensured.session.id, [result.order.code]);
    if (ensured.expiresAt) appendCustomerSessionCookie(req, res, ensured.token, ensured.expiresAt);
  } catch {
    /* the order token remains the fallback credential for this browser */
  }
  return res;
}

const MAX_HISTORY_CODES = 30;

/**
 * Session-backed order history for this browser. Reads the codes bound to the
 * live anonymous customer session (set via POST /api/orders/attach) and returns
 * only the public projection. Missing or expired sessions yield an empty list,
 * never an error signal, and no codes beyond the session's bound set are read.
 */
export async function GET(req: Request) {
  const throttled = guardRead(req, "orderLookup");
  if (throttled) return throttled;

  const accountSession = await resolveAccountSession(req);

  // Signed-in: account-linked orders only. Device/anonymous session orders are
  // not mixed in to prevent cross-customer leakage on shared browsers.
  if (accountSession) {
    const linked = await listOrdersByCustomerAccountId(accountSession.account.id, MAX_HISTORY_CODES);
    const loaded = await Promise.all(linked.map((row) => getOrderByCode(row.code)));
    const orders = loaded
      .filter((o): o is NonNullable<typeof o> => Boolean(o))
      .map((o) => toPublicOrder(o))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return Response.json({ orders: orders.slice(0, MAX_HISTORY_CODES) });
  }

  // Guest/legacy: session-backed history for this browser only.
  const session = await resolveCustomerSession(req);
  if (!session?.orderCodes.length) return Response.json({ orders: [] });
  const codes = session.orderCodes.slice(0, MAX_HISTORY_CODES);
  const loaded = await Promise.all(codes.map((code) => getOrderByCode(code)));
  const orders = loaded
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .map((o) => toPublicOrder(o))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return Response.json({ orders: orders.slice(0, MAX_HISTORY_CODES) });
}
