# Architecture Inventory (Phase 0)

Recorded 2026-10-09. Read-only snapshot of the repository **working tree** at
`eb8977e` + an uncommitted security layer (36 modified, 11 untracked files; see
`baseline-report.md`). Every count below came from a command run against the
tree at recording time and the command is named so it can be re-run. Where the
tree differs from the earlier `eb8977e` recording, the difference is called out.

## 1. Stack

| Layer | Choice | Where |
|---|---|---|
| Framework | Next.js 16.3.6, App Router, React 19.2.6 | `package.json` |
| Language | TypeScript 5.9.3, `strict` via `tsc --noEmit` | `tsconfig.json` |
| Database | PostgreSQL via `pg` 8.20.0 + drizzle-orm 0.45.2 | `src/db/` |
| Migrations | Plain SQL files, applied by `scripts/db-migrate.mjs` | `src/db/migrations/` |
| Payments | Razorpay (`razorpay` 2.9.8) | `src/integrations/payments/` |
| POS bridge | Outbound HTTP client + inbound signed webhooks | `src/integrations/pos/`, `src/lib/pos-bridge.ts` |
| Edge | `src/proxy.ts` (Next.js Proxy / middleware) | runs before routing |
| Image policy | One allowlist shared by config, write and read paths | `src/lib/image-policy.ts` |
| Deploy | Vercel, crons in `vercel.json` | CI: `.github/workflows/ci.yml` |
| Styling | Tailwind 4 | `src/app/globals.css` |
| Tests | Node built-in test runner through `tsx` | `tests/` |

Working-tree changes to config: `next.config.ts` imports
`IMAGE_HOST_PATTERNS` from `src/lib/image-policy.ts` and sets
`dangerouslyAllowLocalIP: false`; `tsconfig.json` gains
`allowImportingTsExtensions` (needed for that import).

## 2. Source layout

```
src/
  app/           18 page routes + 53 API routes
  components/    31 component files
  db/            schema.ts (22 tables), queries, payments, menu sync, seeds
  integrations/  12 files: payments (provider-session, reconcile, refund)
                 pos (client, order-bridge, order-cancel, order-status,
                      payment-bridge, readiness, resolve-outlet, menu-image)
  lib/           43 modules + lib/security/ (10) - see section 8
  proxy.ts       network boundary (method/host/body/rate gates + headers)
```

Commands: `Get-ChildItem src -Directory`; per-directory file counts.

## 3. API routes (53)

Auth column is the first gate each handler runs, verified by reading the imports
and first guard call in every `route.ts` under `src/app/api`. Count is
`Get-ChildItem -Recurse -File src/app/api -Filter route.ts`.

### Public / unauthenticated by design (5)

| Route | Methods | Gate |
|---|---|---|
| `api/health` | GET | none (liveness, DB ping only) |
| `api/ops/queue-health` | GET | none, documented: four counters, no tenant data |
| `api/partner/signup` | POST | rate limit + honeypot + origin check |
| `api/integration/login` | POST | `guardWrite` + honeypot, mints integration session |
| `api/orders/track/[trackingToken]` | GET | `guardRead` + tracking-token lookup |

### Signed webhooks from the POS / Razorpay (6)

| Route | Gate |
|---|---|
| `api/integrations/payments/webhook` | Razorpay signature over `readRawBodyCapped` bytes |
| `api/integrations/webhooks/menu-item` | HMAC over `readRawBodyCapped` bytes |
| `api/integrations/webhooks/order-accepted` | HMAC (shared handler) |
| `api/integrations/webhooks/order-cancelled` | HMAC (shared handler) |
| `api/integrations/webhooks/order-rejected` | HMAC (shared handler) |
| `api/integrations/webhooks/order-status` | HMAC via `handlePosOrderStatusWebhook` |

Unverified refusals on the menu-item and order-status handlers no longer carry
the `_diag` diagnostics block (working-tree change).

### Cron / ops token (9)

