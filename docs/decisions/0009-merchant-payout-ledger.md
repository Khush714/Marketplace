# ADR-0009: Owner payouts use a priced ledger and approval outbox before any transfer

- **Status:** Accepted
- **Date:** 2026-11-28
- **Related:** `docs/decisions/0001-marketplace-tenancy.md`,
  `docs/decisions/0004-payment-idempotency.md`,
  `docs/decisions/0005-durable-delivery-journal.md`,
  `src/lib/payout-core.ts`, `src/lib/merchant-payout-feed.ts`,
  `src/db/merchant-payouts.ts`,
  `src/db/migrations/20261128_merchant_payout_ledger.sql`,
  `src/app/api/integration/merchant/payouts/*`

## Context

Marketplace owns the money: signature-verified Razorpay captures, refunds and
platform-fee snapshots are already authoritative, and `lib/merchant-settlements.ts`
projects them into a read-only Merchant feed. Restaurant owners need automatic
payouts on a cycle they choose. Merchant already has a manual payout ledger and
an optional upstream payout mirror, but it does not — and must not — initiate a
bank transfer.

A payout is a new money movement with different failure modes from a payment
capture. It needs its own durable identity, an exact settlement allocation, a
human approval step, and a replay-safe processor boundary. It must never be
possible for a retry, a clock change, or two overlapping cycles to pay the same
captured payment twice.

## Decision

Introduce a Marketplace-owned payout domain in five tables:

- `merchant_payout_settings` — one owner-selected cycle per restaurant.
- `merchant_payout_batches` — one immutable money snapshot per closed window.
- `merchant_payout_batch_lines` — the priced settlement allocations.
- `merchant_payout_outbox` — durable intent for a future processor.
- `merchant_payout_events` — append-only lifecycle history.

### Cycle policy

Payout cycles are `weekly`, `fortnightly` and `monthly`. The ambiguous term
`biweekly` is rejected. Weekly uses the previous fully closed Monday-to-Monday
UTC window; monthly uses the previous calendar month; fortnightly uses 14-day
windows anchored to Monday `2026-01-05`. Only the most recent fully closed
window is priced, so an in-progress period can never be partly paid.

### Eligibility and money math

A settlement is payable only when it is signature-verified, in an INR paid or
partially-refunded status, has a capture time inside the closed window, and has
safe integer-paise amounts whose net equals
`gross - commission - refund + adjustment`. Zero or negative net, wrong
currency, missing capture time, unverified captures and already-allocated
settlements are excluded with a reason. The preview and the batch use the same
pure builder in `lib/payout-core.ts`, so the numbers shown to the owner are the
numbers frozen in the ledger.

### Double-pay guard

`merchant_payout_batch_lines` has a unique index on
`(restaurant_id, settlement_external_id)`. A settlement can therefore appear in
at most one batch for a restaurant, regardless of which cycle pricing job raced
or which historical window is replayed. Batch identity is
`(restaurant_id, idempotency_key)` where the key is `cycle:period-start-date`;
a replay with the same money checksum returns the stored batch, while changed
money is a 409 conflict, never a second payable batch.

### Approval boundary

`POST /api/integration/merchant/payouts/batches` freezes a preview; no money is
moved. `POST /api/integration/merchant/payouts/batches/[reference]/approve`
requires the exact checksum from that preview. Inside one locked transaction,
Marketplace reprices the closed window excluding only this batch's own lines,
requires the checksum and totals to match, moves `PREVIEW → APPROVED`, then
inserts one idempotent outbox row and one event. All Merchant integration routes
use the existing business-scoped bearer token and `merchantServiceRead` /
`merchantServiceWrite` budgets. Tenant identity always comes from the token,
never the body or URL.

### No transfer yet

The outbox row is a durable intention only. There is deliberately **no** drain
cron, payout processor, bank-transfer adapter, UTR write path, or reconciliation
loop in this slice. `merchantPayoutOutbox` exists so the first real processor can
follow the journal-before-send pattern of ADR-0005, but nothing consumes it.
The Merchant payout feed maps only `APPROVED`, `PROCESSING`, `PAID` and `FAILED`
batches and stays `available:false` until approval; previews, cancellations, raw
bank/UPI destinations and sealed ciphertext never cross that boundary.

## Consequences

**Positive**

- The exact settlements and amounts an owner approved can be replayed and
  proven from the ledger checksum.
- A double payout is rejected by a database constraint, not just application
  discipline.
- Approval is fail-closed: stale money, a changed cycle, or a wrong checksum
  cannot advance the batch.
- Merchant can mirror real payout status later without becoming authoritative.

**Negative / costs**

- Owners still cannot receive money until a provider adapter, cron and UTR
  reconciliation are built and approved.
- Repricing at approval needs another bounded settlement read; very large
  windows are refused rather than partially paid.
- The outbox will need the same retry/backoff and visibility rules as the POS
  delivery journals before a processor is enabled.

## Follow-up work

1. Verify the provider is eligible for business disbursements, and get
   tax/compliance sign-off on deductions, TDS/GST handling and payout statements.
2. Add a processor that claims `PENDING` outbox rows with `FOR UPDATE SKIP LOCKED`
   and calls a separate payout provider adapter with its own credentials.
3. Add a provider webhook or poll for UTR, then a reconciliation classifier that
   only records exceptions and never invents a payout.
4. Done: cycle settings, preview, batch creation and approval are exposed in the
   Merchant owner Payouts tab behind `finance.write`, with audited proxy routes
   at `/api/merchant/payout-automation/*`.
5. Apply `20261128_merchant_payout_ledger.sql` before using any of these routes.
