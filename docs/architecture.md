# Architecture

Status: living document (Phase 1). Companion to `system-design.md` (the *what and
why*) and the `docs/decisions/` ADRs (the *why not something else*). This file is
the *how*: layers, runtime topology, the flows, and where each concern lives in
the tree.

Everything here describes the code **as it exists**. Where the architecture is
intentionally incomplete, it is called out in §12 rather than smoothed over.

---

## 1. Runtime shape in one picture

```
                       ┌──────────────────────────────────────────────┐
                       │                Browser                        │
                       │  React 19 client components, localStorage      │
                       │  (profile: name/phone/addresses, order tokens) │
                       │  Cookies: crave_restaurant_session,            │
                       │           crave_restaurant_csrf,               │
                       │           crave_customer_session               │
                       └───────────────┬────────────────────────────────┘
                                       │ HTTPS
              ┌────────────────────────▼─────────────────────────────┐
              │  src/proxy.ts  (Next.js Proxy / edge boundary)         │
              │  method allowlist · host allowlist · declared body cap │
              │  per-client burst ceiling · security headers · HSTS    │
              └────────────────────────┬─────────────────────────────┘
                                       │
   ┌───────────────────────────────────▼──────────────────────────────────┐
   │                     Next.js App Router (Node runtime)                  │
   │                                                                        │
   │  Page routes (RSC + client)          API routes (src/app/api/**)       │
   │  ─────────────────────────          ─────────────────────────────      │
   │  /  /restaurants  /checkout          /api/orders/*       (checkout)     │
   │  /order/*  /orders  /profile         /api/partner/*      (console)      │
   │  /partner/*  /ops  /refunds          /api/integration/*  (POS)          │
   │                                      /api/integrations/webhooks/* (POS) │
   │                                      /api/integrations/payments/webhook │
   │                                      /api/ops/*  /api/cron/*  /api/internal│
   │                                                                        │
   │  ┌──────────────── Business / security layer ──────────────────────┐   │
   │  │ lib/security/*   sessions, rate-limit, headers, events, errors  │   │
   │  │ lib/abuse*.ts    budgets, guardWrite/guardRead, capped bodies   │   │
   │  │ lib/order-*.ts   token, tracking, authorized, input validation  │   │
   │  │ lib/payment-*.ts payment trust decisions                        │   │
   │  │ lib/*-core.ts    pure, testable policy (no server-only marker)  │   │
   │  └─────────────────────────────────────────────────────────────────┘   │
   │  ┌──────────────── Data access layer ──────────────────────────────┐   │
   │  │ db/schema.ts (22 tables) · db/queries.ts · db/partner-menu.ts   │   │
   │  │ db/payments.ts · db/pos-delivery.ts · db/payment-delivery.ts    │   │
   │  │ db/menu-sync.ts · db/index.ts (drizzle + pg Pool)               │   │
   │  └─────────────────────────────────────────────────────────────────┘   │
   │  ┌──────────────── Integration layer ──────────────────────────────┐   │
   │  │ integrations/pos/*      outbound order/payment/menu/cancel      │   │
   │  │ integrations/payments/* provider order, refund, reconcile       │   │
   │  └─────────────────────────────────────────────────────────────────┘   │
   └──────────────┬───────────────────────────────┬─────────────────────────┘
                  │ SQL (pg, pooled)               │ HTTP (outbound)
          ┌───────▼────────┐              ┌───────▼──────────────────────┐
          │  PostgreSQL    │              │  POS (Restaurant AI)          │
          │  22 tables,    │              │  + Razorpay payment provider  │
          │  SQL migrations│              │  (inbound signed webhooks)    │
          └────────────────┘              └───────────────────────────────┘

   Background workers:
     • src/instrumentation.ts  — in-process drain loop (non-Vercel hosts only)
     • vercel.json crons       — /api/cron/pos-drain, /api/cron/payments-drain
     • /api/internal/pos-delivery-drain, /api/integrations/pos/drain (ops)
```

