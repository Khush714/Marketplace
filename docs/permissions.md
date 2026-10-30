# Permissions

Status: living document (Phase 3). This is the **authorization model as the code
actually enforces it**, not an aspiration. Every row below was derived by reading
the route handlers and their guards; where the code is weaker than it should be
that is recorded in §8 rather than quietly omitted.

Companions: `architecture.md` §? (runtime/guards), `system-design.md` (actors and
sensitivity), `docs/decisions/` (why the credentials are shaped this way). The
enforcement is exercised end-to-end by `tests/security/security.e2e.test.ts`.

---

## 1. Actors

The app has **no customer accounts**. Five caller classes exist:

| Actor | Proof of identity | Lifetime | Where it rides |
|---|---|---|---|
| **Anonymous customer** | none, or a signed *order token* / *tracking token*, or an anonymous *customer session* cookie | per-order / 30d session | browser |
| **Restaurant partner** | owner key exchanged for a **restaurant session** cookie (+ CSRF cookie); or the owner key itself in a change-credential body | 30d session | browser console `/partner/*` |
| **Restaurant POS** | **integration bearer token** (login with connection code + passkey), or a per-connection **webhook HMAC secret** | 30d session / static secret | POS terminal |
| **Operations** | **ops token** (`x-ops-token`), or **cron secret** (`CRON_SECRET` / `x-vercel-cron` on Vercel) | static secret | ops console / scheduler |
| **Payment provider** | **Razorpay webhook HMAC** over the raw body | static secret | Razorpay → webhook |

The **owner key** is the root credential for a restaurant. It is hashed at rest
(`owner_key_hash`) and never leaves the server except in the response that mints
or rotates it (shown once). The **integration passkey** is a *separate* credential
(`integration_passkey_hash`) deliberately split from the owner key so a POS can be
revoked without locking the owner out and vice-versa.

---

## 2. Credential / guard reference

| Guard | File | Accepts | Denies with |
|---|---|---|---|
| `guardRead(scope)` / `guardWrite(scope)` | `lib/abuse.ts` | origin check (writes), per-IP/session budget, declared+streamed body cap | 403 cross-site, 429 rate-limited, 413 oversized |
| `requirePartnerSession(req, { mutating })` | `lib/security/restaurant-session.ts` | `crave_restaurant_session` cookie + `crave_restaurant_csrf` on writes | 401 no/dead session, 403 CSRF/origin, 429 budget |
| `authoriseMenu(req, mutating)` | `lib/partner-menu-api.ts` | wraps `requirePartnerSession`; returns `restaurantId` | same as above |
| `requireOpsToken(req)` | `lib/ops-auth.ts` | `x-ops-token`, constant-time | 401 missing/wrong; **503** when unconfigured in production; **open in dev when unset** |
| `requireCronAuth(req)` | `lib/cron-auth.ts` | `CRON_SECRET`, or ops token, or trusted `x-vercel-cron` | 401 missing/wrong; 503 unconfigured |
| `requireIntegrationAuth(req)` | `src/app/api/integration/_auth.ts` | `Authorization: Bearer <token>` → integration session | 401 |
| `verifyOrderToken(code, token)` | `lib/order-token.ts` | HMAC `x-order-token` for the code | **404** (indistinguishable from "no such order") |
| `verifyConnectionWebhook` (POS HMAC) | `lib/webhook-crypto.ts` | `x-crave-signature` over raw body + timestamp | 401 bad/stale signature, 403 unknown tenant |
| `verifyRazorpaySignature` | `lib/payment-webhook` path | `x-razorpay-signature` over raw body | 400 |

Guards run **before work** and every unpriced public route has a budget in
`abuse-core.ts`.

---

## 3. Permission matrix (actor × resource)

Legend: **Y** allowed · **—** not applicable/not held · **Own** allowed only for
the actor's own restaurant · **404** hidden behind a not-found oracle.

| Resource / action | Anonymous | Customer (token/session) | Partner session | POS bearer | Ops / cron | Razorpay |
|---|---|---|---|---|---|---|
| Browse restaurants, search | Y | Y | Y | Y | Y | — |
| Read public restaurant profile | Y | Y | Y | Y | Y | — |
| Queue health counters | Y | Y | Y | Y | Y | — |
| Create order (checkout) | Y | Y | Y | — | — | — |
| Preview bill | Y | Y | — | — | — | — |
| Attach orders to customer session | Y | Y (own codes) | — | — | — | — |
| Lookup own orders by code+token | — | Own | — | — | — | — |
| Read an order (public projection) | 404 | Own (token/track) | — | Own (bearer) | — | — |
| Start / verify payment | — | Own | — | — | — | — |
| Cancel order | — | Own | — | — | — | — |
| Read own POS orders | — | — | — | Own | — | — |
| Read/update own POS identity | — | — | — | Own | — | — |
| Rotate POS passkey | — | — | — | Own | — | — |
| Read own listing / edit profile | — | — | Own | — | — | — |
| Self-signup (inert) | Y (rate-limited) | — | — | — | — | — |
| Redeem connection code | Y (rate-limited) | — | — | — | — | — |
| Manage own menu | — | — | Own | — | — | — |
| Delete own listing | — | — | Own (+ typed name + single-use token) | — | — | — |
| Rotate own owner key | Y (key-in-body, rate-limited) | — | — | — | — | — |
| Mint / list / revoke connection codes | — | — | — | — | Ops | — |
| List POS connections | — | — | — | — | Ops | — |
| Featured / owner-key / pos-bridge ops | — | — | — | — | Ops | — |
| Trigger POS/payment drains | — | — | — | — | Ops or cron | — |
| Integration transfers read | — | — | — | — | Ops | — |
| POS order-status webhooks | — | — | — | — | HMAC (POS) | — |
| Payment webhook | — | — | — | — | — | HMAC |

