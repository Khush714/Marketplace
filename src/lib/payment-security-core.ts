/**
 * Payment-channel trust decisions, as pure functions.
 *
 * Split from `db/payments.ts` for the same reason `abuse-core.ts` exists: the
 * decision is what is worth testing, and `server-only` modules cannot be
 * imported by `node --test`. Nothing here touches the network or the database.
 *
 * Phase 9's critical rule is that a payment becomes PAID only on provider
 * evidence, never on a browser claim:
 *
 *   browser says SUCCESS ──✗──▶ order PAID
 *   provider says SUCCESS ──▶ signature verified ──▶ order PAID
 *
 * `marketplace_payments.signature_verified` records, per row, whether the
 * status currently on it was reached through a channel whose payload carried a
 * signature this server checked with a secret the client does not have. It is
 * the audit answer to "who told us this money moved?" when the webhook and the
 * checkout callback disagree, or when a reviewer asks how a row became PAID.
 */

/**
 * The channel a provider event arrived on.
 *
 *   webhook     Razorpay POSTs the capture; `x-razorpay-signature` is an
 *               HMAC-SHA256 over the exact raw bytes, verified with
 *               RAZORPAY_WEBHOOK_SECRET before the event is applied.
 *   checkout    The browser hands back checkout.js's
 *               order_id|payment_id|signature triple; it is HMAC-verified with
 *               the key secret, bound to OUR provider order, and the money
 *               facts are then re-read from the provider's authenticated API.
 *               The signature is what makes the claim evidence.
 *   dev         The local stand-in: no keys, no signature, no money. Only
 *               reachable when NODE_ENV is not production (see
 *               `providerMode()`), and it must never assert verification.
 */
export type PaymentChannel = "webhook" | "checkout" | "dev";

/**
 * Whether events from this channel carry a signature this server can verify
 * with a secret the client never holds.
 *
 * `dev` is the whole point of the function: it is the one channel where the
 * "payment succeeded" input originates on the client side, so it must record
 * `signature_verified = false` even though it still drives the same state
 * machine (that is what makes the offline checkout flow exercisable). Every
 * other channel is refused outright unless the signature checked out.
 */
export function channelVerifiesSignature(channel: PaymentChannel): boolean {
  return channel !== "dev";
}

/**
 * Persisted payment statuses that mean "money is with us".
 *
 * Kept here rather than inlined at call sites so the checkout poller, the
 * success screen and the reconciliation job cannot drift into three different
 * definitions of paid.
 */
export const PAID_STATUSES = ["PAID", "CAPTURED"] as const;

/** Whether a persisted payment status counts as captured money. */
export function isPaidStatus(status: string): boolean {
  return (PAID_STATUSES as readonly string[]).includes(status.toUpperCase());
}

/**
 * Whether a provider payment status is authorized-but-not-captured — a
 * completed payment that only a capture will settle.
 *
 * Auto-capture is the provider account's choice; when it is off a payment
 * stops here. Both the checkout callback and the webhook use this to decide to
 * capture server-side (for the amount the provider reports), so a deployment
 * without a capture webhook still completes real payments. Kept pure and here
 * so the decision is testable without the network.
 */
export function isAuthorizedAwaitingCapture(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "authorized";
}
