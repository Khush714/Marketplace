import { getRestaurant } from "@/db/queries";
import { guardRead } from "@/lib/abuse";

export const revalidate = 60;

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" };

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const throttled = guardRead(req, "restaurants");
  if (throttled) return throttled;

  const { slug } = await ctx.params;
  const data = await getRestaurant(slug);
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(data, { headers: CACHE_HEADERS });
}