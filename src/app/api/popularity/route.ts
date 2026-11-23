import { NextRequest } from "next/server";
import { getPublicPopularity } from "@/db/public-popularity";
import { localityByKey } from "@/lib/domain";
import { guardRead } from "@/lib/abuse";

export const revalidate = 60;

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" };

/**
 * Public, locality-scoped popularity for search chips.
 *
 * Read-only and unauthenticated like browse/search, guarded by the same
 * per-client budget and cached at the edge for 60 seconds. The payload is the
 * already-selected result: an empty `dishes` list means the first-party order
 * sample was too thin, so callers must not substitute invented trends.
 */
export async function GET(req: NextRequest) {
  const throttled = guardRead(req, "popularity");
  if (throttled) return throttled;

  const locality = localityByKey(req.nextUrl.searchParams.get("loc"));
  return Response.json(
    { popularity: await getPublicPopularity(locality) },
    { headers: CACHE_HEADERS },
  );
}
