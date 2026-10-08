import { NextRequest } from "next/server";
import { searchAll } from "@/db/queries";
import { localityByKey } from "@/lib/domain";
import { clampSearchQuery } from "@/lib/abuse-core";
import { guardRead } from "@/lib/abuse";

export const revalidate = 60;

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" };

/**
 * Public search over restaurants and dishes.
 *
 * Every request runs an ILIKE scan, so this is the cheapest endpoint to send and
 * the most expensive per hit — the shape a scraper wants. Budgeted per client,
 * and the term is clamped in the handler because it becomes a SQL LIKE pattern
 * downstream (see `clampSearchQuery` and `searchAll`'s `escapeLike`). The
 * response is CDN-cacheable for 60 seconds so a repeated-URL flood is absorbed
 * by the edge cache instead of the ILIKE scan.
 */
export async function GET(req: NextRequest) {
  const throttled = guardRead(req, "search");
  if (throttled) return throttled;

  const q = clampSearchQuery(req.nextUrl.searchParams.get("q"));
  const locality = localityByKey(req.nextUrl.searchParams.get("loc")).name;
  if (q.length < 2) return Response.json({ results: [] }, { headers: CACHE_HEADERS });
  return Response.json({ results: await searchAll(q, locality) }, { headers: CACHE_HEADERS });
}