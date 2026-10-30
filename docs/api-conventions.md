# API conventions

Status: living document (Phase 4). This describes the conventions the
**first-party** HTTP surface follows — the routes a browser or our own tooling
calls. It is derived from the code, not aspirational; where a route legitimately
breaks a rule that is listed in §10 as an exception rather than hidden.

Companions: `permissions.md` (the authorization model, actor by actor),
`architecture.md` (runtime topology and guards), `system-design.md` (actors and
workflows), `docs/decisions/0006-security-architecture.md` (why credentials are
shaped this way). The error shape is enforced by unit tests in
`tests/api-conventions.test.ts` and exercised end-to-end by
`tests/security/security.e2e.test.ts`.

The two pure modules this document specifies are:
`src/lib/api-errors-core.ts` (envelope, client-safe) and
`src/lib/security/errors.ts` (server builders), plus
`src/lib/api-pagination-core.ts` (cursor helpers).

---

## 1. Scope

These conventions apply to every route under `src/app/api/**` **except** the
external protocol surfaces listed in §10. Those are contracts with another
system (a POS or Razorpay) and change shape only when that system changes.

Everything is JSON over HTTPS, same-origin. There is **no public API, no API
versioning and no OpenAPI document** — this is the marketplace's own backend.

---

## 2. URLs and methods

- Lowercase, plural-noun resource segments: `/api/orders`, `/api/restaurants`,
  `/api/partner/integrations`. Path parameters are camelCase:
  `/api/orders/[code]`, `/api/restaurants/[slug]`.
- The method is the verb. No `POST /api/getOrder`-style RPC on the first-party
  surface. The deliberate exception is a read whose input is a credential we
  refuse to put in a query string (`POST /api/orders/lookup`,
  `POST /api/orders/attach`) — see §7.
- `GET` reads, `POST` creates, `PATCH` updates, `DELETE` removes. `PUT` is not
  used.
- All first-party routes live under the App Router and are `force-dynamic`
  unless they are public read caches (`/api/restaurants`, `/api/search`,
  `/api/restaurants/[slug]`, which set `Cache-Control: public, s-maxage=60,
  stale-while-revalidate=600`).

## 3. Request validation

- **Bodies are read capped.** Routes call `readJsonBody` / `readRawBodyCapped`
  from `lib/abuse.ts`; `req.json()` is not called directly on the JSON surface.
  The declared `Content-Length` is refused up front and the streamed body is
  capped, so a request cannot park an arbitrary blob in a column.
- **Malformed JSON is a `400`** with `code: "INVALID_REQUEST"` (or a domain
  code such as `BAD_JSON`), never a `500` and never a stack trace. The bytes are
  never echoed back.
- **Fields are rebuilt from a whitelist.** Validation lives in a pure
  `*-core.ts` (e.g. `order-checkout-validation.ts`) that normalises and bounds
  each field; the route passes the rebuilt object, not the raw body, downstream.
- Field-level failures carry a domain code and a caller-safe message. Where a
  failure is not a syntactically bad request but a semantically rejected one,
  the code is `VALIDATION_ERROR`; a missing required field is `INVALID_REQUEST`.
- **Unknown query parameters are ignored**, not rejected. Known ones are
  clamped (`clampSearchQuery`, `clampSlugList`, `parsePageSize`).

## 4. Success responses (2xx)

Success bodies are **not** wrapped in the error envelope. Each route returns the
shape its client reads, e.g. `{ restaurants: [...] }`, `{ order: {...} }`,
`{ ok: true, codeId: 12 }`.

A `2xx` body may carry advisory fields that happen to be named `error` — for
example `POST /api/partner/integrations` returns `202 { ok: true,
connected: false, code: "PENDING_INTEGRATION_SECRET", error: "..." }` and
`GET /api/ops/pos-bridge` returns a diagnostic string. Those are **not** the
error envelope; a client branches on `ok`, not on the field name. See §10.

Creates that mint a resource return `201` (`POST /api/partner/codes`).
Idempotent retries return the original result with `200`.

## 5. Error envelope

Every `4xx`/`5xx` JSON error on the first-party surface is exactly:

```json
{ "error": { "code": "NOT_FOUND", "message": "Not found." } }
```

- `code` — a stable machine token from §6. Clients branch on it.
- `message` — a short, caller-safe sentence. **Never** a caught exception
  message, a `pg`/driver string or a stack trace. Written by hand at the call
  site.
