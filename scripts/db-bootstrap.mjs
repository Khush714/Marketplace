#!/usr/bin/env node
/**
 * Build a scratch database from scratch: full base schema + the real migrations.
 *
 * The migrations under src/db/migrations are idempotent *patches* layered on the
 * base schema that `drizzle-kit push` materialises from src/db/schema.ts — there
 * is no "base" migration file. `push` refuses to run without a TTY, so this
 * script asks `drizzle-kit generate` to diff-from-nothing into a temp folder and
 * applies that full CREATE DDL, then runs the real migration files on top. That
 * is exactly how the security harness builds its scratch database and how a
 * deployed database is stood up.
 *
 * Used by .github/workflows/e2e.yml to give `next start` a real database. It is
 * DESTRUCTIVE: it drops and recreates the `public` schema of the target. It
 * requires an explicit BOOTSTRAP_DATABASE_URL and never falls back to
 * DATABASE_URL, so it can never wipe a database the caller did not name.
 *
 * Env:
 *   BOOTSTRAP_DATABASE_URL  (required) the database to build; schema is reset.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function die(message) {
  console.error(`db-bootstrap: ${message}`);
  process.exit(1);
}

const url = process.env.BOOTSTRAP_DATABASE_URL;
if (!url) {
  die(
    "BOOTSTRAP_DATABASE_URL is required (this script drops and rebuilds a database and will not fall back to DATABASE_URL).",
  );
}

function runNode(args, extraEnv = {}) {
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (res.error) die(`spawn failed: ${String(res.error)}`);
  if (res.status !== 0) die(`command failed (${args.join(" ")}): exit ${res.status}`);
}

/* 1. Reset the target so the run is idempotent. */
{
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    die(`could not connect to BOOTSTRAP_DATABASE_URL: ${String(e)}`);
  }
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    console.log("db-bootstrap: reset public schema");
  } catch (e) {
    die(`could not reset schema: ${String(e)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

/* 2. Generate the full base schema DDL from src/db/schema.ts. */
const genDir = mkdtempSync(path.join(tmpdir(), "mp-drizzle-"));
const drizzleBin = path.join(ROOT, "node_modules", "drizzle-kit", "bin.cjs");
runNode([
  drizzleBin,
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

let schemaSql;
try {
  schemaSql = readFileSync(path.join(genDir, "0000_initial.sql"), "utf8");
} catch (e) {
  rmSync(genDir, { recursive: true, force: true });
  die(`drizzle-kit generate produced no 0000_initial.sql: ${String(e)}`);
}
rmSync(genDir, { recursive: true, force: true });
if (!schemaSql.trim()) die("drizzle-kit generate produced empty schema SQL");

/* 3. Apply the base schema. */
{
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(schemaSql);
    console.log("db-bootstrap: applied base schema");
  } catch (e) {
    die(`schema apply failed: ${String(e)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

/* 4. Apply the real migrations on top. */
runNode(["scripts/db-migrate.mjs"], { MIGRATIONS_DATABASE_URL: url, DATABASE_URL: url });

console.log("db-bootstrap: done");
