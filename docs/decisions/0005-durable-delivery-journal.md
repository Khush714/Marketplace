# ADR-0005: Marketplace→POS delivery is a durable, idempotent at-least-once journal

- **Status:** Accepted (retrospective — records an existing design)
- **Date:** 2026-10-09
- **Related:** `docs/architecture.md` §6, `src/db/pos-delivery.ts`,
  `src/db/payment-delivery.ts`, `src/integrations/pos/order-bridge.ts`,
  `src/integrations/pos/payment-bridge.ts`, `src/instrumentation.ts`,
  `src/lib/queue-health.ts`, `vercel.json`

## Context

An accepted order must reach the restaurant's POS, and a captured/refunded payment
must be mirrored to it. But the marketplace→POS call is an **unreliable network
hop**: the POS can be down, slow, or mid-deploy. Two prior failure modes were
observed:

1. **Fire-and-forget on serverless.** The first POS attempt used to be an
   unawaited `POST`. On Vercel the instance is frozen/terminated once the response
   flushes, so the request died mid-flight and the row stayed `PENDING` — the
   customer saw a placed order the kitchen never received. The retry loop could
   not save it because the drain is an `unref()`'d interval that only runs in a
   resident process, which a serverless instance is not.
2. **Invisible terminal failure.** A delivery that exhausted retries landed as
   terminal `FAILED` with no signal — the customer saw an order that never
   arrived and nobody was alerted.

The POS itself is idempotent on a stable external order id, and dedupes inbound
webhooks on a stable event id, so **at-least-once** delivery is the safe contract
if the consumer is idempotent and the producer records intent durably.

## Decision

**Persist intent first, then attempt; drain durably; make failures visible.**

1. **Journal-before-send.** Checkout writes a `marketplace_pos_order_deliveries`
   row (`enqueueOrderDelivery`) keyed UNIQUE on `marketplace_order_id`; the
   payment bridge mirrors the same shape in
   `marketplace_pos_payment_deliveries`, keyed UNIQUE on `event_id`. If the row
   exists, no duplicate is created.

2. **First attempt is awaited.** `enqueuePosDelivery` performs the first attempt
   **inside the request lifetime** (durability comes from the journal row, not the
   attempt). A timeout or POS outage leaves a `PENDING` row for the drain; the
   customer is never told "placed" before the kitchen has it.

3. **Exactly-once per row per pass.** Drains select due rows with
   `FOR UPDATE SKIP LOCKED` and claim each attempt atomically
   (`claimPosDeliveryAttempt` bumps `attempts` only while `status = 'PENDING'`), so
   concurrent drains never double-send.

4. **Retry policy.** `PENDING → DELIVERED | FAILED`. Retryable failures back off
   ×4 from 4 s with 0–30 % jitter up to 5 attempts; deterministic failures
   (401/403/422, exhausted attempts) go terminal immediately.

5. **Terminal order failure = refund intent.** `recordPosDeliveryFailure` marks
   `orders.pos_delivery_status = FAILED` **first**, then (if money was captured)
   persists the refund settlement (`REFUND_PENDING` / `PAYMENT_CANCELLED`) before
   returning. Only the provider HTTP call is detached, and it is idempotent via
   the ledger.

6. **Drains run where the host allows.** In-process loop in
   `src/instrumentation.ts` (skipped on Vercel), plus scheduled
   `/api/cron/pos-drain` and `/api/cron/payments-drain`, plus an ops endpoint and
   an internal cron route.

7. **Observability.** `lib/queue-health.ts` reports pending/delivered/failed and
   `oldestPendingAgeSeconds` per journal, and states whether this host needs a
   scheduler — a growing oldest-pending age is the signal that the schedule is not
   firing.

## Consequences

**Positive**
- No order is silently lost to a crash, a cold instance, or a POS hiccup.
- Duplicate sends are harmless (stable ids, POS-side dedup).
- A charged order that cannot be delivered triggers a durable refund intent.
- A broken drain schedule is detectable.

**Negative / costs**
- Two journals to maintain and two drains to schedule.
- `PENDING` is normal on serverless for up to one interval, so operators must read
  `oldestPendingAgeSeconds`, not just the count.
- The order payload must reproduce the exact billed line totals (unit price ×
  quantity equals the line total) or money drifts between systems.

## Alternatives considered

- **Synchronous delivery only (no journal).** Rejected: a POS outage would fail or
  lose the order.
- **Kafka/SQS-style external queue.** Rejected as over-provisioning: the database
  is already present, transactional with the order write, and sufficient at this
  volume; `SKIP LOCKED` gives safe concurrent consumption.
- **Keep fire-and-forget first attempt.** Rejected: proven to lose orders on
  serverless.
- **Retry forever.** Rejected: some failures are deterministic; a bounded budget
  plus a visible terminal state is better than an infinite loop.

## Notes for future work

- The POS idempotency contract (`mkt_ord_<id>`, `PAY-…:<event>`) is load-bearing;
  changing it requires coordinating both sides.
- `pos_deliveries_status_attempt_idx` and
  `pos_payment_deliveries_status_attempt_idx` serve the drains; keep them.
