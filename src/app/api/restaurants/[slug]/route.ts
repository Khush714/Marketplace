import { getRestaurant } from "@/db/queries";
import { guardRead } from "@/lib/abuse";
import { notFound } from "@/lib/security/errors";

export const revalidate = 60;

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" };

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const throttled = guardRead(req, "restaurants");
  if (throttled) return throttled;

  const { slug } = await ctx.params;
  const data = await getRestaurant(slug);
  if (!data) return notFound("Not found");
  return Response.json(data, { headers: CACHE_HEADERS });
}