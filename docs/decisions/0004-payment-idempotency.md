# ADR-0004: Payments are provider-evidenced, idempotent, and reconciled, never browser-trusted

- **Status:** Accepted (retrospective — records an existing design)
- **Date:** 2026-10-09
- **Related:** `docs/architecture.md` §5, `src/db/payments.ts`,
  `src/lib/payment-security-core.ts`, `src/integrations/payments/*`,
  `src/app/api/integrations/payments/webhook/route.ts`,
  `src/db/migrations/20261007_payment_signature_verification.sql`

## Context

The marketplace takes money for orders it does not itself fulfil. Two failure
modes dominate payment systems:

1. **Client-trusted success.** If a browser saying "it worked" could mark an order
   paid, an attacker pays nothing and eats for free.
2. **Ambiguous at-least-once delivery.** Providers redeliver webhooks, out of
   order and repeatedly. A capture redelivered after a later failure, or a failure
   redelivered after a capture, must not corrupt the recorded state.

Additional constraints:

- The marketplace **owns** the money state and *mirrors* it to the POS; the POS
  must never be the source of truth for captures.
- Customers retry after card declines, so a `FAILED` attempt must remain
  resumable.
- Amounts are integer paise and must match the order exactly.

## Decision

**`channelVerifiesSignature` (in `payment-security-core.ts`) is the trust gate.**
A payment becomes `PAID` only on provider evidence whose signature this server
verified with a secret the client never holds:

```
browser says SUCCESS ──✗──▶ PAID
provider says SUCCESS ──▶ signature verified ──▶ PAID
```

Concretely:

1. **Per-row provenance.** `marketplace_payments.signature_verified` records
   whether the status currently on the row was reached through a
   signature-verified channel. Channels: `webhook` (HMAC over raw bytes),
   `checkout` (checkout.js `order_id|payment_id|signature` HMAC, then money facts
   re-read from the provider API), `dev` (local stand-in that **never** asserts
   verification and is unreachable in production).

2. **Idempotent event ledger.** `applyProviderPaymentEvent` inserts the provider
   `event_id` into `marketplace_payment_events` first
   (`ON CONFLICT (event_id) DO NOTHING`). A replay is acknowledged; if a same-id
   event arrives with a different `payload_hash`, it is a **replay conflict**
   rather than a silent dedupe.

3. **Amount and currency verified against the order.** A capture whose amount or
   currency does not match `orders.total_cents` fails the payment
   (`PAYMENT_AMOUNT_MISMATCH` / `PAYMENT_CURRENCY_MISMATCH`) and **never** marks
   it paid.

4. **Retry-safe state machine.** `paymentStatusAllowsRetry` permits rebinding a
   provider payment id only while the row is `UNPAID | PAYMENT_PENDING | FAILED`.
   Once captured / refunding, a late `payment.failed` is `PAYMENT_ALREADY_SETTLED`
   and a superseded attempt is `PAYMENT_ATTEMPT_SUPERSEDED` — captured money is
   never downgraded or rebound.

5. **`FAILED` stays live.** `getActivePaymentByOrder` includes `FAILED`, so a
   declined attempt is found again by resume paths.

6. **Refunds only on provider confirmation.** `markRefundRequested` persists
   `REFUND_PENDING` *before* any provider call; `refund.completed`/`processed`
   webhooks advance `refunded_amount_cents` and set `REFUNDED` /
   `PARTIALLY_REFUNDED`. The marketplace never invents a refund.

7. **Reconciliation surfaces, never mutates.** `reconcilePayments` runs six checks
   (`STALE_PAYMENT_PENDING`, `REFUND_STUCK`, `POS_PAYMENT_MISSING`,
   `POS_PAYMENT_DELIVERY_FAILED`, `AMOUNT_MISMATCH`, `ORPHAN_EVENT`) and appends
   one `PAYMENT_RECONCILED` audit row with counts and exceptions.

## Consequences

**Positive**
- A browser claim can never become `PAID`; every captured row is provable from its
  own `signature_verified` flag.
- Webhook redelivery, out-of-order delivery and duplicate captures are safe.
- Decline→retry works without opening a hole for a stale failure to un-pay a
  capture.
- Refund intent is durable across crashes.

**Negative / costs**
- The payment state machine is more states than a naive flow and callers must use
  the shared predicates (`isPaidStatus`, `PAYMENT_STATUSES`) rather than string
  literals.
- `dev` mode drives the same state machine without money, so it must remain
  impossible in production (`providerMode()`).
- Reconciliation is an operator-visible report, not a self-healing job; it needs a
  schedule and an owner to act on exceptions.

## Alternatives considered

- **Trust the checkout callback.** Rejected: client-controlled money.
- **Store only the final status, no ledger.** Rejected: no way to prove/deny a
  replay or detect a payload conflict.
- **Let the POS own captures.** Rejected: the marketplace is the collection point
  and must own the money state.
- **Auto-refund on any exception.** Rejected: the marketplace must not invent
  provider money movement; it persists intent and waits for confirmation.

## Notes for future work

- `marketplace_payments_provider_payment_idx` and `..._provider_order_idx` are the
  bindings that make dedupe and capture-resolution correct; preserve them.
- Multi-currency is out of scope; `currency` is expected `INR`.
