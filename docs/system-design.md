# System Design

Status: living document (Phase 1). Describes **what the Marketplace is and why it
is shaped this way**, not how each module is implemented — that is
`architecture.md`. Read this first; it is the map, not the terrain.

The system is a single Next.js application that sits **between diners and
restaurant point-of-sale (POS) systems**. It is not the POS and it does not cook
or delivery food; it takes an order, takes the money, and hands the order to the
restaurant's POS, which then owns fulfilment status.

---

## 1. Purpose

Provide a public food-ordering marketplace where:

- **Customers** discover restaurants, order, pay online (or choose cash on
  delivery), and track their order.
- **Restaurant partners** list a restaurant, keep a menu in sync with their POS,
  connect the POS to the marketplace, and manage the relationship.
- **The restaurant's POS** is the fulfilment authority: it receives orders,
  accepts/rejects them, and reports lifecycle status back.

The marketplace mirrors the POS for menu, order and payment data. The POS remains
the source of truth for **catalogue** (menu, price, availability) and
**fulfilment** (order lifecycle). The marketplace is the source of truth for
**the customer order record** and **the money** (payment state, refunds).

## 2. Actors

| Actor | Authenticates as | What they can do |
|---|---|---|
| **Customer** | Anonymous; holds an `HttpOnly` customer-session cookie + per-order signed token | Browse, search, view menu, compute bill, place order, pay, read/cancel their own orders, follow a tracking link |
| **Restaurant partner** | Partner session (owner key → session exchange) | View/edit own restaurant, own menu, integration connect/verify/rotate, delete intent |
| **POS (external system)** | Bearer integration session (passkey login) | Fetch its orders, pull identity, rotate passkey, be pushed orders/payments, push signed status/menu webhooks |
| **Operations / admin** | Ops token (`x-ops-token`) or cron secret | Mint/read/revoke onboarding codes, drain delivery queues, reconcile payments, approve integration transfers, probe POS bridge, feature restaurants |
| **Payment provider** | HMAC-signed webhook / checkout signature | Report captures, failures and refund lifecycle |
| **Scheduler** | Cron secret | Trigger the two delivery-drain endpoints on serverless |

There are **no customer accounts**. The customer identity is a browser-bound
anonymous session plus a per-order bearer token. See ADR-0002.

## 3. Core workflows

### 3.1 Discover and browse
Listings surface only when **discoverable**: `is_active = true` **and** the
restaurant has at least one available menu item (`lib/discoverability.ts`). Direct
links still render an "empty menu" state, but an empty listing never occupies a
browse or featured slot. Discoverable is *not* the same as orderable (see 3.3).

### 3.2 Checkout (order creation)
`POST /api/orders`:
1. Validate input (`lib/order-input-core.ts`): bounded free text, server-enforced
   `acceptedTerms`, valid restaurant + item selection.
2. Recompute the bill server-side; reject if the client total disagrees.
3. Enforce the **ordering gate** (`lib/ordering-gate.ts`): in production a
   restaurant must have an **ACTIVE** POS integration, otherwise checkout is
   refused (`ORDERING_CLOSED_MESSAGE`). Failing closed beats accepting an order
   nothing can fulfil.
4. Idempotency: the client supplies `client_request_id`; retries return the same
   order rather than creating a duplicate (`orders.client_request_id` UNIQUE).
5. Create the order + a payment record (`PAYMENT_PENDING` for online, `UNPAID`
   for cash).
6. Enqueue POS delivery (§3.4) and issue the per-order signed token + tracking
   token.

### 3.3 Online payment
`POST /api/orders/[code]/pay/start` → allocate a provider order; the browser runs
the provider's checkout; `POST /api/orders/[code]/pay/verify` verifies the
checkout signature and re-reads the money facts from the provider. The
authoritative capture always arrives as a **provider webhook**
(`payment.captured`) and is applied idempotently. **A browser claim never marks
an order paid.** See ADR-0004.

