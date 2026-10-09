# Database Audit

Status: Phase 2 (Database & Backup Hardening). Evidence-based audit of the
PostgreSQL schema and the query layer. Companion to `docs/architecture.md` §5/§12
and `docs/decisions/0001-marketplace-tenancy.md`.

Everything below describes the schema as defined in `src/db/schema.ts` and the
patches under `src/db/migrations/`. The base tables are materialised by
`drizzle-kit push` (or the harness's `drizzle-kit generate`); the 15 SQL files are
idempotent, additive patches layered on top — there is no "base" migration file
(see `tests/security/harness.ts` §bootstrap).

Scope: **22 tables** (`schema.ts`) plus the runner-owned `schema_migrations`
ledger. Money is integer paise in `*_cents`; `bigint` POS ids use
`mode: "number"`. Neither convention is changed by this audit.

---

## 1. Verdict

The schema is **structurally sound** and the query layer is **free of the classic
performance traps** (no N+1 in the hot paths, no unbounded public list that
matters, no missing index on a hot predicate). Tenancy is enforced by an explicit
`restaurant_id` column on every tenant-owned table and by call-site guards in the
query layer.

Two gaps are worth fixing, neither of them a correctness bug today:

- **D1 — no CHECK constraints.** No column validates its domain: payment/order
  status are free text, and money columns accept negatives. The application
  enforces these invariants, but the database does not backstop it.
- **D2 — no per-table creation timestamp on some menu tables.** Sync mirrors
  (`menu_categories`, `menu_items`, `modifier_groups`, `modifier_options`,
  `menu_item_modifier_groups`) carry only `last_synced_at`; there is no
  `created_at`. This is deliberate (they mirror POS state, not user actions) but
  worth recording so no one mistakes it for an omission.

These are recorded as recommendations in §4; §3.1 of the migration plan.

---

## 2. Schema audit (2.1)

### 2.1.1 Keys, foreign keys and delete behaviour

- **Primary keys:** every table has a `serial` `id` PK. `schema_migrations` uses a
  `text` PK (`filename`). No table relies on an implicit/absent key.
- **Foreign keys:** 28 FKs, **all with an explicit `ON DELETE`**. There is no
  bare `REFERENCES` in the schema — the behaviour of every delete path is chosen,
  not defaulted. `ON UPDATE` is uniformly `NO ACTION`, which is correct because
  every target is an immutable `serial`.
- **Delete actions are deliberate and documented in-file:**
  - `CASCADE` — child state that is meaningless without the parent
    (`restaurant_sessions`, `menu_*`, `modifier_*`,
    `menu_item_modifier_groups`, `connections`, `integration_sessions`,
    `integration_records`, `integration_transfer_requests` (both restaurant
    columns), `integration_*payment/delivery journals`, `marketplace_order_events`,
    `menu_webhook_events`).
  - `SET NULL` — audit/history that should outlive the parent
    (`integration_audit.restaurant_id`, `marketplace_payment_events.payment_reference`).
  - `RESTRICT` — `orders.restaurant_id`. Orders are financial records; removing a
    restaurant must go through an explicit delete, not silently destroy revenue
    history (`queries.ts:1233` `deleteRestaurantById` deletes orders first, in one
    transaction).
  - `NO ACTION` — `connections.code_id`, `integration_sessions.code_id`. Connection
    codes are append-only; revocation flips `status`, it never deletes the row.
- **`deleteRestaurantById` (`queries.ts:1233`) is complete.** It explicitly
  deletes `orders`, `connections`, `integration_sessions`, `menu_items`, then the
  restaurant; every other tenant table cascades. `integration_audit` rows are
  intentionally retained with `restaurant_id = NULL`. No orphan class found.

### 2.1.2 Uniqueness and idempotency keys

All load-bearing idempotency keys are backed by a UNIQUE index (AGENTS.md rule 7):

| Key | Table | Constraint |
|---|---|---|
| `orders.code` | orders | unique |
| `orders.client_request_id` | orders | unique |
| `orders.external_order_id` | orders | unique index |
| `orders.tracking_token_hash` | orders | unique index |
| `marketplace_payments.payment_reference` | marketplace_payments | unique |
| `(provider, provider_payment_id)` | marketplace_payments | unique index |
| `(provider, provider_order_id)` | marketplace_payments | unique index |
| `marketplace_payment_events.event_id` | marketplace_payment_events | unique index |
| `marketplace_order_events.event_id` | marketplace_order_events | unique index |
| `marketplace_pos_payment_deliveries.event_id` | …payment_deliveries | unique index |
| `pos_order_deliveries.marketplace_order_id` / `external_order_id` | …order_deliveries | unique index |
| `menu_webhook_events.event_id` | menu_webhook_events | unique |
| `menu_categories (restaurant_id, pos_category_id)` | menu_categories | unique index |
| `menu_items (restaurant_id, pos_item_id)` | menu_items | unique |
| `modifier_groups (restaurant_id, pos_group_id)` | modifier_groups | unique index |
| `modifier_options (group_id, pos_option_id)` | modifier_options | unique index |
| `menu_item_modifier_groups (menu_item_id, modifier_group_id)` | menu_item_modifier_groups | unique index |
| `connections.code_id` / `connections.restaurant_id` | connections | unique |
| `integration_records.restaurant_id` | integration_records | unique |
| partial unique `(marketplace_id, requested_by_restaurant_id) WHERE status='pending'` | integration_transfer_requests | unique index |

`posOrderDeliveries`, `marketplacePayments` and `marketplacePosPaymentDeliveries`
use **explicit short FK constraint names** because Postgres truncates
auto-generated names past 63 chars, which makes `db:push` drop/re-add them on
every run (`schema.ts:606-617` and elsewhere).

### 2.1.3 Tenancy

A `restaurant_id` column is present on every tenant-owned table. The exceptions
are global by design and are the only tables a scoped query should be allowed to
read without a restaurant predicate:

| Table | Why it has no `restaurant_id` |
|---|---|
| `restaurants` | the tenant root itself |
| `customer_sessions` | one anonymous browser session spans restaurants; `order_codes` is a jsonb list, deliberately not a join table |
| `connection_codes` | minted before any restaurant exists (global, pre-binding) |
| `marketplace_payment_events` | provider-global webhook ledger keyed by `event_id`; read via `payment_reference → marketplace_payments` |
| `admin_sessions` | platform-operator sessions, not tenant sessions |

No cross-tenant column leak found: tables that carry `restaurant_id` never let a
query drop the predicate without an explicit code path, and the two-table
indirection tables (`modifier_options`, `menu_item_modifier_groups`,
`pos_deliveries`, `marketplace_pos_payment_deliveries`, `marketplace_order_events`)
carry their own `restaurant_id` in addition to the FK, so a scoped filter does
not require a join. Verified against the live catalogue: FK/unique/PK inventory
matches `schema.ts`.

### 2.1.4 Indexes

Index coverage is strong (largely Phase 10 work, kept in `schema.ts`):

- Foreign-key-adjacent hot lookups: `restaurants_owner_key_hash_idx`,
  `restaurant_sessions_restaurant_id_idx`, `menu_restaurant_idx`,
  `integration_sessions_restaurant_id_idx`, `integration_records_restaurant_idx`,
  `integration_audit_restaurant_idx`, `modifier_options_restaurant_idx`,
  `menu_item_mod_groups_restaurant_idx`, `marketplace_payments_order_idx` /
  `_restaurant_idx` / `_status_idx`, `marketplace_order_events_restaurant_idx`.
- Recency/composite: `orders (restaurant_id, created_at)` and a separate
  `orders (created_at)` for cross-restaurant scans; `orders_phone_idx`.
- Scheduler/sweep: `restaurant_sessions_expires_at_idx`,
  `customer_sessions_expires_at_idx`, `admin_sessions_expires_at_idx`,
  `integration_sessions_idle_expires_at_idx`,
  `pos_deliveries_status_attempt_idx`, `pos_payment_deliveries_status_attempt_idx`,
  `integration_transfer_requests_status_idx`, `connection_codes_status_idx`.

No hot predicate was found that lacks an index. `orders.created_at` and
`orders (restaurant_id, created_at)` are intentionally both present; the plain
`created_at` index is the only one that can serve a global time-range scan.

### 2.1.5 Timestamps

`created_at` is present with `defaultNow()` on 17 tables. `updated_at` is present
only where a row is actually mutated (`integration_records`,
`pos_order_deliveries`, `marketplace_payments`, `pos_payment_deliveries`).
`connection_codes`/`connections` carry `created_at`/`connected_at` but no
`updated_at` — acceptable, since the only mutation is a `status`/`revoked_at`
flip. The sync mirrors carry only `last_synced_at` (see D2).

**Gap D2 (low):** a sync mirror row cannot answer "when was this dish first
seen?" only "when was it last synced?". This is by design, not a bug.

---

## 3. Query audit (2.2)

Reviewed the data-access modules: `queries.ts` (3222 lines, 64 exported
functions), `partner-menu.ts`, `payments.ts`, `pos-delivery.ts`,
`payment-delivery.ts`, `menu-sync.ts`.

### 3.1 N+1 and batching

**No N+1 pattern found in any hot path.** The pattern in this codebase is to
fetch a set with `inArray`, then attach children from one batched query:

- `getRestaurant` (`queries.ts:477`) fetches the restaurant, then all menu items
  for it, then calls `getMenuModifierGroups` once with the full id list.
- `loadModifierScopes` (`queries.ts:2919`) issues **3 queries total regardless of
  item count** (links, groups, options), not one per item. The only in-memory
  nested scan is `groups.find(...)` per link, which is negligible at menu scale.
- `listIntegrationOrders` (`queries.ts:1722`), the payment/delivery journals, and
  the transfer listings all batch their child loads.

### 3.2 Tenant scoping in generated SQL

- `loadModifierScopes` filters by `menu_item_modifier_groups.restaurant_id` **and**
  `modifier_options.restaurant_id` in SQL.
- `getRestaurant`, `getMenuModifierGroups`, `listIntegrationOrders`,
  `getRestaurantManageById`, `updateRestaurantProfileById` and the delivery
  journals all scope by `restaurant_id` in SQL.
- **`computeBill` (`queries.ts:2799`) is the one deliberate exception.** Its menu
  items are selected by `inArray(menuItems.id, ids)` only, and the restaurant
  match is then checked in memory: `if (!m || m.restaurantId !== r.id) return
  { ok:false }` (`queries.ts:2854`). This is correct and fail-closed — a cart line
  that belongs to another tenant is rejected before pricing — but the scope is a
  JS guard rather than a SQL predicate. **Recommendation (low):** add
  `eq(menuItems.restaurantId, r.id)` to the `inArray` query so the isolation is
  visible to the planner and to a future reader, keeping the JS check as a
  backstop. Not a leak.

### 3.3 Unbounded queries

- `browseRestaurants` (`queries.ts:397`) and `featuredRestaurants`
  (`queries.ts:444`) have **no `.limit()`**. They are bounded only by the
  discoverable catalogue (`isActive AND EXISTS available dish`). At present scale
  this is fine and the comment in `browseRestaurants` explicitly notes the escape
  of `%`/`_` so a wildcard query cannot scan the whole catalogue
  (`escapeLike`). **Recommendation (low):** add a defensive cap (e.g. `LIMIT 500`)
  so a future catalogue of many thousands cannot return an unbounded page.
- `listListingSetup` (`queries.ts:2560`) is ops-only and intentionally returns
  every listing.
- `discoverableRestaurantSlugs` (`queries.ts:468`) is sitemap-driven and
  intentionally unbounded, but selects only two columns.
- All public search/feed queries are capped: `searchAll` → `.limit(5)` + `.limit(6)`
  (`queries.ts:537,576`), `listConnectionCodes`/`listConnections` default 30,
  `listOrders` capped by caller.

### 3.4 `SELECT *`

`db.select()` (full row) is used in ~62 call sites. Most immediately map through a
`to*Dto` helper, so the over-fetch is one row's worth of columns, not a
query-count problem. `listListingSetup` and `discoverableRestaurantSlugs` use
explicit column projections. No `SELECT *` crosses a network boundary as raw
unmapped JSON. Acceptable; not worth churn.

### 3.5 Minor product inconsistency (not security)

`searchAll`'s dish sub-query filters `restaurants.is_active = true`
(`queries.ts:566-572`) but does **not** use the `discoverableRestaurant`
predicate and does not require `menu_items.available = true`. A dish that is
sold out, on a listing whose only available dish is elsewhere, can therefore
appear in dish search. Low severity; the restaurant results already use the
correct predicate. Track for a product fix, not a DB-hardening change.

---

## 4. Recommendations

| ID | Finding | Severity | Action |
|---|---|---|---|
| D1 | No CHECK constraints on status enums or money non-negativity | Medium | Add `NOT VALID` CHECK constraints in a new migration (see `docs/runbooks/backups.md` §5 for the safe pattern); validate later |
| Q1 | `computeBill` scopes menu items in JS, not SQL | Low | Add `eq(menuItems.restaurantId, r.id)` to the `inArray` query; keep the JS backstop |
| Q2 | `browse`/`featured` are unbounded | Low | Add a defensive `LIMIT` |
| Q3 | `searchAll` dish query ignores `available`/discoverability | Low | Align with `discoverableRestaurant` in a product change |
| D2 | Sync-mirror tables have no `created_at` | Informational | No change; documented so it is not mistaken for an omission |

D1 and Q1 are the only items that touch the schema/query layer; both are safe and
additive. This phase does **not** apply D1 speculatively — adding domain CHECKs to
a live production database (the configured `DATABASE_URL` is the Supabase
production pooler) is a deliberate, separate change. The migration pattern and
rollout are documented in `docs/runbooks/backups.md`.

---

## 5. Method

- `src/db/schema.ts` read end to end; FK/uniqueness/index inventory cross-checked
  against the live `crave_security_test` catalogue (`pg_constraint`,
  `pg_indexes`).
- `src/db/migrations/*.sql` (15 files) reviewed for what the base-schema
  materialisation does not express.
- All six data-access modules scanned for `select`/`orderBy`/`inArray`/predicate
  shape; hot paths (`browse`, `getRestaurant`, `computeBill`,
  `loadModifierScopes`, `searchAll`, the journals) read in full.
- Bootstrap model confirmed at `tests/security/harness.ts:790-853`: base schema
  via `drizzle-kit generate`, then the real migrations, then fixtures.
