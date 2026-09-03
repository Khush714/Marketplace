import { submitReview } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";
import { getCurrentCustomer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/marketplace/reviews
 * { restaurant, author, rating, comment, orderReference }
 * PHASE 14 — only eligible (completed, own, unreviewed) orders can be reviewed.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const me = await getCurrentCustomer();
    const result = await submitReview({
      restaurant: String(body.restaurant ?? body.restaurantSlug ?? ""),
      author: String(body.author ?? body.customerName ?? me?.name ?? ""),
      rating: Number(body.rating),
      comment: typeof body.comment === "string" ? body.comment : "",
      orderReference: body.orderReference,
      customerId: me?.id ?? null,
    });

    if (!result.ok) return errorJson(result.error, result.status);
    return safeJson(result, 201);
  } catch (e) {
    console.error(e);
    return errorJson("Failed to submit review", 500);
  }
}
