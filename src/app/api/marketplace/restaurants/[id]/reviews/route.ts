import { listPublicReviews } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/marketplace/restaurants/:id/reviews?limit= */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const result = await listPublicReviews(id, limit);
    if (!result) return errorJson("Restaurant not found", 404);
    return safeJson(result);
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load reviews", 500);
  }
}
