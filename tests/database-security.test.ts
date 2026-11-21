/**
 * Tests for the Phase 10 database security boundary.
 *
 * Run with: npm test
 *
 * Phase 10 has three parts, none of which can run under `node --test` against a
 * live Postgres — so what is pinned here is everything that keeps them true in
 * the repo itself:
 *
 *   - 10.1 the restricted role: `marketplace_app` exists with only the
 *     privileges the runtime needs, never touches the schema_migrations
 *     ledger, and never gets its password from the committed migration;
 *   - 10.2 the FK delete actions: orders are RESTRICT (financial records die
 *     only through the explicit erasure transaction), sessions and connections
 *     are CASCADE (no orphaned credentials/bindings), and schema.ts says the
 *     same thing the migration applies;
 *   - 10.3 the index review: the four missing indexes are declared exactly once
 *     in schema.ts and added once in the migration, while the four candidates
 *     that already had an index are NOT duplicated.
 *
 * Plus the credential split: schema tools read MIGRATIONS_DATABASE_URL, the
 * app keeps the restricted DATABASE_URL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function requireSource(path: string): string {
  assert.ok(existsSync(join(process.cwd(), path)), `missing file ${path}`);
  return readSource(path);
}

const SCHEMA = "src/db/schema.ts";
const ROLE_MIGRATION = "src/db/migrations/20261007_application_role.sql";
const FK_MIGRATION = "src/db/migrations/20261007_fk_delete_actions.sql";
const INDEX_MIGRATION = "src/db/migrations/20261007_missing_indexes.sql";

/** The schema text of one table, from its declaration to the next export. */
function tableBlock(schema: string, name: string): string {
  const start = schema.indexOf(`export const ${name} = pgTable`);
  assert.ok(start >= 0, `table ${name} not found in schema.ts`);
  const next = schema.indexOf("\nexport const ", start + 1);
  return schema.slice(start, next === -1 ? schema.length : next);
}

/* ------------------------- 10.1 restricted role ------------------------- */

test("the migration creates a least-privilege application role", () => {
  const sql = requireSource(ROLE_MIGRATION);
  assert.match(sql, /CREATE ROLE marketplace_app LOGIN/);
  for (const flag of ["NOCREATEDB", "NOCREATEROLE", "NOREPLICATION", "NOBYPASSRLS"]) {
    assert.ok(sql.includes(flag), `role must carry ${flag}`);
  }
  // The migration ledger stays the runner's: the app role cannot read or
  // rewrite which migrations have applied.
  assert.match(sql, /tablename <> 'schema_migrations'/);
  // Tables created by a future db:push are covered without a re-grant.
  assert.match(sql, /ALTER DEFAULT PRIVILEGES/);
  // Serial primary keys need sequence usage, or inserts fail.
  assert.match(sql, /GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public/);
});

test("the committed migration never contains the role's password", () => {
  const sql = requireSource(ROLE_MIGRATION);
  const createLine = sql
    .split("\n")
    .find((line) => line.includes("CREATE ROLE"));
  assert.ok(createLine, "migration must create the role");
  // The password is documented as an out-of-band ALTER ROLE in comments —
  // what must never happen is a CREATE ROLE ... PASSWORD '...' in a file
  // that is committed to git.
  assert.ok(
    !createLine.includes("PASSWORD"),
    `CREATE ROLE must not set a password in-repo: ${createLine.trim()}`,
  );
});

/* --------------------------- 10.2 FK actions ---------------------------- */

test("the FK migration applies the three reviewed delete actions", () => {
  const sql = requireSource(FK_MIGRATION);
  assert.match(
    sql,
    /ADD CONSTRAINT orders_restaurant_id_restaurants_id_fk[\s\S]*?ON DELETE RESTRICT/,
    "orders must be RESTRICT — financial records are not a cascade side effect",
  );
  assert.match(
    sql,
    /ADD CONSTRAINT integration_sessions_restaurant_id_restaurants_id_fk[\s\S]*?ON DELETE CASCADE/,
    "integration sessions must cascade — no orphaned live POS tokens",
  );
  assert.match(
    sql,
    /ADD CONSTRAINT connections_restaurant_id_restaurants_id_fk[\s\S]*?ON DELETE CASCADE/,
    "connections must cascade — no binding without its restaurant",
  );
});

