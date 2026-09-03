import { getPublicMenu } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/marketplace/restaurants/:id/menu */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const menu = await getPublicMenu(id);
    if (!menu) return errorJson("Restaurant not found", 404);
    return safeJson(menu);
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load menu", 500);
  }
}
