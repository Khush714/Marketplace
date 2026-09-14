import { db } from "@/db";
import { orders, deliveryAssignments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import {
  assignDeliveryPartner,
  advanceDeliveryAssignment,
  unassignDeliveryPartner,
} from "@/lib/delivery";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/delivery/orders/:reference/assignment
 *
 *   { "action": "assign",   "partnerId": 4,  "note": "..." }
 *   { "action": "advance",  "toStatus": "picked_up" }
 *   { "action": "unassign" }
 *
 * The admin is the dispatcher: it picks a rider, then advances the same
 * machine the rider's own token can drive.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reference = (await params).reference.trim().toUpperCase();
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    partnerId?: unknown;
    toStatus?: unknown;
    note?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  const action = String(body.action ?? "");

  if (action === "assign") {
    const partnerId = Number(body.partnerId);
    if (!Number.isInteger(partnerId) || partnerId <= 0) {
      return Response.json({ error: "partnerId is required" }, { status: 400 });
    }
    const res = await assignDeliveryPartner(reference, partnerId, {
      note: String(body.note ?? ""),
    });
    if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
    return Response.json({ assignment: res.assignment });
  }

  if (action === "advance") {
    const toStatus = String(body.toStatus ?? "");
    if (!toStatus) {
      return Response.json({ error: "toStatus is required" }, { status: 400 });
    }
    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.reference, reference))
      .limit(1);
    if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

    const [a] = await db
      .select({ token: deliveryAssignments.token })
      .from(deliveryAssignments)
      .where(eq(deliveryAssignments.orderId, order.id))
      .limit(1);
    if (!a) {
      return Response.json(
        { error: "No assignment for this order" },
        { status: 404 },
      );
    }
    const res = await advanceDeliveryAssignment(a.token, toStatus, {
      note: String(body.note ?? ""),
    });
    if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
    return Response.json({ assignment: res.assignment });
  }

  if (action === "unassign") {
    const res = await unassignDeliveryPartner(reference);
    if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
    return Response.json({ assignment: res.assignment });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}