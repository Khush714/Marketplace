/**
 * PHASE 24/29 — deploy-time schema migrations.
 *
 * Applies every `scripts/migration_*.sql` file in filename order against the
 * connected database. The files use `IF NOT EXISTS` everywhere except the FK
 * `ADD CONSTRAINT` statements, so re-running is made idempotent here by
 * treating "already exists" errors as no-ops.
 *
 * Runs as the first half of `postbuild` (before the seed), so migrations land
 * on the production database every deployment without manual access.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

const isTlsRequired =
  process.env.NODE_ENV === "production" ||
  /(?:sslmode|ssl)(?:=|\b)/i.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  max: 6,
  connectionTimeoutMillis: 10_000,
  ...(isTlsRequired ? { ssl: { rejectUnauthorized: false } } : {}),
});

const here = dirname(fileURLToPath(import.meta.url));

// PostgreSQL error codes that mean "already exists" — safe to skip.
const ALREADY_EXISTS = new Set(["42P07", "42710", "42P04", "42711"]);

/**
 * Splits a SQL script into individual statements, honouring single/double
 * quoted strings, `--` line comments, block comments, and `$tag$ ... $tag$`
 * dollar-quoted blocks (which may contain semicolons).
 */
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  const isTagChar = (c) => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === "'") {
      i += 2;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else { i += 1; break; }
        } else i += 1;
      }
      continue;
    }

    if (c === '"') {
      i += 1;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') i += 2;
          else { i += 1; break; }
        } else i += 1;
      }
      continue;
    }

    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    if (c === "$") {
      // Match the opening dollar tag: `$` + optional tag chars + `$`.
      let tag = "";
      let j = i + 1;
      while (j < n && isTagChar(sql[j])) {
        tag += sql[j];
        j += 1;
      }
      if (sql[j] === "$") {
        const close = `$${tag}$`;
        const k = sql.indexOf(close, j + 1);
        if (k !== -1) {
          i = k + close.length;
          continue;
        }
      }
      i += 1;
      continue;
    }

    if (c === ";") {
      const stmt = sql.slice(start, i).trim();
      if (stmt) statements.push(stmt);
      start = i + 1;
      i += 1;
      continue;
    }

    i += 1;
  }

  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function main() {
  const files = readdirSync(here)
    .filter((f) => /^migration_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    console.log("[migrate] No migration files found.");
    return;
  }

  for (const file of files) {
    const sql = readFileSync(join(here, file), "utf8");
    const statements = splitStatements(sql);

    let applied = 0;
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
        applied++;
      } catch (e) {
        if (e.code && ALREADY_EXISTS.has(e.code)) {
          console.log(`[migrate] ${file}: skipped "${e.constraint ?? e.code}" (already exists)`);
          continue;
        }
        throw new Error(
          `[migrate] ${file} failed: ${e.message}\n  statement: ${stmt.slice(0, 120)}`,
        );
      }
    }
    console.log(`[migrate] ${file}: ${applied} statement(s) applied.`);
  }
}

main()
  .then(() => console.log("[migrate] Schema up to date."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() =>
    pool.end().finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200)),
  );