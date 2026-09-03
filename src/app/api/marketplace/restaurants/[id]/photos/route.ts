import { getPublicPhotos } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/marketplace/restaurants/:id/photos — POS images, no second gallery DB. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const data = await getPublicPhotos(id);
    if (!data) return errorJson("Restaurant not found", 404);
    return safeJson(data);
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load photos", 500);
  }
}
