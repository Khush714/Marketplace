import { searchMarketplace } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/marketplace/search?q= */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return safeJson(await searchMarketplace(q));
  } catch (e) {
    console.error(e);
    return errorJson("Search failed", 500);
  }
}
