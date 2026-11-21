# ADR-0003: POS integration authenticates with a passkey-minted bounded session, backed by a sealed shared secret

- **Status:** Accepted (retrospective — records an existing design)
- **Date:** 2026-10-09
- **Related:** `docs/architecture.md` §3.2, §7; `src/lib/integration-session-core.ts`,
  `src/db/queries.ts` (`authenticateIntegration`, `createIntegrationSession`,
  `getIntegrationSession`), `src/lib/owner-key.ts`,
  `src/lib/webhook-crypto.ts`,
  `src/db/migrations/20260930_split_owner_key_and_pos_passkey.sql`,
  `src/db/migrations/20261006_integration_session_security.sql`

## Context

A restaurant's POS must:

1. **Log in** to fetch its orders and identity from the marketplace
   (`Authorization: Bearer …`), after which it polls (relatively frequently).
2. **Receive** marketplace→POS order and payment pushes, and **send** signed menu
   and order-status webhooks back.

The original shared secret was the owner key, which is also the partner console's
credential. Two problems followed:

- **Coupled rotation.** Rotating the POS credential would invalidate the key the
  restaurant holds for the console, and vice versa.
- **A bearer credential with no session.** The same long-lived value authenticated
  every call forever, with no expiry, no revocation, and no record.

Inbound webhooks also need a **shared secret**: the same value must be known to
the marketplace and the POS but stored safely at rest.

## Decision

**Separate credentials per direction of trust, and put a bounded session in front
of the bearer one.**

1. **Passkey is split from the owner key.** `integration_passkey_hash` is a
   distinct column. A non-NULL value **shadows** the owner key at POS
   authentication time; NULL means "never split" and falls back to
   `owner_key_hash` (legacy rows and ops-provisioned listings). Rotation writes
   only the passkey column, so it revokes the POS credential without touching the
   console credential. (`owner-key.ts` `integrationPasskeyMatches`.)

2. **Login mints a session row** (`integration_sessions`): `token_hash` (hashed at
   rest), `restaurant_id`, `code_id`, and **two clocks**:
   - `expires_at` — 60-minute **absolute** ceiling, never slid;
   - `idle_expires_at` — 30-minute **sliding** window pushed forward on every
     authenticated request.

   Policy lives in `integration-session-core.ts` (`integrationSessionIsLive`,
   `nextIdleExpiry`). Checks are ordered revocation → absolute → idle, and a
   missing idle window **fails closed**. A revoking endpoint
   (`/api/integration/revoke`) can end all of a restaurant's sessions; a passkey
   rotation also revokes them.

3. **Webhook secret is sealed at rest.** The POS sends a shared `webhook_secret`
   on claim; the marketplace stores it as an AES-256-GCM envelope
   (`v1.<iv>.<tag>.<cipher>`) keyed by `INTEGRATION_ENVELOPE_KEY`
   (`lib/webhook-crypto.ts`). Inbound menu/order webhooks are HMAC-verified
   (`HMAC(secret, "<integrationId>\n<timestamp>\n<rawBody>")`) with a 5-minute
   skew cap. The envelope key resolver warns loudly when it falls back to
   `RAZORPAY_WEBHOOK_SECRET` and fingerprints the key in use, because a
   cross-environment key mismatch silently breaks delivery for a shared database.

## Consequences

**Positive**
- POS credential rotation is independent of console recovery; a stolen session
  dies on its own (idle window) even if the token is kept warm.
- The server has a record of POS sessions and can revoke them individually or in
  bulk.
- The shared webhook secret is never stored in plaintext and is never returned to
  a client (the `/integrations/verify` route strips it).
- Tokens are hashed at rest, so a database read yields no usable credential.

**Negative / costs**
- Two clocks and two secrets to reason about; a missing idle window is deliberately
  fatal, which can surprise a row migrated without the column.
- The envelope key must be identical across every environment sharing the
  database; the fallback is announced but still a footgun.

## Alternatives considered

- **Keep using the owner key as the POS credential.** Rejected: couples rotation
  and gives the POS the console's recovery secret.
- **Stateless JWT for POS sessions.** Rejected: cannot revoke a single POS terminal
  or "all sessions for this restaurant".
- **Store the webhook secret in plaintext.** Rejected: a database leak would hand
  out the ability to forge signed webhooks to every tenant.
- **Per-session derived webhook secrets.** Not adopted (would complicate the POS's
  shared-secret verification); a single sealed secret per integration is the
  current contract.

## Notes for future work

- `src/lib/security/integration-auth.ts` is an **unused** in-memory session store
  (an earlier draft). The live path is the DB-backed implementation in
  `db/queries.ts`. Deleting the dead file is recommended but out of scope for
  Phase 1.
- `integration_sessions_idle_expires_at_idx` supports a future idle sweep.
