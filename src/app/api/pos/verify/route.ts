import { db } from "@/db";
import { marketplaceProfiles, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { restaurantForPosKey } from "@/lib/pos";

export const dynamic = "force-dynamic";

/** GET /api/pos/verify?key=<posKey> — POS connects and learns its identity. */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const restaurantId = await restaurantForPosKey(key);
  if (!restaurantId) {
    return Response.json({ error: "Invalid POS key" }, { status: 401 });
  }

  const [row] = await db
    .select({ name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  return Response.json({
    ok: true,
    restaurant: row,
  });
}
