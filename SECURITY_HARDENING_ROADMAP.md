# Security Hardening Roadmap (Phase 0)

## 0.1 Database Credential Rotation
- [x] drizzle.config.ts reads from process.env.DATABASE_URL (env-only)
- [ ] ROTATED: Original credential replaced with ROTATED_PLACEHOLDER_PLEASE_UPDATE_IN_SECURE_ENV in .env
- [ ] ACTION REQUIRED: Rotate the actual password in Supabase for postgres.irvgudzebislnozpatqx immediately
- [ ] ACTION REQUIRED: If this repo was ever pushed to GitHub/GitLab, treat the old credential as compromised and invalidate it

The following files were confirmed:
- drizzle.config.ts: reads url from process.env.DATABASE_URL
- src/db/index.ts: reads DATABASE_URL from env and validates presence

## 0.2 Destructive Build Behavior
- [x] package.json: no postbuild script present
- [x] db:reset and db:seed are explicit developer commands (tsx src/db/reset.ts --confirm, tsx src/db/seed.ts --confirm)
- [x] npm run build does not touch production database

Verification:
- grep for postbuild: none
- build isolated from DB operations

## Next Steps
1. Update .env with the new Supabase password (securely, not in git)
2. Rotate credentials in Supabase
3. Revoke/cleanup any exposed credentials

---

# Payment Security (Phase 9)

Critical rule enforced end to end:

```
browser says SUCCESS  ──✗──▶  order PAID
provider says SUCCESS ──▶ verified signature ──▶ order PAID
```

## What already existed (verified, not rebuilt)
- [x] `POST /api/orders` — order created FIRST, held at `PAYMENT_PENDING`; prices/totals recomputed server-side, client price fields never trusted
- [x] `POST /api/integrations/payments/webhook` — HMAC-SHA256 over the raw body (`x-razorpay-signature`), timing-safe compare, `event_id` idempotency ledger, amount + currency verified against the order before anything becomes PAID, per-IP rate limit
- [x] `POST /api/orders/[code]/pay/verify` — checkout triple is signature-verified, then money facts are re-read from the provider API; the body is never trusted
- [x] `payments` table (`marketplace_payments`) — provider ids, amount_cents, currency, status, created_at/updated_at, unique (provider, provider_payment_id)
- [x] Statuses: `UNPAID / PAYMENT_PENDING / PAID / FAILED / REFUND_PENDING / REFUNDED / PARTIALLY_REFUNDED / PAYMENT_CANCELLED`
- [x] Release on capture only: `coordinateCaptureDelivery` pushes the order to the POS after a verified capture
- [x] Reconciliation (`reconcilePayments`) + `cron/payments-drain` for lost webhooks
- [x] `POST /api/orders` rate-limited (`ABUSE_BUDGETS.checkout`), `GET /api/orders/[code]` rate-limited (`orderLookup`)

## Changes in this phase
- [x] `signature_verified` provenance column on `marketplace_payments`
  - schema: `src/db/schema.ts`; migration: `src/db/migrations/20261007_payment_signature_verification.sql`
  - stamped on every status transition in `applyProviderPaymentEvent`, derived from the arrival channel
  - existing rows stay `false` (no retroactive claims about history we did not record)
- [x] Channel decision as pure, testable logic — `src/lib/payment-security-core.ts`
  - `webhook` (HMAC verified) and `checkout` (signature verified + provider re-read) → `true`
  - `dev` (local stand-in, no keys, no money) → `false`
- [x] Rate limits on the provider-spending endpoints — `src/lib/abuse-core.ts`
  - `paymentStart`: 30 / 10 min (`POST /api/orders/[code]/pay/start`)
  - `paymentVerify`: 30 / 10 min (`POST /api/orders/[code]/pay/verify`, does a live provider read)
  - both guarded with `guardWrite` (origin + budget + body cap) BEFORE the order-token check
  - capture polling deliberately uses `GET /api/orders/[code]` (`orderLookup`), so a slow bank transfer never burns this budget
