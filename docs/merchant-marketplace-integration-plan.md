# Savour Marketplace ↔ Merchant App integration plan

## Goal and scope

Deliver the Zomato customer app + Zomato Restaurant Partner experience for Savour: Marketplace customers create orders, the Merchant App receives and manages the same orders, and customer tracking reflects merchant actions. The Restaurant POS is explicitly out of scope for this phase. Do not modify CRM, loyalty, customer dossier, reservations, staff, payroll, or other POS modules.

## Source review

- The Marketplace source is in `Khush714/Marketplace` on branch `master`; `main` currently contains only a README.
- Marketplace stack: Next.js App Router, PostgreSQL, Drizzle ORM.
- The Marketplace already contains an in-house merchant console at `/partner`, owner-key exchange to a bounded session, CSRF-protected partner routes, and menu operations under `/api/partner/menu/*` backed by `src/db/partner-menu.ts`.
- Customer checkout lives at `POST /api/orders`. It persists orders in the Marketplace `orders` table and calls the existing POS delivery bridge for applicable orders. For this task, that POS bridge is not a substitute for a merchant-order inbox and must not become a requirement for Merchant App delivery.
- Marketplace identity: `restaurants.id` (integer) as internal tenant ID; `slug` as public handle; `marketplace_id` (`rst_…`) as canonical external identifier. Partner API resolves tenant from the signed-in server-side session rather than trusting an ID in request data.
- Marketplace menu: `menu_items` with paise in `priceCents`; category and modifiers have separate tables. `GET /api/partner/menu` returns the authenticated merchant's full editable menu. Item create/edit/availability APIs live under `/api/partner/menu/items/*`.
- Marketplace orders: `orders` has integer internal `id`, unique public `code`, integer `restaurantId`, immutable item-price snapshots, payment lifecycle fields and `integrationStatus`. `integrationStatus` is currently documented as the actual POS lifecycle, so do not reuse it blindly for a new independent merchant state machine. Keep POS tracking behavior compatible by using a separate `merchantStatus` column and a migration, or by proving through a full call-site audit that a safe unification is possible.
- Merchant App ZIP is a separate Next.js + PostgreSQL + Drizzle project. Its `businesses.id` is UUID; `menu_items.price` is integer paise; `orders.id` is UUID and status uses lowercase `new`, `accepted`, `preparing`, `ready`, `completed`, `rejected`, `cancelled`. It has a separate email/password auth/session and stores its own orders in a distinct schema. The local `/api/marketplace` POST currently creates a row in the Merchant App's own `orders` table; that is not integrated with the Marketplace repository.

## Architecture decision

Use the Marketplace database and merchant identity as canonical for listings, published menu, orders, and customer tracking. Prefer the Merchant App UI as a client of a narrow, authenticated Marketplace API; do not dual-write each order to both databases. The Merchant App's local UUID business IDs must be mapped explicitly to the Marketplace restaurant ID or canonical `marketplaceId`; never assume they are interchangeable. Do not connect both applications to one database with their current incompatible Drizzle schemas unchanged.

The Marketplace also has a `/partner` UI. Before merging UI surfaces, choose one clear ownership model: (A) adapt the separate Merchant App UI to Marketplace APIs (recommended for preserving its UX), or (B) use the existing `/partner` UI and retire the duplicate UI later. Both must not independently own order or menu records.

## Proposed Merchant App API contract

Add merchant-facing order handlers to the Marketplace repository (for example `src/app/api/partner/orders/route.ts`) using the existing partner session authorization helpers:

- `GET /api/partner/orders?status=active&page=1&limit=20` — returns only orders for the authenticated restaurant, using an allowlisted status filter and bounded pagination.
- `PATCH /api/partner/orders` — performs one allowed status transition with optimistic concurrency, e.g. `{ orderCode, expectedStatus, nextStatus, prepMinutes?, reason? }`.
- Public order code is preferable to exposing the internal serial ID. Responses must be merchant-safe DTOs and must not include tracking-token hashes, customer session tokens, integration secrets, or unrelated internal credentials.
- Use `requirePartnerSession` for tenant identity; `guardRead`/`guardWrite`, CSRF checking, bounded JSON parsing and validation on writes; query orders by the session-derived `restaurantId` only.
- Use a transaction and conditional update (`WHERE id = ? AND restaurant_id = ? AND merchant_status = expectedStatus`) to prevent two devices overwriting each other. Return HTTP 409 on stale expected status; do not permit invalid or terminal-state transitions.
- Record successful status transitions in a dedicated merchant order event ledger or an appropriate append-only event table. Keep event insertion and order update in the same transaction.
- Preserve existing order payment status. The Merchant App must never set an order's payment to paid. Payment truth remains in Marketplace payment verification/webhooks.
- Use existing menu data and APIs. The Merchant App must not create duplicate menu records in its own database once integrated.

