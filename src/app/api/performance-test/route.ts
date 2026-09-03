import { listPublicRestaurants, getPublicMenu, searchMarketplace } from "@/lib/marketplace";
import { errorJson } from "@/lib/api";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/performance-test — Phase 23 latency gates.
 * Measures server-side cost of the hot paths and flags slow queries.
 */
export async function GET() {
  const ms = (t0: number) => Math.round((performance.now() - t0) * 100) / 100;

  const runs: { op: string; ms: number; rows: number; ok: boolean }[] = [];
  const timed = async (op: string, fn: () => Promise<{ rows: number }>) => {
    const t0 = performance.now();
    try {
      const { rows } = await fn();
      runs.push({ op, ms: ms(t0), rows, ok: true });
    } catch (e) {
      runs.push({
        op,
        ms: ms(t0),
        rows: 0,
        ok: false,
      });
    }
  };

  await timed("listing", async () => {
    const r = await listPublicRestaurants({ limit: 60 });
    return { rows: r.items.length };
  });
  await timed("menu", async () => {
    const menu = await getPublicMenu("bella-napoli");
    return { rows: menu?.categories.length ?? 0 };
  });
  await timed("search", async () => {
    const r = await searchMarketplace("pizza");
    return { rows: r.dishes.length + r.restaurants.length };
  });
  await timed("raw ping", async () => {
    const r = await db.execute(sql`select 1 as x`);
    return { rows: r.rows.length };
  });

  const LIMITS: Record<string, number> = {
    listing: 300,
    menu: 350,
    search: 350,
    "raw ping": 50,
  };

  const failures = runs.filter((r) => r.ms > (LIMITS[r.op] ?? 300) || !r.ok);
  return Response.json({
    ok: failures.length === 0,
    summary: failures.length
      ? `${failures.length} hot path(s) over budget`
      : "all hot paths within latency budget",
    runs,
    budgets: LIMITS,
  }, { status: failures.length ? 500 : 200 });
}