- [x] Tests — `tests/payment-security.test.ts`
  - channel trust, paid-status vocabulary, column + migration presence
  - wiring: webhook/checkout/dev channels named in their routes
  - write locus: NOTHING outside `src/db/payments.ts` writes a PAID payment status
  - budgets exist, are sane, and the routes are actually guarded

## Acceptance
- `npm run typecheck`, `npm run lint`, `npm test` all pass
- A forged or client-claimed success can never produce `PAID`: the only PAID
  writes live behind webhook HMAC or checkout-signature + provider re-read
- Every PAID row records whether a verified signature vouches for it

---

# Database Security (Phase 10)

## 10.1 Restricted application role
- [x] `marketplace_app` role — `LOGIN NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, `search_path` pinned to `public`
- [x] SELECT/INSERT/UPDATE/DELETE on application tables only; `schema_migrations` ledger excluded (REVOKE-then-GRANT, deterministic end state); USAGE/SELECT on sequences
- [x] `ALTER DEFAULT PRIVILEGES` so tables added by a future `db:push` are covered without re-running this migration
- [x] Password set out-of-band (`ALTER ROLE marketplace_app PASSWORD …`) — the committed migration never contains one
- [x] Credential split: `DATABASE_URL` = restricted app role (runtime), `MIGRATIONS_DATABASE_URL` = owner for schema tools — `scripts/db-migrate.mjs` and `drizzle.config.ts` both prefer it and fall back to `DATABASE_URL` for single-role dev setups
- migration: `src/db/migrations/20261007_application_role.sql` · docs: `.env.example`

## 10.2 FK ON DELETE / ON UPDATE review
- [x] `orders.restaurant_id` NO ACTION → **RESTRICT** — orders are financial records; restaurant erasure removes them only through the explicit transaction in `deleteRestaurantById`, never as a cascade side effect
- [x] `integration_sessions.restaurant_id` NO ACTION → **CASCADE** — a live POS token for a deleted restaurant is an orphaned credential (mirrors `restaurant_sessions`)
- [x] `connections.restaurant_id` NO ACTION → **CASCADE** — binding dies with the restaurant; also unblocks `db:seed`, which deletes restaurants without clearing connections and only worked while none existed
- [x] `connections.code_id` / `integration_sessions.code_id` stay NO ACTION — connection codes are append-only history (revoke flips `status`, never deletes)
- [x] ON UPDATE: unchanged (NO ACTION) everywhere — every FK target is an immutable serial primary key
- [x] Migration is idempotent: discovers the live constraint by table pair, skips/re-names/re-adds with drizzle's stable name so `db:push` never churns
- migration: `src/db/migrations/20261007_fk_delete_actions.sql`

## 10.3 Index review — additions only, no duplicates
- [x] Added: `orders (restaurant_id, created_at)` — FK lookups + `listIntegrationOrders` ORDER BY, leading column also serves plain restaurant lookups (so no separate `restaurant_id` index); `orders (created_at)` — cross-restaurant recency; `connection_codes (status)` — status-partitioned scans; `restaurants (owner_key_hash)` — owner-key exchange was a seq scan on an auth path
- [x] NOT duplicated (already indexed): `orders.code`, `connection_codes.code`, `integration_sessions.token_hash` (column UNIQUE), `integration_sessions.restaurant_id` (existing index)
- migration: `src/db/migrations/20261007_missing_indexes.sql`

## Tests
- [x] `tests/database-security.test.ts` — role least-privilege + no password in-repo, FK actions in migration AND schema, idempotent constraint discovery, four indexes declared/added exactly once, four duplicates absent, credential-split wiring

## Acceptance
- `npm run typecheck`, `npm run lint`, `npm test` all pass
- The app credential cannot run DDL, manage roles, or read/rewrite the migration ledger
- Deleting a restaurant can never remove orders except through the explicit erasure transaction, and can never leave live sessions or connection bindings behind

---

# Security Headers & Next.js Hardening (Phase 11)

Headers are owned by one place: `withSecurityHeaders` in `src/lib/security/security-headers.ts`, applied by the Proxy (`src/proxy.ts`) to every response it touches — the refusals (405/400/413/429) and the pass-through alike.

## What every response carries
- [x] `Content-Security-Policy` — built by `contentSecurityPolicy()` in `src/lib/edge-policy-core.ts` (pure, testable)
- [x] `Strict-Transport-Security: max-age=63072000` — set by the Proxy only when `request.nextUrl.protocol === "https:"`, so a mixed-protocol deploy is never told to upgrade
- [x] `X-Content-Type-Options: nosniff`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Permissions-Policy: geolocation=(self), microphone=(), camera=()`
- [x] Frame protection twice over: `X-Frame-Options: DENY` and `frame-ancestors 'none'` in the CSP
- [x] Plus `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`
- [x] `next.config.ts`: `poweredByHeader: false` — the framework is not advertised