test("the FK migration is idempotent against whatever the live database has", () => {
  // The base tables predate the migration ledger, so the migration discovers
  // the live constraint (by table pair, not by guessed name) before deciding
  // to skip, rename or re-add it.
  const sql = requireSource(FK_MIGRATION);
  assert.match(sql, /conrelid = 'orders'::regclass/);
  assert.match(sql, /conrelid = 'integration_sessions'::regclass/);
  assert.match(sql, /conrelid = 'connections'::regclass/);
  assert.match(sql, /confdeltype/);
  assert.ok((sql.match(/IF NOT EXISTS|confdeltype/g) ?? []).length >= 3);
});

test("schema.ts declares the same delete actions the migration applies", () => {
  const schema = requireSource(SCHEMA);

  const orders = tableBlock(schema, "orders");
  assert.match(
    orders,
    /onDelete: "restrict"/,
    "orders.restaurant_id must be RESTRICT in schema.ts too",
  );

  const sessions = tableBlock(schema, "integrationSessions");
  assert.match(sessions, /onDelete: "cascade"/);

  const connections = tableBlock(schema, "connections");
  assert.match(connections, /onDelete: "cascade"/);
  // code_id stays NO ACTION: connection codes are append-only history.
  assert.match(
    connections,
    /\.references\(\(\) => connectionCodes\.id\),/,
    "connections.code_id must NOT delete the code row it points at",
  );
});

/* --------------------------- 10.3 index review -------------------------- */

test("the four missing indexes exist once in schema.ts and once in the migration", () => {
  const schema = requireSource(SCHEMA);
  const migration = requireSource(INDEX_MIGRATION);

  const added = [
    "orders_restaurant_created_idx",
    "orders_created_at_idx",
    "connection_codes_status_idx",
    "restaurants_owner_key_hash_idx",
  ];
  for (const name of added) {
    const declared = schema.split(name).length - 1;
    assert.equal(declared, 1, `${name} must be declared exactly once in schema.ts`);
    assert.ok(
      migration.includes(`CREATE INDEX IF NOT EXISTS "${name}"`),
      `${name} must be added idempotently by the migration`,
    );
  }
});

test("already-indexed candidates are not duplicated by the migration", () => {
  const migration = requireSource(INDEX_MIGRATION);
  // The other half of the review: these four candidates already have an index
  // (column UNIQUE or an existing named index) and re-creating them would be
  // pure write cost.
  const duplicates = [
    ['ON "orders" ("code")', "orders.code is already column UNIQUE"],
    ['ON "connection_codes" ("code")', "connection_codes.code is already column UNIQUE"],
    ['ON "integration_sessions" ("token_hash")', "token_hash is already column UNIQUE"],
    [
      'ON "integration_sessions" ("restaurant_id")',
      "integration_sessions_restaurant_id_idx already exists",
    ],
  ];
  for (const [fragment, why] of duplicates) {
    assert.ok(!migration.includes(fragment), `must not duplicate an index: ${why}`);
  }
});

/* ----------------------- credential split (10.1) ------------------------ */

test("schema tools prefer the owner credential, documented for operators", () => {
  // Migration runner and drizzle push are DDL: they must reach the owner
  // credential once DATABASE_URL is switched to the restricted app role.
  assert.match(requireSource("scripts/db-migrate.mjs"), /MIGRATIONS_DATABASE_URL/);
  assert.match(requireSource("drizzle.config.ts"), /MIGRATIONS_DATABASE_URL/);
  // The operator-facing instructions live where the values are set.
  const env = requireSource(".env.example");
  assert.match(env, /MIGRATIONS_DATABASE_URL=/);
  assert.match(env, /marketplace_app/);
});