| Route | Gate |
|---|---|
| `api/cron/pos-drain` | `requireCronAuth` |
| `api/cron/payments-drain` | `requireCronAuth` |
| `api/internal/pos-delivery-drain` | `requireCronAuth` (working tree; previously an ad-hoc `CRON_SECRET` compare) |
| `api/integrations/payments/ops` | `requireOpsToken` |
| `api/integrations/pos/drain` | `requireOpsToken` |
| `api/ops/featured` | `requireOpsToken` |
| `api/ops/integration-transfers` | `requireOpsToken` |
| `api/ops/owner-key` | `requireOpsToken` |
| `api/ops/pos-bridge` | `requireOpsToken` |

### POS integration session (`requireIntegrationAuth`) (6)

`api/integration/identity`, `logout`, `orders`, `passkey/rotate`,
`restaurant`, `revoke`. `api/integration/login` is the unauthenticated entry
point above.

### Partner session (`requirePartnerSession` / `authoriseMenu`) (12)

| Route | Gate |
|---|---|
| `api/partner/integrations` | `requirePartnerSession` |
| `api/partner/integrations/verify` | `requirePartnerSession` |
| `api/partner/restaurant` | `requirePartnerSession` |
| `api/partner/restaurant/delete-intent` | `requirePartnerSession` |
| `api/partner/session` | `requirePartnerSession` (plus `guardWrite`, `ownerVerify`) |
| `api/partner/menu` | `authoriseMenu(req, false)` |
| `api/partner/menu/items` | `authoriseMenu(req, true)` |
| `api/partner/menu/items/[id]` | `authoriseMenu(req, true)` |
| `api/partner/menu/items/[id]/modifier-groups` | `authoriseMenu(req, true)` |
| `api/partner/menu/items/[id]/modifier-groups/[groupId]` | `authoriseMenu(req, true)` |
| `api/partner/menu/modifier-groups` | `authoriseMenu(req, true)` |
| `api/partner/menu/modifier-groups/[id]` | `authoriseMenu(req, true)` |

Working tree: `/integrations` body parse and `/integrations/verify` now use the
capped `readJsonBody`; `/verify` deletes `webhook_secret` from the returned
attestation.

### Ops-token-gated partner utilities (3)

`api/partner/codes`, `api/partner/codes/[code]`, `api/partner/connect` all
require `requireOpsToken`.

### Owner-key-authenticated (1)

`api/partner/owner-key/rotate` — authenticated by possession of the key being
replaced, rate limited 5/hour, answers 404 for both "no such key" and "did not
rotate" so it cannot confirm a guess. Body now read through the capped reader.

### Order-token / public order flows (8)

| Route | Gate |
|---|---|
| `api/orders` | `guardWrite` + `readJsonBody` + checkout validation |
| `api/orders/bill` | `guardWrite` + `readJsonBody` |
| `api/orders/lookup` | `guardWrite` + `readJsonBody` |
| `api/orders/attach` | `guardWrite("customerSession")` + `readJsonBody`; binds HMAC-verified `code`+`token` pairs to an anonymous cookie session (working-tree route) |
| `api/orders/[code]` | `guardRead` + `x-order-token` |
| `api/orders/[code]/cancel` | `x-order-token` (no guard, no session — see open items) |
| `api/orders/[code]/pay/start` | `guardWrite` + order token |
| `api/orders/[code]/pay/verify` | `guardWrite` + `readJsonBody` + order token |

### Public reads (3)

`api/restaurants`, `api/restaurants/[slug]`, `api/search` - all `guardRead`.

## 4. Page routes (18)

`/`, `/cart`, `/checkout`, `/contact`, `/health`, `/ops`,
`/order/[code]/success`, `/order/[code]/track`, `/order/track/[trackingToken]`,
`/orders`, `/partner`, `/partner/integrations`, `/partner/menu`, `/privacy`,
`/profile`, `/refunds`, `/restaurants`, `/restaurants/[slug]`, `/terms`
(plus generated `/robots.txt`, `/sitemap.xml`).

