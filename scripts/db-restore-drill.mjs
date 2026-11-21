/**
 * Backup / restore drill (Phase 2, task 2.4).
 *
 *   backup source DB -> restore into a throwaway DB -> verify integrity -> destroy
 *
 * This is the executable half of `docs/runbooks/backups.md`: it proves the
 * documented `pg_dump`/`pg_restore` procedure actually round-trips the real
 * schema on a real PostgreSQL, without ever touching a database it did not
 * create. Everything happens in scratch databases whose names end in `_test`
 * (so the migration runner's safety check accepts them) and both are dropped on
 * exit unless DRILL_KEEP=1.
 *
 * Usage:
 *   node scripts/db-restore-drill.mjs
 *
 * Environment (all optional):
 *   DRILL_ADMIN_URL   maintenance connection, default postgres/postgres@127.0.0.1:5432/postgres
 *   DRILL_SOURCE_DB   scratch DB to back up,   default marketplace_backup_test
 *   DRILL_RESTORE_DB  scratch DB to restore to, default marketplace_restore_test
 *   PG_BIN            dir holding pg_dump/pg_restore/pg_amcheck; auto-detected
 *   DRILL_KEEP=1      keep both databases + the dump file for inspection
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_URL = process.env.DRILL_ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const SOURCE_DB = process.env.DRILL_SOURCE_DB ?? "marketplace_backup_test";
const RESTORE_DB = process.env.DRILL_RESTORE_DB ?? "marketplace_restore_test";
const KEEP = process.env.DRILL_KEEP === "1";

if (!/test/i.test(SOURCE_DB) || !/test/i.test(RESTORE_DB)) {
  console.error("Refusing to run: source and restore database names must contain 'test'.");
  process.exit(1);
}

function withDb(url, dbName) {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const SOURCE_URL = withDb(ADMIN_URL, SOURCE_DB);
const RESTORE_URL = withDb(ADMIN_URL, RESTORE_DB);

/* --------------------------------------------------------------- tooling */

function findPgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const candidates = [
    "C:\\Program Files\\PostgreSQL\\17\\bin",
    "C:\\Program Files\\PostgreSQL\\16\\bin",
    "C:\\Program Files\\PostgreSQL\\15\\bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/bin",
    "/usr/local/bin",
  ];
  for (const dir of candidates) {
    const exe = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
    if (existsSync(join(dir, exe))) return dir;
  }
  return null;
}

const PG_BIN = findPgBin();
const exe = (name) => (PG_BIN ? join(PG_BIN, process.platform === "win32" ? `${name}.exe` : name) : name);

function run(command, args, extraEnv = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("error", (e) => resolvePromise({ code: -1, out: out + String(e) }));
    child.on("exit", (code) => resolvePromise({ code: code ?? -1, out }));
  });
}

/* ------------------------------------------------------------------ sql */

async function admin() {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  return c;
}

async function recreate(c, dbName) {
  await c.query(`drop database if exists ${dbName} with (force)`);
  await c.query(`create database ${dbName}`);
}

async function withClient(url, fn) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

/* -------------------------------------------------------------- bootstrap */

/** Materialise the base schema the same way tests/security/harness.ts does:
 *  drizzle-kit diffs schema.ts from nothing, then the real migrations run on
 *  top. There is no base migration file, so this is the only faithful build. */
async function bootstrapSchema(url) {
  const genDir = mkdtempSync(join(tmpdir(), "mp-drill-drizzle-"));
  const gen = await run(process.execPath, [
    join(ROOT, "node_modules", "drizzle-kit", "bin.cjs"),
    "generate",
    "--dialect",
    "postgresql",
    "--schema",
    "src/db/schema.ts",
    "--out",
    genDir,
    "--name",
    "initial",
  ]);
  if (gen.code !== 0) throw new Error(`drizzle-kit generate failed:\n${gen.out}`);
  const schemaSql = readFileSync(join(genDir, "0000_initial.sql"), "utf8");
  rmSync(genDir, { recursive: true, force: true });

  await withClient(url, async (c) => {
    await c.query(schemaSql);
  });

  const migrated = await run(process.execPath, ["scripts/db-migrate.mjs"], {
    MIGRATIONS_DATABASE_URL: url,
    DATABASE_URL: url,
  });
  if (migrated.code !== 0) throw new Error(`db-migrate failed:\n${migrated.out}`);
}