### 3.4 POS order delivery
Every order eligible for POS delivery gets a durable journal row
(`marketplace_pos_order_deliveries`). The order bridge pushes a flat payload keyed
by a stable external order id (`mkt_ord_<id>`); the POS dedupes on it. Failures
retry with exponential backoff + jitter; deterministic failures (or exhausted
retries) go terminal `FAILED`, and a paid order that never reached the kitchen is
automatically marked for refund. See ADR-0005.

### 3.5 Order lifecycle (inbound)
The POS posts signed status webhooks (`order-accepted`, `order-cancelled`,
`order-rejected`, `order-status`). Each carries a stable `event_id`; the first
insert wins and replays are acknowledged without re-applying. Transitions are
forward-only and tenant/branch-scoped.

### 3.6 Order read, tracking and cancellation
An order code alone is **not** a credential. Access requires either the signed
`x-order-token` (minted at checkout) **or** a live customer session that has the
code bound to it. A separate unguessable **tracking token** powers the shareable
`/order/<tracking-token>` URL. Cancelling an order writes the order to
`CANCELLED` and, if money was captured, moves the payment into the refund path.

### 3.7 Partner onboarding and integration connect
Ops mints a single-use onboarding code; the partner redeems it to create/attach a
listing and receive an owner key. To go live, the partner connects the POS by
redeeming a POS-issued connection code; the marketplace upserts the integration
identity (restaurant → branch → outlet) and stores the POS webhook secret sealed
at rest (ADR-0003). Checkout only opens once the integration is **ACTIVE** with a
sealed secret.

### 3.8 Menu synchronisation
Menu, categories, items and modifiers are mirrored from the POS via signed menu
webhooks with a `menu_webhook_events` idempotency ledger. Minted marketplace ids
are echoed back on every replay so the POS stores stable mappings.

### 3.9 Refunds and reconciliation
Refunds are only confirmed by the provider. A reconciliation job
(`integrations/payments/reconcile.ts`) classifies divergences (stale pending
payments, stuck refunds, money that never reached the POS, amount mismatches,
orphan events) and **surfaces** them — it never invents a refund or forces a
capture.

## 4. Restaurant tenancy model

Tenancy is **restaurant-scoped**, not account-scoped. The `restaurants` row is
the tenant boundary:

- `restaurants.id` (serial) is the internal tenant key. Every child row
  (menu, orders, sessions, deliveries, payments, audit) carries `restaurant_id`.
- `restaurants.slug` is the public marketing handle.
- `restaurants.marketplace_id` (`rst_…`) is the server-minted, unguessable
  canonical external id the POS ecosystem treats as the stable restaurant id. It
  is UNIQUE and cannot be chosen by a partner; ownership transfer between
  listings goes through an ops-approved `integration_transfer_requests` row.
- `restaurants.owner_key_hash` and `restaurants.integration_passkey_hash` are two
  **separate** credentials on one tenant (console recovery vs POS login). Rotating
  the passkey does not affect the owner key.

Isolation rules:
- Every partner/menu/order query is scoped by `restaurant_id`; the security E2E
  suite includes an A/B cross-tenant isolation suite.
- Inbound POS webhooks resolve the tenant from the **stored integration binding**
  (restaurant + external order id), never from the request body.
- Branch/outlet claims are validated against the binding persisted at delivery
  time; a mismatched claim is acknowledged-but-skipped, not applied.

See ADR-0001.

## 5. Data sensitivity

| Class | Examples | Controls |
|---|---|---|
| **Credentials / secrets** | owner key, POS passkey, session tokens, order tokens, CSRF tokens, webhook secrets, DB password, provider secret | Hashed at rest (SHA-256) or sealed (AES-256-GCM); constant-time compare; never logged; `HttpOnly` cookies; secrets live in env, never in committed files |
| **Customer PII** | name, phone, full delivery address | Server-only; returned only to a holder of the order credential; full address is on the never-log list |
| **Financial** | payment amount, provider ids, refunds | Append-only ledgers; captured money changes only on provider evidence |
| **Operational** | audit trail, security events, queue counters | Structured JSON to stderr; aggregates only for ops health endpoints |
| **Public** | menu, prices, restaurant listings, tracking status | Served to anyone |

The never-log list is enforced centrally in `lib/security/security-events-core.ts`
(keys matched case/punctuation-insensitively, plus a value rule for
`postgres://` connection strings). Redaction runs inside the event builder, not at
call sites.

