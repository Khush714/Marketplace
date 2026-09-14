import { db } from "@/db";
import { deliveryPartners } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

const VALID_VEHICLES = new Set(["bike", "scooter", "car", "walking"]);

/** GET /api/admin/delivery/partners — full roster (admin only). */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select()
    .from(deliveryPartners)
    .orderBy(asc(deliveryPartners.id));
  return Response.json({
    partners: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      vehicleType: r.vehicleType,
      status: r.status,
      active: r.active,
      totalDeliveries: r.totalDeliveries,
      rating: num(r.rating),
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

/** POST /api/admin/delivery/partners — add a rider to the dispatch directory. */
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    phone?: unknown;
    vehicleType?: unknown;
    notes?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const vehicleType = String(body.vehicleType ?? "bike").trim();
  const notes = String(body.notes ?? "").trim();

  if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
  if (!phone) return Response.json({ error: "Phone is required" }, { status: 400 });
  if (!VALID_VEHICLES.has(vehicleType)) {
    return Response.json(
      { error: "vehicleType must be bike, scooter, car or walking" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({ id: deliveryPartners.id })
    .from(deliveryPartners)
    .where(eq(deliveryPartners.phone, phone))
    .limit(1);
  if (existing) {
    return Response.json(
      { error: "A partner with that phone already exists" },
      { status: 409 },
    );
  }

  const [created] = await db
    .insert(deliveryPartners)
    .values({ name, phone, vehicleType, notes })
    .returning();

  return Response.json(
    {
      partner: {
        id: created.id,
        name: created.name,
        phone: created.phone,
        vehicleType: created.vehicleType,
        status: created.status,
        active: created.active,
        totalDeliveries: created.totalDeliveries,
        rating: num(created.rating),
        notes: created.notes,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}