- `details` — **optional**, structured, non-secret context a client genuinely
  needs to render the failure. Never credentials, tokens or raw provider text.
  Currently used for: the contested holder on an integration transfer
  (`{ transfer: {...} }`, `409`), the order `reason`/`currentStatus` on a
  cancellation conflict, and `payment.status`.

Build these with the helpers in `src/lib/security/errors.ts` — `badRequest`,
`unauthorized`, `forbidden`, `notFound`, `conflict`, `payloadTooLarge`,
`unsupportedMediaType`, `tooMany`, `internalError`, `notConfigured`,
`serviceUnavailable`, or the raw `apiError(status, message?, code?, {headers?,
details?})`. A route must never hand-build `{ error: ... }`.

The client reader is `readApiError(body)` → `{ code, message, details? } | null`
and `apiErrorMessage(body, fallback)`, both in `src/lib/api-errors-core.ts`. The
reader is **tolerant of the legacy bare-string** `{ error: "..." }` (it reports
`code: "UNKNOWN"`) so an external-contract response can be consumed by shared
frontend code without crashing it; `UNKNOWN` is not a real code and must not be
branched on.

## 6. Error codes

Standard codes (the finite set in `API_ERROR_CODES`):

| Code | Status | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 | Malformed or unparseable request |
| `VALIDATION_ERROR` | 400 | Well-formed but semantically rejected |
| `UNAUTHORIZED` | 401 | Missing or invalid credential |
| `FORBIDDEN` | 403 | Authenticated but not permitted (incl. cross-site / CSRF) |
| `NOT_FOUND` | 404 | No such resource, or an oracle-free deny |
| `CONFLICT` | 409 | Conflicts with current state |
| `RATE_LIMITED` | 429 | Budget exhausted (`Retry-After` when known) |
| `PAYLOAD_TOO_LARGE` | 413 | Declared or streamed body over the cap |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body is not the expected content type |
| `INTERNAL_ERROR` | 500 | Unexpected server failure |
| `NOT_CONFIGURED` | 503 | Deployment missing a required secret (fail closed) |
| `SERVICE_UNAVAILABLE` | 503 | Healthy app, dependency down (retryable) |

`NOT_CONFIGURED` and `SERVICE_UNAVAILABLE` are deliberately distinct: the first
means page an operator, the second means retry.

**Domain codes are preserved** where a specific code is more useful than the
status default, e.g. `MARKETPLACE_ID_TAKEN`, `PROVIDER_NOT_CONFIGURED`,
`ORDER_TOKENS_UNAVAILABLE`, `SESSION_REQUIRED`, `CSRF_INVALID`, `BAD_JSON`,
`MISSING_FIELDS`, `DELETE_CONFIRMATION_REQUIRED`. The default for a status comes
from `DEFAULT_CODE_BY_STATUS`; a status with no mapping falls back to
`INTERNAL_ERROR`.

## 7. Authentication and authorization

The full actor/guard/permission model is in `permissions.md`. Conventions:

- **No customer accounts.** A customer proves ownership with a signed **order
  token** (`x-order-token`) or a **tracking token** in the URL, or an anonymous
  customer-session cookie.
- Partner routes carry the **restaurant session cookie**
  (`crave_restaurant_session`) and, on mutations, the double-submit CSRF header
  `x-csrf-token` (`crave_restaurant_csrf` cookie).
- Ops routes carry `x-ops-token`; cron routes carry `CRON_SECRET` (bearer) or
  the trusted Vercel cron header.
- **Guards run before work.** Mutating routes call `guardWrite(scope)`; reads
  call `guardRead(scope)`. A guard refusal returns the envelope — `403`
  (`FORBIDDEN`) for cross-site, `429` (`RATE_LIMITED`) for budget, `413` for an
  oversized body.
- **Fail closed.** A missing secret denies. See `lib/ops-auth.ts`,
  `lib/cron-auth.ts`, `integrations/payments/provider-session.ts`.
- **Order access never leaks existence.** A bad/absent order token is answered
  with the same `404` as a missing order (no oracle).
- Credentials are hashed at rest and compared in constant time
  (`lib/owner-key.ts`, `timingSafeEqual`).

## 8. Restaurant context (tenancy)

- Tenancy is **restaurant-scoped**. Every query is scoped by `restaurant_id`; a
  missing scope is a cross-tenant leak.
- The caller's restaurant is derived from the credential (session / bearer),
  never from the request body. A `restaurant_id` in a body is **not** trusted.