## 6. Payments

- **Owner:** the marketplace. Money facts are recorded here and *mirrored* to the
  POS through a delivery journal — never the reverse.
- **States:** `UNPAID · PAYMENT_PENDING · PAID · PARTIAL · FAILED ·
  REFUND_PENDING · PARTIALLY_REFUNDED · REFUNDED · PAYMENT_CANCELLED`
  (orthogonal to order lifecycle).
- **Trust rule:** `marketplace_payments.signature_verified` records whether the
  status was reached through a channel whose payload carried a signature this
  server checked with a secret the client does not hold. The dev stand-in never
  asserts verification.
- **Amount invariant:** a capture is verified against `orders.total_cents` in
  exact integer paise; a mismatch fails the payment and never marks it paid.
- **Provider:** Razorpay, with a `dev` stand-in reachable only outside
  production and an `unavailable` mode that refuses online checkout in production
  when unconfigured.

## 7. Integrations

| Integration | Direction | Mechanism |
|---|---|---|
| **POS order ingest** | outbound | HTTP `POST`, flat payload, stable external id, sealed webhook secret as the shared key |
| **POS payment push** | outbound | Delivery journal, deterministic event id, POS-side dedup |
| **POS order cancellation** | outbound | `order-cancel.ts` via the bridge |
| **Menu webhooks** | inbound | HMAC over raw body + timestamp skew; idempotent ledger |
| **Order status webhooks** | inbound | HMAC + event-id ledger; branch/outlet-scoped |
| **Connection-code verify/claim** | outbound | POS is authority; verify is non-consuming, claim is exactly-once |
| **Payment provider** | both | Provider order allocation outbound; signature-verified webhook inbound |

The POS base URL is validated: a loopback or unset `POS_BASE_URL` on a deployed
function is refused rather than silently failing (`lib/pos-bridge.ts`).

## 8. Availability requirements

- **Correctness over liveness for money and orders.** Checkout fails closed when
  a restaurant cannot fulfil; unsupported provider config refuses online payment.
- **At-least-once delivery with idempotent consumers.** Order/payment pushes and
  all inbound webhook applications are idempotent on a stable id.
- **Durability of intent.** Refund intent is persisted (REFUND_PENDING) before any
  provider HTTP call, so a crash never silently drops a refund.
- **Serverless-safe drains.** The in-process drain loop is skipped on Vercel;
  scheduled `/api/cron/*` endpoints are the reliable path there, and queue-health
  surfaces a missing schedule (`oldestPendingAgeSeconds`).
- **No single point of trust in the browser.** Credentials are server-minted,
  bounded, revocable and (where a cookie is used) `HttpOnly`.

## 9. Performance requirements

- **Edge-first cheap rejections.** Method/host/body-size/burst checks run in
  `proxy.ts` before routing or a DB connection.
- **Bounded work per request.** Per-route abuse budgets; capped JSON and raw
  bodies; capped search terms and slug lists; parameterised, indexed queries.
- **Indexed hot paths.** Composite/covering indexes for owner-key lookup,
  restaurant-scoped recency, journal drains (`FOR UPDATE SKIP LOCKED`) and session
  sweeps.
- **Client-side calm.** One shared performance classification
  (`full`/`balanced`/`low`) drives effect budgets; polling stops on hidden tabs,
  finished orders, and overlapping requests.

## 10. Out of scope

Deliberately not part of this system (documented so it is not mistaken for a
gap):

- Cooking, rider dispatch, routing or live courier tracking. The seeded
  `riderName`/elapsed-time timeline is a demo fallback for non-POS restaurants.
- Customer accounts, passwords, social login, loyalty.
- Being the POS: the marketplace does not own menus or fulfilment state.
- Multi-currency: INR only (`marketplace_payments.currency` is expected INR and
  an amount/currency mismatch fails the capture).
- Marketplace-level multi-region/active-active: one Postgres, one app
  deployment; horizontal scaling of the app is supported but shared state
  (rate-limit buckets, the unused in-memory integration store) is per-instance.
- In-app admin UI beyond the ops-token surface (`/ops`).
