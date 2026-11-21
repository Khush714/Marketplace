# ADR-0007: Authenticated customer accounts are additive, proven-link, and fail-closed

- **Status:** Accepted (records current implementation; some product choices pending confirmation)
- **Date:** 2026-11-22
- **Related:** `docs/architecture.md`, `docs/decisions/0002-restaurant-sessions.md`,
  `src/lib/customer-account-core.ts`, `src/lib/customer-auth-otp.ts`,
  `src/lib/security/customer-account-session.ts`, `src/db/customer-accounts.ts`,
  `src/db/schema.ts` (`customer_accounts`, `customer_auth_challenges`,
  `customer_account_sessions`, `customer_addresses`, `customer_favorites`,
  `orders.customer_account_id`), `src/db/migrations/20261122_customer_accounts.sql`,
  `src/app/api/customer/*`, `src/app/api/orders/*`

## Context

The marketplace historically supported guest checkout with no customer login:
orders were accessed via signed per-order tokens and/or anonymous, cookie-bound
customer session ownership (`crave_customer_session`) and shareable tracking
links. Customers needed an optional way to sign in and access linked order
history and basic saved details across devices without breaking guest flows,
without trusting the browser with money/order state, and without inferring
ownership from unproven identity signals (such as a phone number typed at
checkout).

## Decision

**Introduce authenticated customer accounts as a separate, additive identity and
session model.** Anonymous guest sessions/tokens remain valid; authenticated
sessions grant access only in addition to existing proofs.

### Identity and authentication (current MVP implementation)

- **Verified phone identity (E.164).** Phone numbers are normalized to E.164;
  invalid/unconfident inputs are rejected (fail closed).
- **OTP login/signup.** `POST /api/customer/auth/start` creates an auth challenge
  and `POST /api/customer/auth/verify` verifies the code, finds-or-creates an
  active verified account, and issues an authenticated session.
- **Pluggable sender, dev stub only.** No external SMS provider is wired.
  In non-production, start may issue a dev OTP and return `devCode` in the API
  response for local/testing flows; OTP codes are never logged. In production,
  start/verify are **fail closed** (503) until a real provider/integration is
  configured and explicitly enabled.
- **Challenge hardening.** OTP verifiers are derived via HMAC-SHA256 keyed by a
  server secret when configured (`CUSTOMER_AUTH_OTP_SECRET` /
  `CUSTOMER_SESSION_SECRET` / `RESTAURANT_SESSION_SECRET`, resolved by
  `customer-auth-otp`); non-production may fall back to an unkeyed dev-only
  derivation, production requires a secret. Challenges are bounded by TTL and
  max attempts and are single-use (consumed atomically). Responses are generic
  to avoid account/oracle leakage.

### Sessions and request protection

- **Separate session cookies.** Authenticated account sessions use
  `crave_customer_account_session` (HttpOnly) and `crave_customer_account_csrf`
  (script-readable) with `SameSite=Lax`, `Secure` on TLS requests, and bounded
  lifetimes. Session and CSRF secrets are stored hashed at rest; session tokens
  are not persisted in plaintext.
- **CSRF/origin enforcement for mutating routes.** Mutating authenticated account
  routes require same-origin/cross-site refusal and a valid CSRF double-submit
  token (constant-time/hash comparison), enforced by
  `requireAccountSession(..., { mutating: true })`.
- **Revocation and expiry.** Sessions are revocable (current/all devices) and
  expire; resolution is fail closed for missing/invalid/revoked/expired sessions
  or inactive accounts. Per-account read/write budgets apply to authenticated
  account operations.

### Explicit/proven order linking and dual authorization

- **No auto-link by phone.** Orders are never linked to an account merely because
  a phone number matches. Linking/claiming requires explicit, server-proven
  ownership in the current context.
