import { createHash, timingSafeEqual } from "node:crypto";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAME = "20261119_order_feedback.sql";
const CHECKSUM = "1e6e155fe36a6133";
const ONE_TIME_TOKEN = "93ddb40757d44bbd8430508141ffcca7";

function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!supplied) return false;
  const a = createHash("sha256").update(ONE_TIME_TOKEN).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

/** One-shot operator helper for verifying the production review migration; removed after use. */
export async function GET(req: Request) {
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
    const ledger = await client.query(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`,
    );
    let migration: { present: boolean; checksum: string | null; appliedAt: string | null } = {
      present: false,
      checksum: null,
      appliedAt: null,
    };
    if (ledger.rows[0]?.present) {
      const row = await client.query(
        `SELECT checksum, applied_at FROM public.schema_migrations WHERE name = $1`,
        [NAME],
      );
      migration = row.rowCount
        ? {
            present: true,
            checksum: row.rows[0].checksum,
            appliedAt: row.rows[0].applied_at instanceof Date
              ? row.rows[0].applied_at.toISOString()
              : String(row.rows[0].applied_at),
          }
        : { present: true, checksum: null, appliedAt: null };
    }

    const [columns, constraint, index] = await Promise.all([
      client.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'orders'
            AND column_name IN ('rating','review','feedback_at','merchant_response','merchant_responded_at')
          ORDER BY column_name`,
      ),
      client.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conname = 'orders_rating_range_check' AND conrelid = 'public.orders'::regclass`,
      ),
      client.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'orders'
            AND indexname = 'orders_restaurant_feedback_idx'`,
      ),
    ]);

    const required = ["rating", "review", "feedback_at", "merchant_response", "merchant_responded_at"];
    const found = columns.rows.map((row: { column_name: string }) => row.column_name);
    const missing = required.filter((name) => !found.includes(name));
    const checksumMatches = migration.checksum === CHECKSUM;
    const verified = missing.length === 0 && !!constraint.rowCount && !!index.rowCount && checksumMatches;

    return Response.json(
      {
        ok: true,
        verified,
        migration: { name: NAME, checksumMatches, ...migration },
        schema: {
          missing,
          columns: columns.rows,
          ratingConstraint: constraint.rows[0] ?? null,
          feedbackIndex: index.rows[0] ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
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
