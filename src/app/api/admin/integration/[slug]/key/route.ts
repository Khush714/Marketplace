import { db } from "@/db";
import { restaurants, restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { rotateApiKey, hasApiKey, revokeApiKey } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/integration/:slug/key  → hasApiKey (never returns hash)
 * POST /api/admin/integration/:slug/key  → rotate (returns plaintext ONCE)
 *
 * PHASE 12 — the API key the marketplace presents when calling RestaurantAI.
 * The raw key is shown exactly once (on rotation); only a SHA-256 hash is
 * stored. The key never leaves the server — no client-side code receives it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [r] = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
    })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  const [integration] = await db
    .select({ apiKeyPrefix: restaurantIntegrations.apiKeyPrefix })
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, r.id))
    .limit(1);

  return Response.json({
    restaurant: { id: r.id, slug: r.slug, name: r.name },
    hasApiKey: integration ? integration.apiKeyPrefix.length > 0 : false,
    apiKeyPrefix: integration?.apiKeyPrefix ?? null,
  });
}

/**
 * POST /api/admin/integration/:slug/key → rotate API key.
 * Returns the plaintext ONCE; it is never stored.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const revoke = body.action === "revoke";

  const [r] = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
    })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  if (revoke) {
    await revokeApiKey(r.id);
    return Response.json({
      restaurant: { id: r.id, slug: r.slug, name: r.name },
      revoked: true,
    });
  }

  const key = await rotateApiKey(r.id);
  return Response.json({
    restaurant: { id: r.id, slug: r.slug, name: r.name },
    apiKey: key, // shown exactly once — never stored or logged
  });
}
