# ADR-0002: Restaurant partners get sessions; the owner key becomes a recovery credential

- **Status:** Accepted (retrospective — records an existing design)
- **Date:** 2026-10-09
- **Related:** `docs/architecture.md` §3.1, `src/lib/restaurant-session-core.ts`,
  `src/lib/security/restaurant-session.ts`, `src/db/schema.ts`
  (`restaurant_sessions`), `src/db/migrations/20261004_restaurant_sessions.sql`

## Context

The partner console (`/partner`, `/partner/menu`, `/partner/integrations`) was
originally authenticated by the **owner key itself**. `owner_key_hash` proved
ownership, authenticated every `/api/partner/*` call, and was replayed by the
browser on each one. As a session that is three failures at once:

1. **It never expires.** A leaked key is a permanent key.
2. **It cannot be revoked** without destroying the restaurant's only credential —
   "sign out everywhere" is not expressible.
3. **The server keeps no record of who is signed in**, so there is no audit of
   active sessions and no kill switch.

It also lived in web storage, so an XSS could read it. The `x-owner-key` header
did provide implicit CSRF protection (a custom header forces a CORS preflight a
cross-origin form cannot pass) — a property any cookie-based replacement must
rebuild deliberately.

## Decision

The owner key is **demoted to a recovery credential** and exchanged exactly once
for a row in `restaurant_sessions`. The session row carries:

- `token_hash` — the session token, hashed at rest (SHA-256), presented via an
  `HttpOnly` `crave_restaurant_session` cookie.
- `csrf_hash` — paired CSRF token, presented via a **non-HttpOnly**
  `crave_restaurant_csrf` cookie and echoed in the `x-csrf-token` header on
  state-changing requests.
- `expires_at` (30 days), `revoked_at`, `last_used_at`.
- `delete_confirm_hash` + `delete_confirm_expires_at` (10 minutes) — a
  single-use confirmation for the one irreversible operation (listing deletion).

Cookie attributes are built in `restaurant-session-core.ts` so they are testable:
`HttpOnly` (session) / script-readable (CSRF), `SameSite=Lax`, `Secure` when the
request arrived over TLS, `Path=/`. Session and CSRF cookies share lifetime and
`SameSite` via one `cookieAttributes` helper so they cannot drift.

Policy is split into `restaurant-session-core.ts` (pure, unit-testable:
`sessionIsLive`, `csrfMatches`, `deleteConfirmationIsLive`, cookie builders) and
`security/restaurant-session.ts` (server wiring with `requirePartnerSession`).
Rotation of the owner key revokes live sessions
(`revokeRestaurantSessionsForRestaurant`).

## Consequences

**Positive**
- Bounded lifetime and a real kill switch, without locking the partner out (the
  owner key still recovers access).
- Credential is unreadable by script (`HttpOnly`), so an XSS cannot exfiltrate it.
- CSRF is explicit and testable rather than an incidental property of a header.
- Server has a record of active sessions and can emit
  `restaurant_session_created`/`restaurant_session_revoked` security events.

**Negative / costs**
- Two cookies and a header to keep in step; `SameSite=Lax` plus the double-submit
  token must both be present.
- The CSRF cookie is intentionally readable by script; the design accepts this
  because reading it is not what makes an attack work, and a cross-origin page
  still cannot read it or set the header.
- More moving parts than "send the key every time", and one extra DB read per
  authenticated request.

## Alternatives considered

- **Keep the owner key as the session.** Rejected: no expiry, no revocation, no
  audit, token in web storage.
- **JWT/signed cookie with no server row.** Rejected: a signed token can still be
  revoked only by rotating the signing key (all users) and keeps no active-session
  record; a per-session row is what makes "sign out everywhere" and rotation
  precise.
- **`SameSite=Strict`.** Considered but rejected for the primary defence: `Strict`
  drops the cookie on the top-level link a partner is most likely to click first;
  `Lax` + CSRF token is the chosen balance.
- **Derive the CSRF token from the session token.** Rejected: leaking one would
  leak the other, and session rotation would force CSRF rotation.

## Notes for future work

- The expired-session sweep is supported by
  `restaurant_sessions_expires_at_idx`; ensure any reaper is scheduled.
- The same cookie machinery is shared with the customer session
  (`cookieAttributes` in `restaurant-session-core.ts`); changes to attributes
  affect both.
