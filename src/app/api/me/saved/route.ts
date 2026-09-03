import { db } from "@/db";
import { savedRestaurants, restaurants } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";
import { listSavedRestaurantsForCustomer } from "@/lib/marketplace";
import { safeJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  return safeJson({ saved: await listSavedRestaurantsForCustomer(me.id) });
}

export async function POST(request: Request) {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const slug = String(body.slug ?? "").trim();
  if (!slug) return Response.json({ error: "slug required" }, { status: 400 });

  const [r] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  await db
    .insert(savedRestaurants)
    .values({ customerId: me.id, restaurantId: r.id })
    .onConflictDoNothing();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const slug = String(new URL(request.url).searchParams.get("slug") ?? "").trim();
  if (!slug) return Response.json({ error: "slug required" }, { status: 400 });

  const [r] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ ok: true });

  await db
    .delete(savedRestaurants)
    .where(
      and(
        eq(savedRestaurants.customerId, me.id),
        eq(savedRestaurants.restaurantId, r.id),
      ),
    );
  return Response.json({ ok: true });
}
