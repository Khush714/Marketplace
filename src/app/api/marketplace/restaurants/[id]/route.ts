import { getPublicRestaurant } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/marketplace/restaurants/:id — accepts numeric id or slug. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const restaurant = await getPublicRestaurant(id);
    if (!restaurant) return errorJson("Restaurant not found", 404);
    return safeJson({ restaurant });
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load restaurant", 500);
  }
}
