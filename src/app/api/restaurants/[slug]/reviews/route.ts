import { listPublicRestaurantReviews } from "@/db/public-reviews";
import { guardRead } from "@/lib/abuse";
import { parsePublicReviewLimit } from "@/lib/public-review-core";

export const dynamic = "force-dynamic";

/**
 * Public reviews for a listing. The slug is resolved to an active restaurant
 * before any review row is read, and the browser-supplied cursor only moves a
 * page through that one restaurant's feedback.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const throttled = guardRead(req, "publicReviews");
  if (throttled) return throttled;

  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const page = await listPublicRestaurantReviews(slug, {
    limit: parsePublicReviewLimit(url.searchParams.get("limit")),
    cursor: url.searchParams.get("cursor"),
  });
  if (!page) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}
