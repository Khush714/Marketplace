import { listCategories } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/marketplace/categories */
export async function GET() {
  try {
    return safeJson({ categories: await listCategories() });
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load categories", 500);
  }
}