Private prefixes are asserted noindex by `tests/seo-surfaces.test.ts`.

## 5. Database

### Tables (22)

`restaurants`, `restaurant_sessions`, **`customer_sessions`** (new),
`menu_categories`, `menu_items`, `connection_codes`, `connections`,
`integration_sessions`, `integration_records`,
`integration_transfer_requests`, `integration_audit`, `orders`,
`pos_order_deliveries`, `marketplace_payments`, `marketplace_payment_events`,
`marketplace_pos_payment_deliveries`, `marketplace_order_events`,
`modifier_groups`, `modifier_options`, `menu_item_modifier_groups`,
`menu_webhook_events`, `admin_sessions`.

Source: `src/db/schema.ts`, 22 `pgTable(` definitions
(`Select-String -Path src/db/schema.ts -Pattern 'pgTable\('`).

### Migrations (15)

```
20260922_marketplace_pos_order_bridge.sql
20260929_onboarding_marketplace_bridge.sql
20260930_split_owner_key_and_pos_passkey.sql
20261001_widen_pos_identity_columns_to_bigint.sql
20261001_widen_pos_order_id_to_bigint.sql
20261002_integration_transfer_requests.sql
20261003_connection_code_revocation.sql
20261004_restaurant_sessions.sql
20261006_integration_session_security.sql
20261006_order_tracking_token.sql
20261007_application_role.sql
20261007_fk_delete_actions.sql
20261007_missing_indexes.sql
20261007_payment_signature_verification.sql
20261008_customer_sessions.sql        <- new in the working tree
```

Ledger table: `schema_migrations`.

### Roles as they exist in the live database (probed 2026-10-08)

| Role | superuser | createdb | createrole | bypassrls | password |
|---|---|---|---|---|---|
| `postgres` (used by the baseline probe) | no | **yes** | **yes** | **yes** | yes |
| `marketplace_app` | no | no | no | no | yes |

`marketplace_app` has SELECT/INSERT/UPDATE/DELETE on the application tables and
none on `schema_migrations`, with `ALTER DEFAULT PRIVILEGES` so later tables are
covered.

**Open item:** the application still connects as an over-privileged role. The
least-privilege role exists and is correctly provisioned but nothing has been
switched over to it.

## 6. Authentication flows

| Flow | Module | Credential | Notes |
|---|---|---|---|
| Partner (restaurant owner) | `src/lib/security/restaurant-session.ts` | HttpOnly session cookie | `requirePartnerSession(req, { mutating })` adds CSRF + write budget on writes |
| Partner menu | `src/lib/partner-menu-api.ts` | same session | `authoriseMenu` scopes every query; body reads capped |
| POS integration | `src/lib/security/integration-auth.ts` | integration session | `issueIntegrationSession` / `requireIntegrationAuth` |
| POS passkey | `src/db/queries.ts`, `integration_passkey_hash` | passkey | split from owner key in `20260930_split_owner_key_and_pos_passkey.sql` |
| Owner key | `src/lib/security/restaurant-auth.ts`, `src/lib/owner-key.ts` | `owner_key_hash` | `ownerKeyMatches` uses `timingSafeEqual` (working tree) |
| **Customer (anonymous)** | `src/lib/customer-session.ts`, `-core.ts` | `crave_customer_session` HttpOnly cookie | 90-day TTL, renew-on-attach, `order_codes` jsonb bound list; `customer_sessions` table; minted/renewed only by `POST /api/orders/attach` |
| Order access | `src/lib/order-token.ts`, `src/lib/order-tracking.ts`, `src/lib/order-authorized.ts` | per-order token (and, once wired, the customer session) | `verifyOrderToken`, tracking token route. **`orderAuthorized` is defined but not imported by any route yet** |
| Ops console | `src/lib/ops-auth.ts` | `x-ops-token` | `requireOpsToken`, fail-closed in production |
| Admin | `src/lib/security/admin-auth.ts` | `requireAdmin` | |
| Cron | `src/lib/cron-auth.ts` (+ `cron-auth-core.ts`) | shared secret / `x-vercel-cron` | `requireCronAuth`, constant-time, fail-closed 503; now shared by all three drains |
| Session revocation | `revokeRestaurantSessionsForRestaurant` | - | fired when the owner key rotates |