## 2. Layer responsibilities

| Layer | Responsibility | Key modules |
|---|---|---|
| **Edge boundary** | Reject cheap/obviously-hostile traffic before routing; attach security headers | `src/proxy.ts`, `lib/edge-policy-core.ts`, `lib/security/security-headers.ts`, `lib/security/rate-limit.ts` |
| **API / route handlers** | Parse, authorise, validate, orchestrate one use case | `src/app/api/**/route.ts` |
| **Business / security** | Session policy, abuse budgets, order authorisation, payment trust, input bounds | `lib/security/*`, `lib/abuse*.ts`, `lib/order-*.ts`, `lib/payment-security-core.ts`, `lib/ordering-gate.ts` |
| **Data access** | Typed queries and transactions; the only place that touches `db` | `src/db/*` |
| **Integration** | Talk to the POS and the payment provider; journals for at-least-once work | `src/integrations/**`, `lib/pos-bridge.ts`, `lib/webhook-crypto.ts` |
| **Workers** | Re-drive pending journals; scheduled on serverless | `src/instrumentation.ts`, `src/app/api/cron/*`, `lib/queue-health.ts` |

A deliberate convention: **`*-core.ts` modules are pure** (no `server-only`
marker, no DB, no network) so they can be unit-tested with `node --test`. The
server wiring lives beside them (`restaurant-session.ts` ↔
`restaurant-session-core.ts`, `abuse.ts` ↔ `abuse-core.ts`, `cron-auth.ts` ↔
`cron-auth-core.ts`, `integration-session-core.ts`, `customer-session-core.ts`,
`payment-security-core.ts`).

## 3. Authentication and authorisation

There is no single auth system; there are **six credential families**, each with
its own module and lifetime. They share the same primitives (`owner-key.ts` for
hashing/token minting, `lib/security/security-events.ts` for logging).

| Family | Credential | Module | Lifetime / revocation |
|---|---|---|---|
| **Partner console** | `crave_restaurant_session` HttpOnly cookie + paired `crave_restaurant_csrf` token | `lib/security/restaurant-session.ts`, `lib/restaurant-session-core.ts`, `lib/security/restaurant-auth.ts` | 30 days; `revokedAt`; CSRF required on writes; delete-confirm token is 10 min |
| **Owner key** | 18-byte recovery key, hashed (`owner_key_hash`) | `lib/owner-key.ts` | Long-lived; exchanged once for a partner session; rotates via `/api/partner/owner-key/rotate` |
| **POS integration** | `Authorization: Bearer` integration session (passkey login) | `db/queries.ts` (`createIntegrationSession`/`getIntegrationSession`), `app/api/integration/_auth.ts` | 60 min absolute + 30 min sliding idle; revocable per-session or per-restaurant |
| **POS passkey** | Secret, hashed (`integration_passkey_hash`, falls back to owner key) | `db/queries.ts` (`authenticateIntegration`), `lib/owner-key.ts` | Rotatable independently of the owner key |
| **Customer (anonymous)** | `crave_customer_session` HttpOnly cookie | `lib/customer-session.ts`, `lib/customer-session-core.ts` | 90 days, renew-on-attach; `order_codes` bound list; revocable |
| **Order access** | `x-order-token` HMAC (and, once fully wired, customer session) | `lib/order-token.ts`, `lib/order-authorized.ts`, `lib/order-tracking.ts` | Token lives as long as the order |
| **Ops / admin** | `x-ops-token` | `lib/ops-auth.ts`, `lib/security/admin-auth.ts` | Fail-closed in production when unset |
| **Cron** | `CRON_SECRET` and/or `x-ops-token`; `x-vercel-cron` accepted only on Vercel | `lib/cron-auth.ts`, `lib/cron-auth-core.ts` | Fail-closed; 503 when unconfigured |
| **Payment provider** | HMAC signature over raw body | `app/api/integrations/payments/webhook/route.ts`, `lib/webhook-crypto.ts`, `integrations/payments/provider-session.ts` | Per-event |
| **POS webhooks** | HMAC over raw body + timestamp skew, sealed secret | `lib/webhook-crypto.ts` | Per-event |