- **Proven linking paths (additive).**
  - Checkout attributes a new order to the signed-in account when a live account
    session is resolved server-side (`orders.customer_account_id`, nullable).
  - Login (`/api/customer/auth/verify`) best-effort claims orders already owned
    by the caller's anonymous customer session (server-proven possession).
  - `/api/customer/orders/claim` explicitly claims orders proven by anonymous
    session possession and/or verified signed per-order token pairs supplied by
    the client. Only currently unlinked orders are linked (no overwrite/steal).
- **Dual authorization grants.** Per-order access and history accept additive
  proofs: a valid signed `x-order-token`, live anonymous session ownership, or
  explicitly linked authenticated account ownership. Existing token and tracking
  flows remain supported.

### Data model and lifecycle

- Additive tables: `customer_accounts`, `customer_auth_challenges`,
  `customer_account_sessions`, `customer_addresses`, `customer_favorites`, and
  nullable `orders.customer_account_id` (`ON DELETE SET NULL`).
- **Lifecycle cleanup.** Expired/consumed challenges and expired/revoked account
  sessions can be pruned after a retention grace period via
  `cleanupCustomerAuthArtifacts()` / the scheduled
  `POST|GET /api/cron/customer-auth-cleanup` endpoint (cron-auth protected,
  idempotent).

## Consequences

**Positive**
- Customers can opt into sign-in and cross-device access to explicitly linked
  orders and basic saved details without regressing guest checkout or
  token/tracking access.
- Ownership is granted only by proofs the server can verify; phone numbers do not
  become implicit credentials.
- Secrets/OTP material are not logged and credentials are hashed/compared safely;
  production auth fails closed until properly configured.
- Sessions are bounded, revocable, and auditable at the DB level; cleanup bounds
  long-term storage growth.

**Negative / costs**
- More auth state and routes to operate (challenges, sessions, CSRF, budgets).
- Production requires a real SMS/OTP provider and secret configuration before
  customer sign-in can be enabled.
- Some client surfaces remain partially local-first (e.g. personalization
  favorites/consent flows); account-backed favorites/addresses are explicit
  account features and migration is incremental.

## Operational enablement and remaining confirmations

- **Production OTP/SMS delivery:** a generic, vendor-agnostic webhook SMS provider
  is implemented (`CUSTOMER_AUTH_SMS_WEBHOOK_URL`, optional
  `CUSTOMER_AUTH_SMS_WEBHOOK_AUTH`/`_BEARER_TOKEN`, `CUSTOMER_AUTH_SMS_TIMEOUT_MS`;
  POSTs `{ to, code, purpose, message }`, never logs OTPs). Production auth
  start/verify are **fail-closed** by default until a delivery provider (and
  secret) are configured. For temporary/testing use without an SMS provider, an
  explicit opt-in `CUSTOMER_AUTH_EXPOSE_OTP_ON_SCREEN=true` allows on-screen
  dev-code delivery in production (no SMS sent; enable only with understanding of
  the risk, and disable once a real provider is wired). Set provider
  credentials/URL and `CUSTOMER_AUTH_OTP_SECRET` for real delivery. Final
  provider/vendor choice, sender/compliance setup, and rollout validation remain
  operational decisions.
- **Explicit/proven claiming policy (current):** linking remains explicit/proven
  only (anonymous-session possession and/or verified signed order-token pairs on
  claim; anonymous-session claim on sign-in) with **no auto-link by phone**.
  Local personalization data (addresses/favorites/searches) is **not** auto-merged
  into the account on sign-in by default; users save addresses/favorites
  explicitly (including checkout opt-in save and best-effort browse-surface
  favorite sync). Adjust if a different merge/claim UX is desired.
- **Security events (PII-safe):** `customer_auth_verified`,
  `customer_account_session_revoked`, and `customer_orders_claimed` are emitted
  with identifiers/count/flags only (no phone numbers, OTPs, tokens, or full
  addresses), with vocabulary/wiring/tests updated accordingly.
- **Verification:** DB-backed full `npm run verify`/`npm run test:security`
  (and any DB-dependent unit tests) require a reachable PostgreSQL and the app
  runtime as applicable; these were not fully runnable in this environment.