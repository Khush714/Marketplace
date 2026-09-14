import { db } from "@/db";
import { deliveryPartners, deliveryAssignments } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { num } from "@/lib/format";
import { DELIVERY_MAINLINE } from "@/lib/delivery-status";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/delivery/partners/:id — edit a rider (name / phone /
 * vehicleType / status / active). A partner re-activated as available is
 * back in the pool; archiving is a soft DELETE below.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const partnerId = Number((await params).id);
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    return Response.json({ error: "Bad partner id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    phone?: unknown;
    vehicleType?: unknown;
    status?: unknown;
    active?: unknown;
    notes?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (typeof body.phone === "string" && body.phone.trim()) {
    patch.phone = body.phone.trim();
  }
  if (typeof body.vehicleType === "string") {
    const v = body.vehicleType.trim();
    if (v && !["bike", "scooter", "car", "walking"].includes(v)) {
      return Response.json(
        { error: "vehicleType must be bike, scooter, car or walking" },
        { status: 400 },
      );
    }
    if (v) patch.vehicleType = v;
  }
  if (typeof body.status === "string") {
    const s = body.status.trim();
    if (!["available", "busy", "offline"].includes(s)) {
      return Response.json(
        { error: "status must be available, busy or offline" },
        { status: 400 },
      );
    }
    patch.status = s;
  }
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.notes === "string") patch.notes = body.notes;
  patch.updatedAt = new Date();

  if (Object.keys(patch).length === 1) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(deliveryPartners)
    .set(patch)
    .where(eq(deliveryPartners.id, partnerId))
    .returning();
  if (!updated) {
    return Response.json({ error: "Partner not found" }, { status: 404 });
  }

  return Response.json({
    partner: {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      vehicleType: updated.vehicleType,
      status: updated.status,
      active: updated.active,
      totalDeliveries: updated.totalDeliveries,
      rating: num(updated.rating),
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

/** DELETE /api/admin/delivery/partners/:id — archive (soft delete). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const partnerId = Number((await params).id);
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    return Response.json({ error: "Bad partner id" }, { status: 400 });
  }

  const [open] = await db
    .select({ id: deliveryAssignments.id })
    .from(deliveryAssignments)
    .where(
      and(
        eq(deliveryAssignments.partnerId, partnerId),
        inArray(deliveryAssignments.status, DELIVERY_MAINLINE),
      ),
    )
    .limit(1);
  if (open) {
    return Response.json(
      { error: "This rider has an active delivery — finish it before archiving" },
      { status: 409 },
    );
  }

  await db
    .update(deliveryPartners)
    .set({ active: false, status: "offline", updatedAt: new Date() })
    .where(eq(deliveryPartners.id, partnerId));

  return Response.json({ ok: true });
}