Authorisation is enforced **per route** by the first guard it calls; the full
route→guard table is in `baseline/architecture-inventory.md` §3. The recurring
guards:

- `guardWrite(req, scope)` / `guardRead(req, scope)` — origin (CSRF) check +
  per-route abuse budget (`lib/abuse.ts`, policy in `lib/abuse-core.ts`).
- `readJsonBody` / `readRawBodyCapped` — capped body parsing (`lib/abuse.ts`).
- `requirePartnerSession(req, { mutating })`, `authoriseMenu(req, mutating)`.
- `requireIntegrationAuth`, `requireOpsToken`, `requireAdmin`, `requireCronAuth`.

### 3.1 Restaurant (partner) sessions
The owner key used to *be* the session: replayed on every request, unexpiring,
unrevocable, and CSRF-protected only incidentally by the custom header. It is now
a **recovery credential** exchanged once for a bounded session row
(`restaurant_sessions`): `token_hash` (hashed at rest), `csrf_hash`,
`expires_at`, `revoked_at`, and `delete_confirm_hash`/`expires_at` for the one
destructive operation. The session cookie is `HttpOnly`; the CSRF cookie is
deliberately **not** `HttpOnly` (the page must read it to send the header, and a
cross-origin page cannot read a cookie or set a custom header without a
preflight). Password-equivalent writes require CSRF. See ADR-0002.

### 3.2 POS integration sessions
Login with a passkey mints a row in `integration_sessions`; the bearer token is
stored only as `token_hash`. The session has **two clocks** (`lib/
integration-session-core.ts`): a 60-minute **absolute** ceiling and a 30-minute
**sliding idle** window pushed forward on every authenticated request. A missing
idle window fails closed. Revocation is per-session (`/logout`) or all-sessions
(`/revoke`, and on passkey rotation).