## 7. Payment flows

1. **Checkout start** - `POST /api/orders/[code]/pay/start` creates/reuses an
   attempt row in `marketplace_payments`, returns the Razorpay order id.
   Working tree: a `FAILED` attempt is still payable (decline retry).
2. **Client confirmation** - `POST /api/orders/[code]/pay/verify` verifies the
   Razorpay signature and flips the attempt to `PAID`. Working tree: a `FAILED`
   row is confirmable; money facts are re-read from the provider.
3. **Server truth** - `POST /api/integrations/payments/webhook` verifies
   `x-razorpay-signature` over the raw body (`readRawBodyCapped`), applies
   `payment.captured` / `payment.failed` idempotently by `event_id`.
4. **Retry safety** - `paymentStatusAllowsRetry` guards against a late
   `payment.failed` rebinding or downgrading a captured payment
   (`PAYMENT_ATTEMPT_SUPERSEDED`, `PAYMENT_ALREADY_SETTLED`).
5. **Delivery gate** - only a `PAID` payment with a live POS integration opens
   `marketplace_pos_payment_deliveries`.
6. **Reconciliation / refund** - `src/integrations/payments/reconcile.ts`,
   `refund.ts`.
7. **Ledger** - `marketplace_payments`, `marketplace_payment_events`,
   `marketplace_pos_payment_deliveries`; signature-verification column added by
   `20261007_payment_signature_verification.sql`.

Covered by `tests/payment-security.test.ts` and the security E2E payment suite
(replay dedupe, wrong-signature refusal, decline stays resumable, capture after
decline lands PAID, late `payment.failed` cannot un-pay a capture).

## 8. POS integration flows

- **Connect**: partner redeems a single-use connection code
  (`api/partner/integrations` -> `claimPosConnection`), identity is upserted,
  webhook secret sealed via `src/lib/webhook-crypto.ts`; a `MARKETPLACE_ID_TAKEN`
  conflict opens a transfer request instead of stranding a burned code.
- **Outbound**: `src/integrations/pos/order-bridge.ts` pushes orders;
  `order-status`, `order-cancel`, `payment-bridge`, `menu-image`,
  `resolve-outlet`, `readiness` cover the rest.
- **Inbound**: signed webhooks under `api/integrations/webhooks/*`.
- **Drains**: `api/cron/pos-drain`, `api/cron/payments-drain`,
  `api/internal/pos-delivery-drain` re-drive PENDING work; journals live in
  `pos_order_deliveries` / `marketplace_payment_events`.
- **Readiness**: `api/orders` checkout is refused with `INTEGRATION_NOT_CONNECTED`
  unless the integration is active *and* carries a sealed webhook secret.

## 9. Image-policy subsystem (new in the working tree)

`src/lib/image-policy.ts` is the single source of truth for every URL that may
become the `src` of a `next/image`:

- `IMAGE_HOST_PATTERNS` — allowlist (`images.pexels.com`, `*.supabase.co`,
  https only). Imported by `next.config.ts` so the optimizer's fetch list cannot
  drift.
- `validateImageUrl` — write/read gate (https, no credentials/port/fragment,
  public host, allowlisted).
- `isPrivateOrReservedHost` — RFC1918, loopback, link-local/metadata, CGNAT,
  TEST-NETs, multicast/reserved, IPv6 equivalents and reserved suffixes.
