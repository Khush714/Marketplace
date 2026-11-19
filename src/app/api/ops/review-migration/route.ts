import { createHash, timingSafeEqual } from "node:crypto";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAME = "20261119_order_feedback.sql";
const CHECKSUM = "1e6e155fe36a6133";
const ONE_TIME_TOKEN = "rvw-mig-9d41c7a6b83e4f20";

function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = createHash("sha256").update(ONE_TIME_TOKEN).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

/** One-shot operator helper for the production review migration; removed after use. */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = (process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) return Response.json({ ok: false, error: "No migrations database" }, { status: 503 });

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const ledger = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [NAME]);
    if (ledger.rowCount) {
      if (ledger.rows[0].checksum !== CHECKSUM) {
        return Response.json({ ok: false, error: "Checksum drift" }, { status: 409 });
      }
      return Response.json({ ok: true, status: "already-applied", checksum: CHECKSUM });
    }

    await client.query(`
      ALTER TABLE public.orders
        ADD COLUMN IF NOT EXISTS rating integer,
        ADD COLUMN IF NOT EXISTS review text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
        ADD COLUMN IF NOT EXISTS merchant_response text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS merchant_responded_at timestamptz
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'orders_rating_range_check' AND conrelid = 'public.orders'::regclass
        ) THEN
          ALTER TABLE public.orders
            ADD CONSTRAINT orders_rating_range_check
            CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));
        END IF;
      END $$
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS orders_restaurant_feedback_idx
        ON public.orders USING btree (restaurant_id, feedback_at)
    `);
    await client.query(
      "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
      [NAME, CHECKSUM],
    );

    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders'
          AND column_name IN ('rating','review','feedback_at','merchant_response','merchant_responded_at')`,
    );
    return Response.json(
      { ok: true, status: "applied", checksum: CHECKSUM, columns: columns.rows.map((r) => r.column_name) },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