The exact DTO shape should be settled after reading the existing `OrderDto`, `toOrderDto`, checkout validation and customer tracking projections. Treat the API contract above as proposed, not as an assertion that these routes already exist.

## Merchant lifecycle design

Add a separate canonical merchant lifecycle field instead of overloading the POS status until its usages are fully audited. Suggested status values:

- `PLACED`: order persisted; merchant action required.
- `ACCEPTED`: merchant accepted and selected a preparation estimate.
- `PREPARING`: preparation began.
- `READY`: order ready for collection or dispatch.
- `COMPLETED`: pickup handoff completed, or delivery service confirms delivery.
- `REJECTED`: merchant rejected with bounded reason.
- `CANCELLED`: a valid cancellation transition was processed.

Merchant status is distinct from payment status. A merchant marks an order ready; the merchant must not mark a delivery order delivered unless an authoritative delivery workflow confirms it. Map merchant status into the customer-safe tracking projection without changing legacy POS-connected orders' tracking lifecycle.

## New order notification / freshness

For first delivery, implement reliable foreground polling with an authoritative GET fallback; pause polling while the tab is hidden and avoid overlapping requests. The database read—not a browser notification—is the delivery guarantee. A later event stream (SSE/WebSocket) can lower latency without changing the API contract. Browser notifications/sound are supplemental only. Add tests to prove a missed notification does not lose an order.

## Currency and menu mapping

Both repositories' comments/documentation use integer paise, despite field names differing (`priceCents` in Marketplace, `price` in Merchant App). Map explicitly and display rupees only at UI boundaries. Marketplace item IDs are numeric; separate Merchant App item IDs are UUIDs, so cart lines need a mapping or, preferably, the Marketplace canonical item IDs in integrated mode. Always recalculate prices from Marketplace database at checkout; never trust the Merchant App/browser price.

## Payment and order creation safety

- Keep customer checkout creation in the Marketplace as the single order creation path.
- Enforce idempotency so retries create exactly one canonical order.
- Verify online payment using existing Marketplace payment-provider flow; Merchant App cannot forge payment state.
- Do not route Merchant App delivery through the POS integration queue; do not require a POS connection for the merchant to see an online order.
- Payment state changes remain handled by existing payment services and reconciliation, not merchant status PATCH.

## Verification checklist

1. A merchant only sees their own menu/orders and cannot read or update another restaurant's rows.
2. Merchant publishes or edits a menu, and Marketplace reads the same canonical item and paise price.
3. Marketplace checkout creates one canonical Marketplace order.
4. The order appears in the correct Merchant App even with POS integration disconnected.
5. Accept/reject/preparing/ready status changes update the canonical merchant status and customer tracking.
6. Competing status actions return 409; invalid/backward transitions are rejected.
7. Duplicate checkout retries and order polling do not duplicate orders or transition events.
8. Merchant App cannot change payment status or read sensitive tracking/session credentials.
9. Delivery orders cannot be marked completed by merchant alone unless the actual fulfillment type is pickup or a trusted delivery integration confirms delivery.
10. Existing payment, POS bridge, security, customer checkout, menu, and unrelated modules continue to pass their tests.

## Current tool limitation

Repository metadata and code are readable, but the GitHub connection returned `403 Resource not accessible by integration` for branch creation. No remote files have been modified. Implement on a separate branch using a writable GitHub connection or apply the project patch locally; never write this work directly to `master` without review.


## Working-copy implementation notes (2026-10-28)

The integration code in this working copy now includes:

- A dedicated `/partner/merchant-app` page that mints one-time pairing codes through `/api/partner/merchant-link`.
- Drizzle schema definitions matching `src/db/migrations/20261028_merchant_order_lifecycle.sql` for merchant status, merchant event history, pairing codes, app links, and merchant store settings.
- Merchant-managed order creation when the restaurant has a paired Merchant App, with a separate `merchantStatus` lifecycle and customer tracking projection. POS `integrationStatus` and the POS delivery journal remain separate.
- Production ordering-gate support for a paired Merchant App even when no POS is connected.
- Merchant order visibility gated on COD or verified `PAID` payment status, so an unpaid online order does not trigger preparation.
- Merchant App API endpoints that proxy menu, store settings, overview, and order actions to the Marketplace when paired; the Merchant App's local checkout is blocked for paired businesses to prevent dual-written orders.

The uploaded Merchant App project and Marketplace source have been modified in the generated working copies. The connected GitHub integration could read the repository but returned HTTP 403 when asked to create a branch, so these edits have **not** been pushed to GitHub. Apply/review the generated project ZIPs locally, run the verification commands, apply the Marketplace migration to a development database, and test pairing and a real order before deploying.