Two intentional "public" openings carry **no tenant data and no capability**:
`GET /api/ops/queue-health` (four integers per journal, no tenant rows) and
`POST /api/partner/signup` (writes `is_active = false`; invisible and unorderable
until a POS proves ownership). Both are rate-limited.

---

## 4. Route-by-route guard map

53 route files under `src/app/api/**/route.ts`. Method in parentheses.

### Public reads (no identity)
- `GET /api/health` — no guard (liveness; `{ ok }` only).
- `GET /api/ops/queue-health` — no guard; counters only.
- `GET /api/search` — `guardRead("search")`.
- `GET /api/restaurants` — `guardRead("restaurants")`.
- `GET /api/restaurants/[slug]` — `guardRead("restaurants")`.

### Public writes (budget + origin; no identity)
- `POST /api/orders` — `guardWrite("checkout")`.
- `POST /api/orders/bill` — `guardWrite("billPreview")`.
- `POST /api/orders/attach` — `guardWrite("customerSession")`; each code verified by `verifyOrderToken` before binding.
- `POST /api/orders/lookup` — `guardWrite("orderLookup")`; returns only code+token pairs that verify.
- `POST /api/partner/signup` — origin + honeypot + `partner-signup` limit (3/h).
- `POST /api/partner/connect` — origin + honeypot + `partner-connect` limit (10/10m); the single-use code is the capability.
- `POST /api/integration/login` — `guardWrite("integrationLogin")`; code + passkey.

### Customer order access (order token / tracking token) — failure is always 404
- `GET /api/orders/[code]` — `verifyOrderToken` then `guardRead("orderLookup")`.
- `POST /api/orders/[code]/pay/start` — `guardWrite("paymentStart")` then `verifyOrderToken`.
- `POST /api/orders/[code]/pay/verify` — `guardWrite("paymentVerify")` then `verifyOrderToken`.
- `POST /api/orders/[code]/cancel` — `verifyOrderToken` only (**no `guardWrite`** — see §8).
- `GET /api/orders/track/[trackingToken]` — tracking token lookup + `guardRead("orderLookup")`.

### Integration bearer (POS)
- `GET /api/integration/orders` — `requireIntegrationAuth`.
- `GET /api/integration/restaurant` — `requireIntegrationAuth`.
- `GET /api/integration/identity`, `POST /api/integration/identity` — `requireIntegrationAuth`.
- `POST /api/integration/logout` — `requireIntegrationAuth`.
- `POST /api/integration/revoke` — `requireIntegrationAuth`.
- `POST /api/integration/passkey/rotate` — `guardBudget("passkeyRotate")` then `requireIntegrationAuth`.

### Partner session
- `POST /api/partner/session` — `guardWrite("ownerVerify")`; owner key → session cookies.
- `GET /api/partner/session`, `DELETE /api/partner/session` — `requirePartnerSession(mutating:false/true)`.
- `GET|PATCH|DELETE /api/partner/restaurant` — `requirePartnerSession`.
- `POST /api/partner/restaurant/delete-intent` — `requirePartnerSession(mutating:true)`.
- `GET|POST|DELETE /api/partner/integrations` — `requirePartnerSession`.
- `POST /api/partner/integrations/verify` — `requirePartnerSession(mutating:true)`.
- `POST /api/partner/owner-key/rotate` — owner key in body (possession proof) + `partner-owner-key-rotate` limit (5/h); 404 for unknown key.

### Partner menu (`authoriseMenu`)
- `GET /api/partner/menu` — `authoriseMenu(false)`.
- `POST /api/partner/menu/items` — `authoriseMenu(true)`.
- `GET|PATCH|DELETE /api/partner/menu/items/[id]` — `authoriseMenu(true)`.
- `POST|DELETE /api/partner/menu/items/[id]/modifier-groups` — `authoriseMenu(true)`.
- `DELETE /api/partner/menu/items/[id]/modifier-groups/[groupId]` — `authoriseMenu(true)`.
- `GET|POST /api/partner/menu/modifier-groups` — `authoriseMenu`.
- `GET|PATCH|DELETE /api/partner/menu/modifier-groups/[id]` — `authoriseMenu(true)`.

