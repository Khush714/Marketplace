/**
 * Minimal forward-only migration runner for src/db/migrations/*.sql.
 *
 * Why this exists
 * ---------------
 * The schema is applied by hand today (`psql "$DATABASE_URL" -f .../file.sql`),
 * which has three production failure modes:
 *
 *   1. No ledger. Nothing records what has run, so "did this migration land?" is
 *      answered by reading Postgres. On a shared staging/production pair that
 *      is how a half-applied schema happens.
 *   2. No ordering guarantee. Files are applied in whatever order a human
 *      remembers, and two of them share a date prefix (20261001_*), so lexical
 *      order is the only thing keeping a widened column ahead of the index that
 *      uses it.
 *   3. Not safe to run twice concurrently. Two deploys racing the same release
 *      both "check and apply", and Postgres applies the second one against a
 *      schema the first is midway through building.
 *
 * What it does: takes a session advisory lock so exactly one runner mutates the
 * schema at a time, records each applied file in `schema_migrations`, and skips
 * files already recorded. Each file runs inside its own transaction, so a
 * failure leaves that one migration unapplied rather than half-applied.
 *
 * Forward-only by design: there is no `down`. Every migration in this repo is
 * written to be re-runnable (CREATE TABLE IF NOT EXISTS, guarded indexes), so
 * recovery from a bad release is a new migration, not a rollback.
 *
 * Usage:
 *   node scripts/db-migrate.mjs            # apply pending migrations
 *   node scripts/db-migrate.mjs --status   # list applied/pending, apply nothing
 *   node scripts/db-migrate.mjs --dry-run  # print what would run, apply nothing
 *   node scripts/db-migrate.mjs --baseline # record all pending as applied, run no SQL
 *
 * `--baseline` is the one to use the first time this runner meets an existing
 * database: the schema was built by hand / `db:push`, so the files are already
 * reflected in Postgres and re-running them is pointless (and, for a
 * non-idempotent statement, harmful). It writes rows to `schema_migrations` and
 * executes no migration SQL, so it converts an unmanaged schema into a tracked
 * one without touching the schema.
 *
 * Requires MIGRATIONS_DATABASE_URL (falls back to DATABASE_URL): migrations are
 * DDL, so they need the owner credential — the restricted `marketplace_app`
 * role the app runs as (Phase 10, 10.1) deliberately cannot run them. Refuses
 * to run against a database whose name does not
 * look like a real one unless --allow-any-database is passed, so a stray
 * DATABASE_URL cannot wipe a dev database by accident.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/db/migrations");

// Arbitrary but fixed: every runner contends on this one lock.
const ADVISORY_LOCK_KEY = 8_675_309;

const argv = new Set(process.argv.slice(2));
const statusOnly = argv.has("--status");
const dryRun = argv.has("--dry-run");
const baseline = argv.has("--baseline");
const allowAnyDatabase = argv.has("--allow-any-database");

function fail(message) {
  console.error(`[db-migrate] ${message}`);
  process.exit(1);
}

function loadMigrations() {
  let names;
  try {
    names = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    fail(`no migrations directory at ${MIGRATIONS_DIR}`);
  }
  // Lexical order is the ordering contract: filenames are YYYYMMDD_name.sql and
  // the date prefix is what sequences dependent changes (widen a column before
  // an index references it).
  names.sort();
  return names.map((name) => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex").slice(0, 16) };
  });
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedMap(client) {
  const { rows } = await client.query("select name, checksum from schema_migrations");
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

/**
 * A changed checksum on an already-applied file means the migration was edited
 * after it ran. Re-running it is not safe (these are not idempotent by design
 * once applied), so this is reported loudly rather than silently ignored.
 */
function checksumDrift(name, recorded, current) {
  return recorded !== current
    ? `  DRIFT  ${name}: applied with checksum ${recorded}, file is now ${current}`
    : null;
}

async function main() {
  const url = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) fail("MIGRATIONS_DATABASE_URL (or DATABASE_URL) is not set");

  let dbName;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    fail(`DATABASE_URL is not a valid URL: ${url}`);
  }
  if (!dbName) fail("DATABASE_URL has no database name");
  if (!allowAnyDatabase && !/test|dev|postgres/i.test(dbName)) {
    fail(
      `refusing to migrate database "${dbName}" — its name does not look like a ` +
        `dev/test database. Pass --allow-any-database if this is intended.`,
    );
  }

  const migrations = loadMigrations();
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await ensureLedger(client);
    const applied = await appliedMap(client);

    const drift = [];
    const pending = [];
    for (const m of migrations) {
      const recorded = applied.get(m.name);
      if (recorded) {
        const d = checksumDrift(m.name, recorded, m.checksum);
        if (d) drift.push(d);
      } else {
        pending.push(m);
      }
    }

    const unknown = [...applied.keys()].filter((n) => !migrations.some((m) => m.name === n));
    if (unknown.length) {
      console.log(
        `[db-migrate] warning: ${unknown.length} recorded migration(s) have no file: ${unknown.join(", ")}`,
      );
    }
    if (drift.length) {
      console.log(`[db-migrate] ${drift.length} applied migration(s) were edited after they ran:`);
      for (const d of drift) console.log(d);
      console.log("[db-migrate] add a new migration instead of editing an applied one");
    }

    console.log(`[db-migrate] database=${dbName} applied=${applied.size} pending=${pending.length}`);

    if (statusOnly || dryRun) {
      for (const m of pending) console.log(`  PENDING  ${m.name}`);
      console.log(dryRun ? "[db-migrate] dry run: nothing applied" : "[db-migrate] status only");
      return;
    }

    if (baseline) {
      if (!pending.length) {
        console.log("[db-migrate] nothing to baseline");
        return;
      }
      // Insert-only. No migration SQL is executed and no advisory lock is
      // needed: we are not mutating the schema, only the ledger.
      for (const m of pending) {
        process.stdout.write(`  BASELINE ${m.name} ... `);
        await client.query(
          "insert into schema_migrations (name, checksum) values ($1, $2) on conflict (name) do nothing",
          [m.name, m.checksum],
        );
        console.log("recorded");
      }
      console.log(
        `[db-migrate] baselined ${pending.length} migration(s). The schema was NOT changed.`,
      );
      console.log(
        "[db-migrate] verify the schema really matches before trusting this: " +
          "compare with `npm run db:push` output on a scratch database.",
      );
      return;
    }

    if (!pending.length) {
      console.log("[db-migrate] nothing to apply");
      return;
    }

    // Serialize runners. Two deploys racing a release must not both apply.
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      // Re-read under the lock: another runner may have applied while we waited.
      const fresh = await appliedMap(client);
      for (const m of migrations) {
        if (fresh.has(m.name)) {
          console.log(`  SKIP    ${m.name} (applied by another runner)`);
          continue;
        }
        process.stdout.write(`  APPLY   ${m.name} ... `);
        try {
          await client.query("begin");
          await client.query(m.sql);
          await client.query(
            "insert into schema_migrations (name, checksum) values ($1, $2)",
            [m.name, m.checksum],
          );
          await client.query("commit");
          console.log("ok");
        } catch (e) {
          await client.query("rollback").catch(() => {});
          console.log("FAILED");
          // Stop at the first failure: later migrations may depend on this one.
          fail(`${m.name}: ${e.message}`);
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    }

    console.log("[db-migrate] done");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[db-migrate] fatal:", e);
  process.exit(1);
});