import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /health — the liveness endpoint the POS probes.
 *
 * This is deliberately at the ROOT, not under /api: the POS reads
 * MARKETPLACE_BASE_URL and calls bare `GET /health` (see
 * Restaurant AI /Backend/integrations/marketplace/client.js → getHealth).
 * The response shape mirrors that contract: `{ status: "ok", ... }` with a
 * 200 for healthy, so the POS records a heartbeat.
 *
 * It is unauthenticated on purpose — it exposes no tenant data, only whether
 * this process can reach its database. Keep it that way; anything added to
 * the body is readable by anyone.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const at = new Date().toISOString();

  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { status: "ok", service: "marketplace", database: "reachable", at },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", service: "marketplace", database: "unreachable", at },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