### Ops token
- `GET|POST /api/partner/codes`; `GET|DELETE /api/partner/codes/[code]`.
- `GET /api/partner/connect`.
- `GET|POST|DELETE /api/ops/featured`.
- `GET|POST /api/ops/owner-key`.
- `POST /api/ops/pos-bridge`.
- `GET /api/ops/integration-transfers`.
- `POST /api/integrations/pos/drain`.
- `GET|POST /api/integrations/payments/ops`.

### Cron / internal (ops token or cron secret)
- `GET /api/cron/pos-drain`.
- `GET /api/cron/payments-drain`.
- `GET /api/internal/pos-delivery-drain`.

### POS webhooks (per-connection HMAC)
- `POST /api/integrations/webhooks/order-status`
- `POST /api/integrations/webhooks/order-rejected`
- `POST /api/integrations/webhooks/order-cancelled`
- `POST /api/integrations/webhooks/order-accepted`
- `POST /api/integrations/webhooks/menu-item`

### Payment provider
- `POST /api/integrations/payments/webhook` — Razorpay raw-body HMAC.

---

## 5. Tenancy invariants

1. **Every query is scoped by `restaurant_id`.** Menu edits resolve the owner
   from the session and match `(item_id, restaurant_id)` in the `WHERE`
   (`db/partner-menu.ts` `ownedItem`); an id belonging to another tenant is a
   miss → `400 "Dish not found"`, never a cross-tenant read.
2. **No route accepts a restaurant id from the client.** The tenant always comes
   from the credential (session row, integration session row, webhook secret →
   connection → restaurant).
3. **Session death cascades.** Deleting a listing removes its orders, sessions and
   integration sessions (restaurant deletion suite asserts this).
4. **Owner-key rotation revokes sessions.** `rotateOwnerKeyAsRestaurant` +
   `revokeRestaurantSessionsForRestaurant`; a stolen old key cannot keep a live
   session after rotation.
5. **Tenant confusion is a 403, not a 200.** A signature valid for restaurant A
   against restaurant B is refused (`403` unknown tenant) before any write.

---

## 6. Failure semantics (why these statuses)

| Situation | Response | Rationale |
|---|---|---|
| No / dead / revoked credential | **401** | "You are not who you claim"; no resource detail leaked. |
| Valid credential, wrong origin / missing CSRF | **403** | Authenticated but the request is forged. |
| Guessed order code / tracking token | **404** | Identical to "no such order"; no enumeration oracle. |
| Guessed owner key (login / rotate) | **404** | Same reason; cannot confirm a key matches a real listing. |
| Cross-tenant object id | `400 "not found"` or **404** | No cross-tenant existence signal. |
| Over budget | **429** | `Retry-After` set. |
| Privileged surface unconfigured in production | **503** | Fail closed — a missing secret denies, never opens. |
| Bad webhook signature | **400** (Razorpay) / **401** (POS) | Provider conventions; no money/delivery state moves. |

---

## 7. What the security suite proves

`tests/security/security.e2e.test.ts` (runs against a real `next start` + scratch
DB; fails closed in CI when PostgreSQL is absent):

- **ops admin auth** — ops routes refuse no/wrong token, accept the token.
- **partner session lifecycle** — no session → 401; wrong key → 404; CSRF-less
  write → 403; sign-out/expiry/revocation → 401.
- **A/B authorization isolation** — each session reads/edits only its own listing;
  a partner session cannot mint codes or list connections; an integration token is
  not an admin credential.
- **order privacy + enumeration** — token required, wrong token → 404, tracking
  token → 404 on guess, enumeration rate-limited.
- **connection-code redemption** — single-use, revoked/expired/used → 400,
  message-enumeration harmless, off-vocabulary rejection does not spend the code.
- **integration bearer scoping** — its token sees only its restaurant's orders;
  garbage/expired/revoked → 401; cannot mint codes.
- **restaurant deletion gates** — session+CSRF required, single-use confirmation
  bound to the session, expired refused, success cascades, throttled at 3/h.
- **payment webhook verification** — signature required, amount/currency
  mismatches fail the payment, replay deduped, forged capture never advances money.
- **permission matrix (Phase 3)** — see §8 additions: menu-item cross-tenant IDOR,
  ops surface rejection for partner/POS credentials, cron fail-closed, owner-key
  rotation revocation.

---

## 8. Known gaps (do not mistake for current behaviour)

These are recorded, not hidden. They mirror `architecture.md` §12.

- **`POST /api/orders/[code]/cancel` lacks `guardWrite`.** It still requires a
  valid order token, so it is not unauthenticated, but it has no origin check or
  budget. Candidate for a fix; tracked here.
- **`requireOpsToken` is open in dev when unset.** Production fails closed (503);
  a dev machine with no token intentionally has an open ops surface, and the
  `admin_login/open_surface` security event makes that visible.
- **Cron routes accept the ops token.** One secret to provision, but it means the
  drain surface and the ops console share a credential.
- **`lib/order-authorized.ts` (dual token OR customer-session)** exists but the
  read routes currently authorize on the signed order token alone; the customer
  session is bound at `attach` and used for lookup, not yet for `[code]` reads.
- **Rate limits are per-instance.** On a multi-instance deployment the effective
  budget is per-instance, not global.