- Ops routes that must act across tenants are gated by `x-ops-token` and record
  an audit row (`recordIntegrationAudit`).

## 9. Pagination

Unbounded list queries take an optional page and the route returns a cursor:

- Request: `?limit=<n>&cursor=<opaque>`. `limit` is clamped to
  `(0, MAX_PAGE_SIZE=100]`; a bad/absent value defaults to `DEFAULT_PAGE_SIZE=24`
  (`50` for the ops listing). `cursor` is opaque; a malformed cursor decodes to
  offset `0`, never an error.
- Response: `{ <items>: [...], nextCursor: "<opaque>" | null }`. `nextCursor` is
  `null` on the last (short) page.
- The cursor is a base64url-encoded **offset** (`api-pagination-core.ts`).
  Offset is the pragmatic choice for browse's five sort orders; keyset would
  need a per-sort tuple. The trade-off (a row inserted mid-walk can shift a
  later page) is acceptable for a low-write public catalogue.
- Query helpers apply a **hard default cap** (`DEFAULT_LIST_LIMIT=60`) when a
  caller does not paginate, so even an RSC list is bounded.

Paginated routes: `GET /api/restaurants` (browse; `featured=1` applies a limit
only), `GET /api/ops/owner-key`.

**Intentionally bounded, not paginated** (they already `limit` in SQL):
`searchAll` (5 restaurants + 6 dishes), `listConnectionCodes(30)`,
`listConnections(30)`, `listIntegrationOrders(30)`,
`listIntegrationTransfers(50)`, `listOrders(30)`.

## 10. Exceptions (do not "fix" these)

- **External protocol contracts** — left in their own shape on purpose:
  `POST /api/integration/*` (POS login/logout/orders/identity/passkey/restaurant/
  revoke) and `POST /api/integrations/**` (POS order webhooks, payment webhook
  and ops, POS drain). These return `{ ok: false, error: "<string>" }` or the
  provider's own shape (e.g. `{ success: false, error: "..." }` for Razorpay).
  Changing them would break the POS and the payment provider.
- **2xx advisory `error`** — `POST /api/partner/integrations` (`202`) and
  `GET /api/ops/pos-bridge` (diagnostic string) are success responses; see §4.
- **Nested `ok:false`** — `GET /api/health` and `GET /api/ops/queue-health`
  return `{ ok: false, error: { code, message } }` on `500`/`503` because their
  top-level `ok` boolean is the contract their probes read; the nested `error`
  is the §5 envelope.
- `GET /api/ops/queue-health` is intentionally unauthenticated (counters only).
- `POST /api/partner/signup` is open but inert (`is_active = false`);
  `POST /api/partner/connect` is an open, rate-limited redemption.

## 11. Status codes at a glance

| Status | When | Envelope code |
|---|---|---|
| 200 | Read or idempotent retry succeeded | — (success body) |
| 201 | Resource created | — (success body) |
| 202 | Accepted, not yet complete (async connect) | — (success body) |
| 400 | Malformed / rejected request | `INVALID_REQUEST` / `VALIDATION_ERROR` / domain |
| 401 | Missing or invalid credential | `UNAUTHORIZED` |
| 403 | Authenticated but denied, cross-site, CSRF | `FORBIDDEN` / `CSRF_INVALID` |
| 404 | No such resource, or oracle-free deny | `NOT_FOUND` |
| 409 | State conflict | `CONFLICT` / domain |
| 413 | Body over cap | `PAYLOAD_TOO_LARGE` |
| 415 | Wrong content type | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | Budget exhausted | `RATE_LIMITED` |
| 500 | Unexpected failure | `INTERNAL_ERROR` |
| 503 | Unconfigured (fail-closed) / dependency down | `NOT_CONFIGURED` / `SERVICE_UNAVAILABLE` |

## 12. Adding a route (checklist)

1. Add a budget in `abuse-core.ts` for any new public route.
2. Guard before work: `guardWrite(scope)` / `guardRead(scope)`, then the
   credential check.
3. Read bodies with `readJsonBody` / `readRawBodyCapped`; rebuild inputs from a
   whitelist (put the policy in a pure `*-core.ts`).
4. Return errors with the §5 helpers; never hand-build the body, never echo a
   `Throwable`.
5. Scope every query by `restaurant_id`.
6. Paginate genuinely unbounded lists (§9) and return `nextCursor`.
7. Emit through `lib/security/security-events.ts`; never log a secret.