async function seedSource(url) {
  const seed = await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/seed.ts", "--confirm"], {
    DATABASE_URL: url,
  });
  if (seed.code !== 0) throw new Error(`seed failed:\n${seed.out}`);
}

/**
 * Fill at least one row into every table the seed leaves empty, so the
 * checksum comparison exercises all 22 tables and not just the five the seed
 * touches. Idempotent; safe to re-run.
 */
const COVERAGE_SQL = `
insert into menu_categories (restaurant_id, pos_category_id, name)
  select id, 100001, 'Drill Category' from restaurants order by id limit 1
  on conflict do nothing;

insert into orders (code, restaurant_id, restaurant_name, restaurant_slug, items,
                    address_text, customer_name, phone, subtotal_cents, delivery_fee_cents,
                    platform_fee_cents, discount_cents, total_cents, external_order_id,
                    tracking_token_hash, pos_delivery_status, integration_status)
  select 'DRILL-ORDER-1', id, name, slug, '[]'::jsonb, '221B Baker Street', 'Drill User',
         '9000000000', 10000, 3900, 600, 0, 14500, 'mkt_ord_drill_1', 'drilltrack1', 'PENDING', 'PLACED'
  from restaurants order by id limit 1
  on conflict do nothing;

insert into connection_codes (code, status) values ('DRILL-CODE-1', 'unused')
  on conflict do nothing;

insert into connections (code_id, restaurant_id)
  select cc.id, r.id from connection_codes cc, (select id from restaurants order by id limit 1) r
  where cc.code = 'DRILL-CODE-1'
  on conflict do nothing;

insert into integration_sessions (token_hash, restaurant_id, code_id, expires_at, idle_expires_at)
  select 'drill-int-hash', conn.restaurant_id, conn.code_id, now() + interval '1 day', now() + interval '1 hour'
  from connections conn
  where conn.code_id = (select id from connection_codes where code = 'DRILL-CODE-1')
  on conflict do nothing;

insert into integration_records (restaurant_id, status)
  select id, 'pending' from restaurants order by id limit 1
  on conflict do nothing;

insert into integration_audit (restaurant_id, actor, event)
  select id, 'drill', 'drill.event' from restaurants order by id limit 1;

insert into integration_transfer_requests (requested_by_restaurant_id, previous_restaurant_id, marketplace_id)
  select a.id, b.id, 'rst_drill' from
    (select id from restaurants order by id offset 0 limit 1) a,
    (select id from restaurants order by id offset 1 limit 1) b
  on conflict do nothing;

insert into marketplace_pos_order_deliveries (marketplace_order_id, external_order_id, restaurant_id)
  select o.id, o.external_order_id, o.restaurant_id from orders o where o.code = 'DRILL-ORDER-1'
  on conflict do nothing;

insert into marketplace_payments (payment_reference, marketplace_order_id, external_order_id, restaurant_id,
                                  provider, provider_payment_id, provider_order_id, amount_cents, amount,
                                  status, signature_verified)
  select 'PAY-DRILL-1', o.id, o.external_order_id, o.restaurant_id, 'razorpay', 'pay_drill_1', 'order_drill_1',
         o.total_cents, o.total_cents / 100.0, 'PAID', true
  from orders o where o.code = 'DRILL-ORDER-1'
  on conflict do nothing;

insert into marketplace_payment_events (event_id, provider, event_type, payment_reference, payload_hash, status)
  values ('evt_drill_1', 'razorpay', 'payment.captured', 'PAY-DRILL-1', 'deadbeef', 'PROCESSED')
  on conflict do nothing;

insert into marketplace_pos_payment_deliveries (marketplace_payment_id, external_order_id, restaurant_id, event_type, event_id, payload)
  select mp.id, mp.external_order_id, mp.restaurant_id, 'payment.captured', 'PAY-DRILL-1:payment.captured', '{}'::jsonb
  from marketplace_payments mp where mp.payment_reference = 'PAY-DRILL-1'
  on conflict do nothing;

insert into marketplace_order_events (restaurant_id, event_id, external_order_id, status)
  select o.restaurant_id, 'ord_evt_drill_1', o.external_order_id, 'PREPARING'
  from orders o where o.code = 'DRILL-ORDER-1'
  on conflict do nothing;

insert into menu_webhook_events (restaurant_id, event_id, event_type, entity_type)
  select id, 'menu_evt_drill_1', 'item.created', 'item' from restaurants order by id limit 1
  on conflict do nothing;

insert into customer_sessions (token_hash, expires_at)
  values ('drill-cust-hash', now() + interval '1 day')
  on conflict do nothing;

insert into admin_sessions (token_hash, expires_at)
  values ('drill-admin-hash', now() + interval '1 day')
  on conflict do nothing;
`;

