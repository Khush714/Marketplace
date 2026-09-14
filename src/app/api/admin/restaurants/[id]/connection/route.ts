import { db } from "@/db";
import { restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/restaurants/[id]/connection — get the connection record
 * for a specific restaurant.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const restaurantId = Number(id);
  if (!Number.isFinite(restaurantId)) {
    return Response.json({ error: "Invalid restaurant id" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, restaurantId))
    .limit(1);

  if (!row) {
    return Response.json(
      { error: "No integration record found" },
      { status: 404 },
    );
  }

  return Response.json({ connection: row });
}

/**
 * PATCH /api/admin/restaurants/[id]/connection — update the connection
 * status for a restaurant. For now this is a stub that validates the
 * transition but does not perform actual POS connection.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const restaurantId = Number(id);
  if (!Number.isFinite(restaurantId)) {
    return Response.json({ error: "Invalid restaurant id" }, { status: 400 });
  }

  const body = await request.json();

  const [existing] = await db
    .select()
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, restaurantId))
    .limit(1);

  if (!existing) {
    return Response.json(
      { error: "No integration record found" },
      { status: 404 },
    );
  }

  // Only allow status transitions that are valid
  const VALID_STATUSES = ["disconnected", "connecting", "connected", "error", "disabled"];
  const newStatus = typeof body.status === "string" ? body.status : null;

  if (newStatus && !VALID_STATUSES.includes(newStatus)) {
    return Response.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  // Update the record
  const now = new Date();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (newStatus) updates.status = newStatus;
  if (typeof body.provider === "string") updates.provider = body.provider;

  // PHASE 33 — connected_at tracks the moment the integration settled into
  // `connected`. It is cleared as soon as it leaves that state.
  if (newStatus === "connected") {
    updates.connectedAt = now;
    updates.lastSuccessAt = now;
    updates.lastError = "";
  } else if (newStatus && newStatus !== "connected") {
    updates.connectedAt = null;
  }

  const [updated] = await db
    .update(restaurantIntegrations)
    .set(updates)
    .where(eq(restaurantIntegrations.restaurantId, restaurantId))
    .returning();

  return Response.json({ connection: updated });
}
