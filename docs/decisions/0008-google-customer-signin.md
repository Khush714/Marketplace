# ADR-0008: Google Sign-In is a free, additive customer onboarding option

- **Status:** Accepted
- **Date:** 2026-11-23
- **Related:** `docs/decisions/0007-customer-accounts.md`,
  `src/lib/customer-google-core.ts`, `src/lib/customer-google-auth.ts`,
  `src/app/api/customer/auth/google/*`, `src/components/customer-auth-dialog.tsx`,
  `src/db/migrations/20261123_customer_google_signin.sql`

## Context

Customer sign-in is on the order path, but a paid SMS provider is not acceptable.
The existing mobile OTP flow already works and must remain available. Google
Sign-In has a free OAuth tier, gives a verified email/identity without sending
SMS, and is familiar to most customers.

## Decision

Add Google Sign-In as an **additional** customer onboarding option. The phone +
OTP flow, its endpoints, config, and UI remain unchanged.

### Authentication flow

- `GET /api/customer/auth/google/status` reports whether Google auth is configured.
- `GET /api/customer/auth/google/start` starts an OAuth 2.0 Authorization Code
  flow with PKCE (`S256`) and a one-time `state` stored in a short-lived HttpOnly
  cookie. It opens in a popup from the auth dialog, with a full-page redirect
  fallback for popup blockers.
- `GET /api/customer/auth/google/callback` exchanges the code, verifies the ID
  token against Google's `tokeninfo` endpoint (audience, issuer, expiry, verified
  email), finds or creates a customer account, and issues the **same** customer
  session cookies used by phone OTP.
- The callback uses a narrow postMessage/redirect response; no token, code, or
  PII is placed in HTML, logs, or URLs beyond the short-lived authorization code.

### Identity model

- A Google account is identified by Google's stable `sub` claim and its verified
  email. `customer_accounts.google_sub` and `customer_accounts.email` are
  nullable, uniquely indexed columns.
- `customer_accounts.phone_e164` becomes nullable. **No phone number is
  synthesized** for Google-only accounts; external DTOs still expose `""` so
  existing UI and the OTP flow are unaffected.
- Google accounts and phone/OTP accounts are separate unless an explicit future
  account-linking flow is added. We do not auto-merge accounts by email.
- The same account session, CSRF, revocation, rate-limit, and order-attribution
  rules apply regardless of sign-in method.

### Fail-closed behavior

- Without `CUSTOMER_GOOGLE_CLIENT_ID` and `CUSTOMER_GOOGLE_CLIENT_SECRET`, the
  status endpoint reports unavailable and the Google button is hidden/disabled.
  Phone OTP remains usable according to its own config.
- A missing/invalid `state`, code exchange failure, tokeninfo failure,
  unverified email, audience mismatch, or expired token fails the sign-in without
  creating a session.

## Consequences

**Positive**
- Zero per-user SMS cost for customers who choose Google.
- No new session model: Google and OTP share accounts, cookies, CSRF, and
  authorization.
- Existing phone OTP onboarding is preserved exactly.

**Negative / costs**
- Requires a one-time Google Cloud OAuth client configuration and an exact
  authorized redirect URI.
- Google-only accounts have no phone number, so phone-based recovery is not
  available for them unless a future linking flow is added.
- The `tokeninfo` verification adds one server-side network call per sign-in;
  it avoids adding a JWT dependency and keeps verification authoritative.

## Operational setup

1. In Google Cloud, create an OAuth 2.0 Client for a Web application.
2. Add the production callback URL as an Authorized redirect URI:
   `https://marketplace-xyz.vercel.app/api/customer/auth/google/callback`
3. Set Vercel Production secrets:
   - `CUSTOMER_GOOGLE_CLIENT_ID`
   - `CUSTOMER_GOOGLE_CLIENT_SECRET`
   - optional `CUSTOMER_GOOGLE_REDIRECT_URI` if the public callback URL differs
     from the request-derived URL.
4. Apply `src/db/migrations/20261123_customer_google_signin.sql` to the production
   database before using the new sign-in path.
5. Redeploy Marketplace. Phone OTP config (`CUSTOMER_AUTH_OTP_SECRET` and the
   current on-screen OTP mode) is left untouched.
