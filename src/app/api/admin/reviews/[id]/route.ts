import { db } from "@/db";
import { reviews } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/reviews/:id  { moderationStatus?, response? }
 * Moderation: published | pending | hidden. Also lets the restaurant reply.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: "Invalid review id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.moderationStatus) {
    if (!["published", "pending", "hidden"].includes(body.moderationStatus)) {
      return Response.json({ error: "Invalid moderation status" }, { status: 400 });
    }
    updates.moderationStatus = body.moderationStatus;
  }
  if (typeof body.response === "string") {
    updates.response = body.response.slice(0, 1000);
    updates.respondedAt = new Date();
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .update(reviews)
    .set(updates)
    .where(eq(reviews.id, reviewId))
    .returning();
  if (!row) return Response.json({ error: "Review not found" }, { status: 404 });
  return Response.json({ review: row });
}