> Note: `lib/security/integration-auth.ts` contains an **older in-memory**
> session store (`Map`, `issueIntegrationSession`) that is **not wired to any
> route**. The live path is the DB-backed `db/queries.ts` implementation used by
> `app/api/integration/_auth.ts`. The in-memory file is dead code and is listed
> in §12. (The Phase 0 inventory's §6 table conflates the two.)

### 3.3 Customer (anonymous) sessions and per-order tokens
Historically the whole customer profile — including every order's signed token
and tracking token — lived in `localStorage`. Any script on the page could read
the PII *and* the credentials to read/cancel every order. The credential now
lives server-side: a `customer_sessions` row holds only order **codes** (hashed
token, `expires_at`, `revoked_at`), and the browser holds an `HttpOnly` cookie.
The session is bound to codes by `POST /api/orders/attach`, which accepts only
HMAC-verified `code`+`token` pairs. Access is then decided by
`lib/order-authorized.ts`: a valid `x-order-token` **or** a live session whose
bound list contains the code. Failures are indistinguishable from "order not
found".

### 3.4 Ops and cron
`requireOpsToken` compares a bearer secret in constant time, fails closed in
production, emits `admin_login` security events, and never logs the presented
value. `requireCronAuth` reuses the ops token or `CRON_SECRET`, ignores a
spoofed `x-vercel-cron` off-platform, and returns a distinct 503 when no secret is
configured.

## 4. Request lifecycle for a checkout (worked example)

1. `POST /api/orders` → `proxy.ts` passes (method, host, body cap, burst).
2. Route: `guardWrite("checkout")` (origin + budget) → `readJsonBody` (capped).
3. Validate/cap input (`order-input-core.ts`); recompute the bill; reject total
   mismatch.
4. `computeBill` enforces the ordering gate and an ACTIVE integration.
5. Transactionally create `orders` row (idempotent on `client_request_id`) and
   the `marketplace_payments` record.
6. `enqueuePosDelivery(orderId)` writes the journal row and performs the **first
   POS attempt synchronously** (durability: the row is already persisted, so a
   timeout still retries).
7. Respond with the order code, `x-order-token`, and tracking token. On a later
   `/attach`, the customer session is minted/renewed and the code bound to it.

## 5. Payment flow

1. **Start** — `/pay/start` creates/reuses the payment attempt (a `FAILED`
   attempt stays resumable), allocates a provider order, returns its id.
2. **Browser confirm** — `/pay/verify` verifies the checkout HMAC signature and
   re-reads the money facts from the provider API.
3. **Server truth** — `POST /api/integrations/payments/webhook` verifies
   `x-razorpay-signature` over the raw bytes and applies
   `applyProviderPaymentEvent` inside a transaction: event-id ledger insert first
   (dedupe), then resolve payment, then verify **amount + currency against the
   order**, then advance `marketplace_payments` + `orders.payment_status`
   together.
4. **Retry safety** — a late `payment.failed` cannot rebind or downgrade a
   settled capture (`PAYMENT_ATTEMPT_SUPERSEDED`, `PAYMENT_ALREADY_SETTLED`).
5. **Delivery gate** — only a captured payment with a live integration opens a
   `marketplace_pos_payment_deliveries` row.
6. **Refund / reconcile** — `integrations/payments/refund.ts`,
   `reconcile.ts`. See ADR-0004.

## 6. Durable delivery (queues)

Two at-least-once journals with identical shapes:

- **Order** — `marketplace_pos_order_deliveries` (`db/pos-delivery.ts`,
  `integrations/pos/order-bridge.ts`).
- **Payment** — `marketplace_pos_payment_deliveries` (`db/payment-delivery.ts`,
  `integrations/pos/payment-bridge.ts`).

State machine: `PENDING → DELIVERED | FAILED`. Drains claim work atomically with
`FOR UPDATE SKIP LOCKED` and an attempt-count update, so concurrent drains never
double-send. Retryable failures back off ×4 (base 4 s) with 0–30 % jitter, up to
5 attempts; deterministic failures go terminal immediately. A terminal
**order** failure writes `orders.pos_delivery_status = FAILED` and, if money was
captured, persists refund intent before any provider call.

Who drains:
- `src/instrumentation.ts` — in-process `setInterval` loop, **skipped on Vercel**.
- `vercel.json` — `/api/cron/pos-drain` (03:00) and `/api/cron/payments-drain`
  (03:30), plus `/api/internal/pos-delivery-drain` and
  `/api/integrations/pos/drain`.
- `lib/queue-health.ts` reports pending/delivered/failed counts and the oldest
  pending age so a silent schedule failure is visible.

See ADR-0005.

## 7. Inbound webhook handling

All inbound POS/provider webhooks share a pattern:

1. Cap the raw body (`readRawBodyCapped`).
2. Verify signature (HMAC over the raw bytes + timestamp skew) with the sealed
   secret or provider secret; on failure emit a security event with fixed copy
   (no diagnostic oracle).
3. Insert into an idempotency ledger keyed by `event_id`; a replay with a
   different `payload_hash` is a **conflict**, not a silent dedupe.
4. Apply the transition transactionally, tenant/branch-scoped, forward-only for
   status.
5. Record an `integration_audit` row.

Ledgers: `menu_webhook_events`, `marketplace_order_events`,
`marketplace_payment_events`.

## 8. Menu synchronisation

`db/menu-sync.ts` mirrors POS categories, items, modifiers and their
relationships into `menu_categories`, `menu_items`, `modifier_groups`,
`modifier_options`, `menu_item_modifier_groups`. Identity is
`(restaurant_id, pos_*_id)`, never name. Minted marketplace ids are echoed to the
POS on every replay of the same `event_id` (`db/menu-mapping-echo.ts`). Images are
validated by `lib/image-policy.ts` at write and read.

## 9. Caching, performance and client behaviour

- **No application cache layer.** Customer reads are `cache: "no-store"` where
  freshness matters (order polling); the DB is the source of truth. There is no
  Redis/memcache. The only in-memory stores are the per-instance rate-limit
  buckets and the dead integration store (§12).
- **Client performance classification** — `lib/performance-mode.ts` is the single
  answer to "what can this device afford?" (`full`/`balanced`/`low`), driven by
  `prefers-reduced-motion`, pointer type, save-data and core count. One shared set
  of listeners replaces per-component probes.
- **Polling discipline** — `lib/order-access.ts` `useOrderPoll` stops on hidden
  tabs, finished orders, and overlapping requests (recursive `setTimeout`, not
  `setInterval`).
- **Discoverability** — `lib/discoverability.ts` is the one SQL predicate for
  "may this listing occupy a browse surface" (active **and** has an available
  dish).

## 10. Data model summary (22 tables)

Grouped by concern (`src/db/schema.ts`):

- **Tenant / identity:** `restaurants`, `connections`, `connection_codes`,
  `integration_records`, `integration_transfer_requests`, `integration_audit`.
- **Sessions:** `restaurant_sessions`, `customer_sessions`, `integration_sessions`,
  `admin_sessions`.
- **Catalogue:** `menu_categories`, `menu_items`, `modifier_groups`,
  `modifier_options`, `menu_item_modifier_groups`, `menu_webhook_events`.
- **Orders:** `orders`, `marketplace_order_events`, `pos_order_deliveries`.
- **Payments:** `marketplace_payments`, `marketplace_payment_events`,
  `marketplace_pos_payment_deliveries`.

Migrations are plain SQL under `src/db/migrations/` applied by
`scripts/db-migrate.mjs`, tracked in `schema_migrations`. Money is stored in
integer paise (`*_cents`) with a rupee mirror only where the POS needs it. POS
ids are `bigint` (epoch-ms can overflow int4).

## 11. Deployment and operations

- **Host:** Vercel. `vercel.json` declares the two cron drains.
- **CI:** `.github/workflows/ci.yml` sets `REQUIRE_SECURITY_TESTS=1`
  (fail-closed), runs typecheck, lint, unit tests, the security E2E suite against
  a real Postgres, an advisory `npm audit`, and a build.
- **Tests:** `npm test` = 26 unit suites + 8-suite security E2E harness
  (`tests/security/harness.ts`, boots Postgres + `next start`).
- **Observability:** structured security events to stderr
  (`lib/security/security-events.ts`); POS transport failures as structured JSON
  (`lib/pos-bridge.ts`); queue health via `/api/ops/queue-health`.
- **Config:** 22 referenced env vars; `.env.example` declares 17 (6 dead). The app
  still connects as an over-privileged DB role although a least-privilege
  `marketplace_app` role exists.

## 12. Known gaps and dead code (accurate at Phase 1)

These are **existing** conditions, recorded here so the architecture doc does not
overstate completeness. They are not introduced by this document.

1. **Customer-session migration incomplete.** `lib/order-authorized.ts` exists but
   is imported by **no route**; order read/pay/cancel still gate on
   `x-order-token` alone. `ABUSE_BUDGETS.orderCancel` is declared but not wired —
   `api/orders/[code]/cancel` has no `guardWrite` (no origin check, no budget).
2. **Dead integration session store.** `lib/security/integration-auth.ts`
   (in-memory `Map`) is referenced only by the Phase 0 inventory doc; the live
   POS session path is `db/queries.ts`. Safe to delete, but deleting source is out
   of scope for Phase 1.
3. **Per-instance state.** Rate-limit buckets (and the dead store) are in-process;
   a multi-instance deployment needs a shared store for these to be authoritative.
4. **Dependency advisories.** 9 high, notably `next@16.3.6` (fix `16.4.0`) and
   `sharp@0.35.4` (fix `>=0.35.5`).
5. **Least-privilege DB role unused; `.env` credential rotation pending.**
6. **10 non-fatal build warnings** (Edge-Runtime Node-builtin traces, Turbopack
   lockfile location).