## CSP: incremental by design
The policy ships in a first stage that cannot break the UI:

| Directive | Value | Why it is still open |
|---|---|---|
| `script-src` | `'self' 'unsafe-inline' https://checkout.razorpay.com` (+ `'unsafe-eval'` outside production) | Next bootstraps with inline script chunks; dropping `'unsafe-inline'` without a nonce is the classic way to ship a blank page |
| `style-src` | `'self' 'unsafe-inline'` | React renders `style={...}` as attributes |
| `img-src` | `'self' data: blob: https:` | Partner dish photos are pasted from any HTTPS host by design (`images.remotePatterns` is `https://**`) |
| `font-src` | `'self' data:` | `next/font` self-hosts every woff2 |
| `connect-src` / `frame-src` | self + `*.razorpay.com` + checkout/api origins | checkout.js XHRs and the checkout dialog iframe |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` | strict from day one | These cannot break a page |

Tightening path (each step shippable alone): replace `'unsafe-inline'` in `script-src` with a per-request nonce minted in the Proxy and handed to Next via the `x-nonce` request header, then narrow `img-src` to hosts that actually appear in content.

## Tests
- [x] `tests/security-headers.test.ts` — strict directives, no wildcard/open-`connect-src`, prod has no `unsafe-eval`, the "keeps working" allowlist (inline scripts/styles, external images, Razorpay origins), header wiring in `security-headers.ts`, HSTS gated on HTTPS in `proxy.ts`, `poweredByHeader: false`

## Verified against a running server
`next build` + `next start`, probing real responses:
- `/privacy` → 200, full header set present, rendered title, all 9 external scripts same-origin `/_next/*`, 3 inline Next scripts (allowed by `script-src`)
- `/no-such-page` → 404 **with the same headers** (the proxy answers denials too)
- error path → 500 **with the same headers**
- `X-Powered-By` absent

Pre-existing blockers found during verification:
- FIXED: `order/[code]` and `order/[trackingToken]` were conflicting dynamic siblings under `/order/` (`next start`/`next dev` aborted with "different slug names for the same dynamic path", 500ing every request). Resolved by moving the shareable tracking page to `/order/track/<token>` (`src/app/order/track/[trackingToken]`), which mirrors `/order/<code>/track`; all three link generators (`order-success-screen`, `checkout`, `orders`) updated to the new URL.
- OPEN: `.env` (and its backup) DATABASE_URL fails auth (`28P01`) — the Phase 0 credential rotation item is still pending, so DB-backed pages (e.g. `/`) 500 locally. Both local env files carry credentials the server now rejects; the rotated password must be collected from Supabase and written to `.env` by whoever holds it.

---

# Logging & Monitoring (Phase 12)

One JSON line per security event, on stderr, through a fixed vocabulary of eleven events — the `pos-bridge` pattern (`src/lib/pos-bridge.ts`) generalised to the whole security surface. Every emission goes through one function, `emitSecurityEvent` (`src/lib/security/security-events.ts`), and the never-log guarantee lives inside `buildSecurityEvent` (`src/lib/security/security-events-core.ts`) rather than at each call site, so a future emitter cannot forget it.

## The event stream

| Event | Meaning | Emitted from |
|---|---|---|
| `admin_login` | Ops/admin credential check, success or failure (`reason`: `token_missing` / `token_mismatch` / `not_configured` / `open_surface`) | `requireOpsToken` in `src/lib/ops-auth.ts` — the gate every ops request passes today, including through `requireAdmin` |
| `connection_code_created` | An operator minted a single-use onboarding code (`codeId`, `daysValid` — never the code string) | `POST /api/partner/codes` |
| `connection_code_redeemed` | Redemption attempt; failures carry the fixed server-side reason, success the restaurant id — never the presented code | `POST /api/partner/connect` |
| `restaurant_session_created` | A session was minted: owner-key login, signup, or post-redemption | `createRestaurantSession` in `src/db/queries.ts` — the single mint path, so every caller is covered by construction |
| `restaurant_session_revoked` | One device logged out (`sessionId`), or a full sweep on key/passkey rotation (`restaurantId` + `allSessions`) | `revokeRestaurantSession` / `revokeRestaurantSessionsForRestaurant` in `src/db/queries.ts` |
| `integration_login` | POS credential login; failure = `invalid_credentials` — never the code or passkey | `POST /api/integration/login` |
| `passkey_rotated` | Rotation succeeded or was refused; neither old nor new passkey is logged | `POST /api/integration/passkey/rotate` |
| `restaurant_deleted` | The irreversible one: `confirmation_required` / `confirm_mismatch` / `not_found` failures; success carries the public listing name for human correlation | `DELETE /api/partner/restaurant` |
| `payment_webhook_failure` | Every non-2xx from the payment webhook — `secret_not_configured`, `body_rejected`, `missing_body`, `missing_signature`, `invalid_signature`, `invalid_json`, `refund_delivery_enqueue_failed` — with source `ip`, never the signature or secret | payments webhook route |
| `order_tracking_suspicious` | A tracking lookup that failed the token gate (`malformed_token` / `unknown_token`); the token itself is the credential and is never logged | `GET /api/orders/track/[trackingToken]` |
| `rate_limit_violation` | Every limiter's refusal, with `bucket` (`<scope>:<client>`), `limit`, `windowMs`, `retryAfterSeconds` | Central: the over-budget branch of `checkRateLimit` in `src/lib/security/rate-limit.ts`, which covers the abuse budgets, the per-session partner budgets, the onboarding limiters and the edge burst ceiling; the webhook's private limiter emits the same event directly |

Success and failure are one event name distinguished by `outcome`, so monitoring can filter `event=<name> AND outcome=failure` without doubling the vocabulary.

## Never-log list

Enforced by key rules (case- and punctuation-insensitive), a value rule for `postgres://` connection strings (the password rides inside the value, under an innocent key), recursion through nested context, and a fail-closed depth cap:

- [x] **database password** — `password` / `DATABASE_PASSWORD` / `DATABASE_URL` / `connection_string`, plus the value shape
- [x] **owner key** — `ownerKey` / `owner_key` / `OWNER_KEY` / bare `{ key: … }` (hashes included)
- [x] **integration bearer token** — any `*token*` key, `authorization`, `cookie`
- [x] **admin session token** — same token rule
- [x] **payment secret** — any `*secret*` key (`RAZORPAY_WEBHOOK_SECRET` and siblings)
- [x] **full customer address** — `addressText` / `address_line` / bare `address`; short `addressLabel` is public and stays loggable
- [x] neighbours at the same blast radius: passkeys, tracking/session/CSRF tokens and their hashes

Redaction is the backstop; the front stop is a call-site allowlist — every emission may only pass boring identifier fields (`outcome`, `reason`, ids, limiter telemetry), pinned by test so raw credentials are never even offered for redaction.

## Tests

- [x] `tests/security-events.test.ts` — 26 tests: the vocabulary is exactly the eleven events; no event is dead (every name has a call site) and no call site invents a name; all six never-log classes redacted, case/punctuation-insensitive, nested, and value-shaped for connection strings; the envelope (`event`, `at`) cannot be overridden from context; one parseable JSON line; per-event wiring at the designated sites; the central rate-limit emission sits inside the refusal branch and `abuse.ts` relies on it instead of logging itself; the emitter formats through `buildSecurityEvent` so redaction cannot be bypassed; every emission's fields ∈ the allowlist

## Acceptance

- [x] `npm run verify` green — typecheck, lint, 280/280 tests (254 pre-existing + 26 new)
- [x] All eleven events have exactly the emission sites in the table above; grepping one stream answers "what happened, to whom, and why"
- [x] None of the six forbidden classes can appear in the stream regardless of call-site mistakes — the guarantee is in `buildSecurityEvent`, tested directly

# Automated Security Tests (Phase 13)

A self-contained end-to-end security suite (`tests/security/`) that exercises the decisions the app makes at the HTTP boundary against a scratch PostgreSQL database and a real `next start` server — not mocks, not the test runtime calling route handlers directly. `server-only` imports throw outside the Next bundler, so the only honest way to drive these routes is over the wire; that is what the harness does.

- `tests/security/harness.ts` — creates a throwaway `crave_security_test` database, boots it with the real migrations, seeds a deterministic fixture set, and serves the compiled app on a free port with dummy secrets (`x-forwarded-for` is spoofed per suite so rate-limit buckets never collide).
- `tests/security/security.e2e.test.ts` — one file on purpose: `node --test` runs files in separate processes and every suite contends on one server, one database and the in-process limiters, so splitting them would race. When local PostgreSQL is absent every case skips, keeping plain `npm test` green on machines without it.

## Coverage

| Suite | Verifies |
|---|---|
| Ops admin auth | Code-mint and connection listing refuse unauthenticated / wrong `x-ops-token` callers (`requireOpsToken`) |
| Partner session lifecycle | Owner-key login, wrong-key 404 (no existence oracle), CSRF-gated writes, expired and revoked sessions, sign-out |
| Restaurant A/B isolation | A session reads and edits only its own listing; cannot mint codes or list POS connections; an integration bearer is not an admin credential |
| Order privacy + enumeration | Code+token and tracking-token reads return the public projection only (no `phone`/`id`/`restaurantId`/`externalOrderId`/`posConnected`); wrong/missing tokens, malformed and unknown tracking tokens all answer 404; 61 enumeration attempts rate-limit |
| Connection-code redemption | Fresh code redeems; used/revoked/expired/unknown refused; an off-vocabulary cuisine is rejected without spending the code |
| Integration auth/scoping | Bearer mint for a valid passkey; scoped to the tenant's own orders; garbage, expired and revoked sessions refused; cannot touch partner-admin routes |
| Restaurant deletion gates | Delete-intent needs session+CSRF; single-use confirmation (a wrong name burns it); session-bound tokens; expired confirmation refused; the full flow deletes listing, orders and session; four attempts per session throttle at three an hour |
| Payment webhook verification | Valid frame marks the payment paid and verified; amount and currency mismatch fail it; wrong/missing signatures rejected; replayed `event_id` deduplicated; no POS delivery without verified money |

## Finding fixed by this phase

The route contract promised a ten-minute single-use delete confirmation, but `consumeDeleteConfirmation` (`src/db/queries.ts`) matched only the token hash — an expired confirmation still spent successfully. Expiry is now part of the match (`gt(delete_confirm_expires_at, now())`), so "expired", "already spent" and "never issued" collapse to the same refusal, tested.

## Run

- `npm run test:security` — the 51-case security suite
- `npm run verify` — typecheck, lint, and the full suite (unit + E2E)

## Acceptance

- [x] `npm run verify` green — typecheck, lint, 331/331 tests (280 pre-existing + 51 new security E2E)
- [x] The harness builds the scratch database exactly as a deployed one: full DDL generated by `drizzle-kit generate` from `src/db/schema.ts` (the CLI's `push` refuses to run without a TTY), then the idempotent migration files on top; stale apps are rebuilt before `next start` serves them
- [x] Skip-safe: without the local PostgreSQL prerequisite the suite reports skip rather than failure, so the shared CI/`npm test` gate stays green elsewhere
- [x] Every security claim above is asserted at the HTTP boundary against the compiled bundle