async function coverage(url) {
  await withClient(url, (c) => c.query(COVERAGE_SQL));
}

/* ------------------------------------------------------------- inspection */

async function listTables(c) {
  const { rows } = await c.query(
    `select c.relname as name from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  return rows.map((r) => r.name);
}

/** Deterministic row checksum that does not depend on physical order: hash each
 *  row, then hash the sorted concatenation of the hashes. */
async function tableDigest(c, table) {
  const { rows } = await c.query(
    `select count(*)::bigint as n,
            coalesce(md5(string_agg(row_hash, '' order by row_hash)), md5('')) as checksum
       from (select md5(t::text) as row_hash from public."${table}" t) s`,
  );
  return { rows: Number(rows[0].n), checksum: rows[0].checksum };
}

async function schemaCounts(c) {
  const q = async (sql, params = []) => Number((await c.query(sql, params)).rows[0].n);
  const scope = `join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'`;
  return {
    tables: await q(
      `select count(*)::bigint as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r'`,
    ),
    indexes: await q(`select count(*)::bigint as n from pg_indexes where schemaname='public'`),
    constraints: await q(`select count(*)::bigint as n from pg_constraint c ${scope}`),
    foreignKeys: await q(`select count(*)::bigint as n from pg_constraint c ${scope} and c.contype='f'`),
    sequences: await q(`select count(*)::bigint as n from information_schema.sequences where sequence_schema='public'`),
  };
}

async function snapshot(c) {
  const tables = await listTables(c);
  const perTable = {};
  for (const t of tables) perTable[t] = await tableDigest(c, t);
  return { tables, perTable, schema: await schemaCounts(c) };
}

function compareSnapshots(a, b) {
  const problems = [];
  if (a.tables.length !== b.tables.length) {
    problems.push(`table count ${a.tables.length} != ${b.tables.length}`);
  }
  for (const t of a.tables) {
    if (!b.perTable[t]) {
      problems.push(`table ${t} missing after restore`);
      continue;
    }
    if (a.perTable[t].rows !== b.perTable[t].rows) {
      problems.push(`${t}: rows ${a.perTable[t].rows} != ${b.perTable[t].rows}`);
    }
    if (a.perTable[t].checksum !== b.perTable[t].checksum) {
      problems.push(`${t}: content checksum differs`);
    }
  }
  for (const k of Object.keys(a.schema)) {
    if (a.schema[k] !== b.schema[k]) problems.push(`schema.${k} ${a.schema[k]} != ${b.schema[k]}`);
  }
  return problems;
}

/* ------------------------------------------------------------- sequence */

/** Prove PK sequences survived the restore: insert a new restaurant and a
 *  dependent session, then roll back (the sequence bump is harmless on scratch). */
async function sequenceProbe(url) {
  return withClient(url, async (c) => {
    await c.query("begin");
    try {
      const r = await c.query(
        `insert into restaurants (slug, name, tagline, cuisines, image_url, hero_url)
         values ('drill-seq-probe', 'Drill Seq Probe', '', array['Test'], 'x', 'y') returning id`,
      );
      const id = r.rows[0].id;
      await c.query(
        `insert into restaurant_sessions (token_hash, restaurant_id, csrf_hash, expires_at)
         values ('drill-seq-hash', $1, 'drill-seq-csrf', now() + interval '1 day')`,
        [id],
      );
      return { ok: true, id };
    } finally {
      await c.query("rollback");
    }
  });
}

/* ------------------------------------------------------------------ main */

const log = (msg) => console.log(msg);

async function main() {
  if (!PG_BIN) {
    throw new Error("could not find pg_dump/pg_restore; set PG_BIN to the PostgreSQL bin directory");
  }
  const adminClient = await admin();
  let dumpFile = null;

  try {
    log(`[1/8] recreate scratch DBs on ${new URL(ADMIN_URL).host}`);
    await recreate(adminClient, SOURCE_DB);
    await recreate(adminClient, RESTORE_DB);

    log(`[2/8] bootstrap schema into ${SOURCE_DB}`);
    await bootstrapSchema(SOURCE_URL);

    log(`[3/8] seed fixture data`);
    await seedSource(SOURCE_URL);
    await coverage(SOURCE_URL);

    log(`[4/8] snapshot ${SOURCE_DB}`);
    const before = await withClient(SOURCE_URL, snapshot);
    const rowsBefore = Object.values(before.perTable).reduce((s, t) => s + t.rows, 0);
    log(`      ${before.tables.length} tables, ${rowsBefore} rows, ${before.schema.indexes} indexes, ${before.schema.foreignKeys} FKs`);

    log(`[5/8] pg_dump -Fc ${SOURCE_DB}`);
    const dir = mkdtempSync(join(tmpdir(), "mp-drill-dump-"));
    dumpFile = join(dir, `${SOURCE_DB}.dump`);
    const dumped = await run(exe("pg_dump"), ["-Fc", "-f", dumpFile, SOURCE_URL]);
    if (dumped.code !== 0) throw new Error(`pg_dump failed:\n${dumped.out}`);
    const dumpBytes = statSync(dumpFile).size;
    const dumpSha = createHash("sha256").update(readFileSync(dumpFile)).digest("hex");
    log(`      ${dumpBytes} bytes, sha256 ${dumpSha.slice(0, 16)}…`);

    log(`[6/8] pg_restore -> ${RESTORE_DB}`);
    const restored = await run(exe("pg_restore"), [
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "-d",
      RESTORE_URL,
      dumpFile,
    ]);
    if (restored.code !== 0) throw new Error(`pg_restore failed:\n${restored.out}`);

    log(`[7/8] verify restored content`);
    const after = await withClient(RESTORE_URL, snapshot);
    const problems = compareSnapshots(before, after);
    if (problems.length) throw new Error(`integrity mismatch:\n  - ${problems.join("\n  - ")}`);
    log("      row counts, per-table checksums and schema object counts all match");

    const probe = await sequenceProbe(RESTORE_URL);
    if (!probe.ok) throw new Error("post-restore sequence probe failed");
    log(`      sequence probe OK (allocated restaurant id ${probe.id}, rolled back)`);

    log(`[8/8] pg_amcheck ${RESTORE_DB}`);
    const amcheckReady = await withClient(RESTORE_URL, async (c) => {
      try {
        await c.query("create extension if not exists amcheck");
        return true;
      } catch {
        return false;
      }
    });
    if (!amcheckReady) {
      log("      amcheck extension unavailable on this server; skipped (checksums already verified)");
    } else {
      const amcheck = await run(exe("pg_amcheck"), ["--heapallindexed", "--parent-check", RESTORE_URL]);
      if (amcheck.code !== 0) throw new Error(`pg_amcheck reported problems:\n${amcheck.out}`);
      log("      btree indexes + heap structurally sound");
    }

    log(`\nPASS — backup/restore round-trip verified for ${SOURCE_DB} -> ${RESTORE_DB}.`);
    return 0;
  } finally {
    if (!KEEP) {
      await adminClient.query(`drop database if exists ${SOURCE_DB} with (force)`).catch(() => {});
      await adminClient.query(`drop database if exists ${RESTORE_DB} with (force)`).catch(() => {});
      if (dumpFile) rmSync(dirname(dumpFile), { recursive: true, force: true });
    } else {
      log(`\nDRILL_KEEP=1: left ${SOURCE_DB}, ${RESTORE_DB} and ${dumpFile} in place.`);
    }
    await adminClient.end().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nFAIL — ${err.message}`);
    process.exit(1);
  });
