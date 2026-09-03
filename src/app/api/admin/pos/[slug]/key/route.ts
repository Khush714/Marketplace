import { db } from "@/db";
import { restaurants, marketplaceProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generatePosKey, rotatePosKey, getPosKeyHash } from "@/lib/pos";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/pos/:slug/key   -> hasPosKey (never returns the hash)
 * POST /api/admin/pos/:slug/key   -> rotate (returns the plaintext ONCE)
 *
 * The plaintext POS key is shown exactly once on generation; only a hash is
 * stored. Used by the restaurant's existing POS system to poll `/api/pos/*`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const [r] = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
      posKeyHash: marketplaceProfiles.posKeyHash,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  return Response.json({
    restaurant: { id: r.id, slug: r.slug, name: r.name },
    hasPosKey: r.posKeyHash.length > 0,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const [r] = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  const key = await rotatePosKey(r.id);
  return Response.json({
    restaurant: { id: r.id, slug: r.slug, name: r.name },
    posKey: key, // returned exactly once
  });
}
