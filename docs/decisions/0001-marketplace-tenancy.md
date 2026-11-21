# ADR-0001: Restaurant-scoped tenancy with a server-minted marketplace id

- **Status:** Accepted (retrospective — records an existing design)
- **Date:** 2026-10-09
- **Related:** `docs/system-design.md` §4, `docs/architecture.md` §10,
  `src/db/schema.ts`, `src/lib/integration-transfer.ts`,
  `src/db/migrations/20261002_integration_transfer_requests.sql`

## Context

The marketplace hosts many independent restaurants and must guarantee that one
restaurant can never read or mutate another's menu, orders, sessions or money.
Two different external parties also need a stable way to refer to a restaurant:

- **the POS ecosystem**, which stores mappings keyed by a restaurant id and
  reconnects over time (possibly under a different marketplace listing);
- **the public web**, where a human-friendly slug is what appears in marketing.

These are different requirements: the POS needs an **opaque, stable, unguessable**
identifier; the public needs a **human-readable** one. A restaurant's internal
surrogate key must also never be exposed or chosen by a tenant.

## Decision

The tenant boundary is the **`restaurants` row**. Every child table carries
`restaurant_id`, and every partner/order/admin query is scoped by it.

Three identifiers coexist on the tenant, each with one job:

| Column | Shape | Purpose | Constraints |
|---|---|---|---|
| `id` | serial | internal tenant key / FK | never exposed |
| `slug` | text | public marketing handle | `UNIQUE`, partner-influenced |
| `marketplace_id` | `rst_…` (12 random bytes, base64url) | canonical external id shared with the POS | `UNIQUE`, **server-minted**, partner may never choose it |

`marketplace_id` is assigned lazily on first access
(`getOrCreateMarketplaceId`) with a retry loop, and backfilled for listings that
predate the column. Because it is `UNIQUE`, a POS reconnecting under a new listing
while its id is still held elsewhere cannot complete the claim; that refusal
arrives *after* the POS has burned a single-use connection code, so rather than
hand-editing rows, the marketplace records an **`integration_transfer_requests`**
row and an operator approves or denies the move. A partial unique index
(`..._pending_uniq` on `(marketplace_id, requested_by_restaurant_id) WHERE status =
'pending'`) allows one open request per pair while keeping decided requests as
history.

Isolation and provenance rules that reinforce the boundary:

- Inbound POS webhooks resolve the tenant from the **stored integration binding**
  (restaurant + external order id), never from the request body.
- Branch/outlet claims are checked against the binding persisted at delivery
  time; a conflicting claim is acknowledged-but-skipped, not applied.
- `integration_audit` is append-only and records actor + event + detail.
- FKs encode intent: `orders.restaurant_id` is `ON DELETE RESTRICT` (financial
  records), while sessions/deliveries/payments cascade.

## Consequences

**Positive**
- One unambiguous tenant key for all scoping; a missed `WHERE restaurant_id`
  cannot be papered over by a shared account.
- The POS gets a stable id that survives listing changes; the public gets a slug
  that can change freely.
- Ownership transfer is an explicit, auditable, ops-approved event instead of an
  out-of-band database edit.

**Negative / costs**
- Every query author must remember to scope by `restaurant_id`; there is no row
  level security policy enforcing it (a least-privilege app DB role exists but is
  not switched over yet).
- `marketplace_id` assignment is lazy, so a listing may exist briefly without one;
  callers must handle `NULL`.
- Transfer requests add an ops workflow and a pending-state machine.

## Alternatives considered

- **Account/user model with the restaurant as a child.** Rejected: the domain has
  one restaurant per partner relationship, and accounts would add a second
  identity layer with no consumer.
- **Use `slug` as the POS id.** Rejected: human-chosen, mutable, guessable, and
  collision-prone across reconnections.
- **Let the POS choose `marketplace_id`.** Rejected: it would let one tenant claim
  another's external id.
- **Global soft-delete / shared tables without `restaurant_id`.** Rejected: the
  isolation guarantee is the core requirement.

## Notes for future work

- Switching the app to the `marketplace_app` least-privilege role (open item)
  would let Postgres enforce part of this boundary.
- No `INTEGER restaurant_id` query on a hot path should be implemented without an
  index; the composite `orders_restaurant_created_idx` is the pattern to follow.