- `matchesImageHost` — rooted wildcard matching (no suffix-lookalike escape).
- `next.config.ts` adds `dangerouslyAllowLocalIP: false`.
- Call sites: `lib/domain.ts` `sanitizeImageUrl`, `db/queries.ts` and
  `db/partner-menu.ts` DTO mappers, `integrations/pos/menu-image.ts`.

Covered by `tests/image-ssrf.test.ts`.

## 10. Edge / security middleware

`src/proxy.ts` is the single network boundary. It runs before routing and owns:

1. Method allowlist.
2. Host allowlist (`ALLOWED_HOSTS` + deployment host + Vercel preview subdomains),
   rejects raw-IP and rebinding attempts with 400.
3. Declared body cap (`MAX_DECLARED_BODY_BYTES`) before allocation; chunked
   bodies declare nothing, so handlers cap the stream themselves.
4. Per-client burst ceiling (300 req/60 s, in-process, deliberately looser than
   the per-route budgets).
5. `withSecurityHeaders` on every response it passes or refuses.

Below the edge:

| Concern | Module | Call sites |
|---|---|---|
| Per-route write budget | `abuse-core.ts` `guardWrite` | 9 routes |
| Per-route read budget | `abuse-core.ts` `guardRead` | 7 routes |
| Capped JSON body | `abuse.ts` `readJsonBody` | 33 |
| Capped raw body | `abuse.ts` `readRawBodyCapped` | 9 |
| LIKE escaping | `abuse.ts` `escapeLike` | 5 |
| Rate limit | `security/rate-limit.ts` | signup, owner-key rotate, integration login, per-session budgets |
| Security headers | `security/security-headers.ts` | via proxy |
| Security event log | `security/security-events.ts` | logins, rotations, refusals |
| Error shaping | `security/errors.ts` | no `err.message` passthrough on remote failures |

Abuse budgets (`ABUSE_BUDGETS`, `src/lib/abuse-core.ts`): checkout, billPreview,
orderLookup, search, restaurants, ownerVerify, integrationLogin, opsCodeMint,
opsCodeList, opsCodeRead, paymentStart, paymentVerify, **customerSession**
(new), **orderCancel** (new, declared but not yet wired),
integrationPasskeyRotate, and others.

## 11. Cron jobs

From `vercel.json`:

| Path | Schedule |
|---|---|
| `/api/cron/pos-drain` | `0 3 * * *` |
| `/api/cron/payments-drain` | `30 3 * * *` |

Both guarded by `requireCronAuth`, as is `api/internal/pos-delivery-drain`. An
in-process drain can be enabled with `POS_DELIVERY_DRAIN_ENABLED` /
`POS_DELIVERY_DRAIN_INTERVAL_MS`, guarded by the same helper.

## 12. Environment variables

Referenced anywhere in `src/`, `scripts/`, `tests/` (22 unique):

```
ALLOWED_HOSTS              CRON_SECRET                CI
DATABASE_URL               INTEGRATION_ENVELOPE_KEY   MIGRATIONS_DATABASE_URL
MARKETPLACE_ORDERING_ENABLED                          NEXT_PUBLIC_APP_URL
NODE_ENV                   ORDER_TOKEN_SECRET         PGPOOL_CONNECT_TIMEOUT_MS
PGPOOL_MAX                 POS_BASE_URL               POS_DELIVERY_DRAIN_ENABLED
POS_DELIVERY_DRAIN_INTERVAL_MS                        POS_DELIVERY_OPS_TOKEN
RAZORPAY_KEY_ID            RAZORPAY_KEY_SECRET        RAZORPAY_WEBHOOK_SECRET
REQUIRE_SECURITY_TESTS     VERCEL                     VERCEL_ENV
```

Declared in `.env.example` (17 keys):

