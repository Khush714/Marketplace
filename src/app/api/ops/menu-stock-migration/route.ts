import { createHash, timingSafeEqual } from "node:crypto";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAME = "20261121_menu_stock.sql";
const CHECKSUM = "e0d3c10d36ed25bf";
const ONE_TIME_TOKEN = "6e60bfeb4509cff3a344d90faebd07a6";

function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!supplied) return false;
  const a = createHash("sha256").update(ONE_TIME_TOKEN).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

function connect() {
  const url = (process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new Error("No migrations database");
  return new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
}

async function state(client: Client) {
  const [column, ledger, columns] = await Promise.all([
    client.query(
      `select data_type, is_nullable from information_schema.columns
        where table_schema='public' and table_name='menu_items' and column_name='stock_quantity'`,
    ),
    client.query(`select to_regclass('public.schema_migrations') is not null as present`),
    client.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='menu_items'
          and column_name in ('stock_quantity')`,
    ),
  ]);
  let applied: { checksum: string | null; appliedAt: string | null } | null = null;
  if (ledger.rows[0]?.present) {
    const row = await client.query(
      `select checksum, applied_at from public.schema_migrations where name = $1`,
      [NAME],
    );
    applied = row.rowCount
      ? {
          checksum: row.rows[0].checksum,
          appliedAt: row.rows[0].applied_at instanceof Date
            ? row.rows[0].applied_at.toISOString()
            : String(row.rows[0].applied_at),
        }
      : null;
  }
  return {
    column: column.rows[0] ?? null,
    columns: columns.rows.map((r: { column_name: string }) => r.column_name),
    applied,
    verified: Boolean(column.rowCount) && applied?.checksum === CHECKSUM,
  };
}

/** Read-only verification of the one-shot production menu-stock migration. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let client: Client;
  try { client = connect(); } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 503 });
  }
  try {
    await client.connect();
    return Response.json({ ok: true, migration: NAME, checksum: CHECKSUM, state: await state(client) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** One-shot operator helper for the production menu-stock migration; removed after use. */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let client: Client;
  try { client = connect(); } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 503 });
  }
  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const before = await state(client);
    if (before.applied) {
      if (before.applied.checksum !== CHECKSUM) {
        return Response.json({ ok: false, error: "Checksum drift", applied: before.applied }, { status: 409 });
      }
      return Response.json({ ok: true, status: "already-applied", state: before });
    }

    await client.query("begin");
    try {
      await client.query(`ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS stock_quantity integer`);
      await client.query(
        `INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)`,
        [NAME, CHECKSUM],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    return Response.json({ ok: true, status: "applied", state: await state(client) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