```
DATABASE_URL  MIGRATIONS_DATABASE_URL  POS_BASE_URL
MARKETPLACE_ORDERING_ENABLED  TABLZ_EXPOSE_DEV_OTP  CURRENCY  CURRENCY_LOCALE
RAZORPAY_KEY_ID  RAZORPAY_KEY_SECRET  RAZORPAY_WEBHOOK_SECRET
INTEGRATION_ENVELOPE_KEY  ORDER_TOKEN_SECRET  POS_DELIVERY_OPS_TOKEN
CRON_SECRET  VAPID_PUBLIC_KEY  VAPID_PRIVATE_KEY  VAPID_SUBJECT
```

Diff, recorded as-is (Phase 0 records, it does not modify):

- **Referenced but undocumented in `.env.example`:** `ALLOWED_HOSTS`,
  `NEXT_PUBLIC_APP_URL`, `PGPOOL_MAX`, `PGPOOL_CONNECT_TIMEOUT_MS`,
  `POS_DELIVERY_DRAIN_ENABLED`, `POS_DELIVERY_DRAIN_INTERVAL_MS`.
  (`NODE_ENV`, `VERCEL`, `VERCEL_ENV`, `CI`, `REQUIRE_SECURITY_TESTS` are
  platform/CI-provided and do not need an example entry.)
- **Declared but never referenced anywhere:** `TABLZ_EXPOSE_DEV_OTP`,
  `CURRENCY`, `CURRENCY_LOCALE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` - six dead keys.

`.env.example` holds placeholders only; no live value has been committed.

## 13. Tests

27 test files: 26 unit + 1 security E2E. `npm test` reports **374 tests,
8 suites**. Unit suites (26):

```
abuse-guards  connection-codes  consent-record  cron-auth  customer-session
database-security  edge-policy  error-disclosure  image-ssrf
integration-readiness  integration-session  integration-transfer
integration-transfer-sql  menu-mapping-echo  order-checkout-validation
order-tracking  payment-security  pos-bridge-transport  pos-id-width
pos-menu-image  pos-order-contract  pos-verify-outcome  restaurant-session
security-events  security-headers  seo-surfaces
```

Security E2E (`tests/security/security.e2e.test.ts`, 8 suites) boots a real
PostgreSQL harness (`tests/security/harness.ts`), migrates it, and drives live
route handlers over `next start`. Suites: ops admin auth; partner session
lifecycle; restaurant A/B isolation; order privacy + tracking enumeration;
connection-code redemption; integration bearer auth/scoping; restaurant deletion
gates; payment webhook verification (incl. the new decline→retry cases).

Style convention: source-reading assertions plus behavioural tests against the
harness. New regression tests follow the same two-part pattern.

## 14. CI

`.github/workflows/ci.yml`, single workflow. Services: `postgres:16`. Sets
`REQUIRE_SECURITY_TESTS=1` (fail-closed). Steps: install, typecheck, lint, unit
tests, security E2E, audit (`continue-on-error: true`), build. `.vercelignore`
keeps `.env*`, logs, `_*.cjs`, `_e2e_check*.cjs`, `_probe_*.cjs` and profiling
output out of deploys.

## 15. Documentation present

```
docs/thermal-phase-1.md    docs/thermal-phase-9.md
docs/thermal-phase-11.md   docs/thermal-phase-13.md
docs/thermal-phase-15.md
docs/baseline/baseline-report.md
docs/baseline/test-results.md
docs/baseline/architecture-inventory.md
```

Plus `SECURITY_HARDENING_ROADMAP.md` at the repository root.

## 16. Open items at the freeze point

1. `src/lib/order-authorized.ts` is defined but imported by no route; the order
   read/pay/cancel routes still use the `x-order-token` header alone.
2. `ABUSE_BUDGETS.orderCancel` is declared but not wired; `orders/[code]/cancel`
   has no `guardWrite`.
3. 9 high-severity audit advisories (notably `next@16.3.6` → `16.4.0`,
   `sharp@0.35.4` → `>=0.35.5`).
4. 10 non-fatal Edge-Runtime / Turbopack build warnings.
5. Committed `.env` application credential rotation (roadmap Phase 0/11).
6. Least-privilege `marketplace_app` role not yet switched to.
