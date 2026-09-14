import { db } from "@/db";
import { customerAddresses } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";
import { parseLatLng } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const list = await db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, me.id))
    .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt));
  return Response.json({ addresses: list });
}

export async function POST(request: Request) {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "Home").slice(0, 40).trim() || "Home";
  const line = String(body.line ?? "").trim();
  const makeDefault = body.isDefault === true;
  if (!line) return Response.json({ error: "Address is required" }, { status: 400 });

  // PHASE 30 — optional lat/lng so saved addresses can be reused as dropoff
  // coords at checkout. Validated when provided.
  const coords = parseLatLng(
    body.lat == null || body.lat === "" ? null : String(body.lat),
    body.lng == null || body.lng === "" ? null : String(body.lng),
  );
  if ((body.lat != null || body.lng != null) && !coords) {
    return Response.json({ error: "Coordinates are invalid" }, { status: 400 });
  }

  if (makeDefault) {
    await db
      .update(customerAddresses)
      .set({ isDefault: false })
      .where(eq(customerAddresses.customerId, me.id));
  }

  const existing = await db
    .select({ n: customerAddresses.id })
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, me.id));

  const [row] = await db
    .insert(customerAddresses)
    .values({
      customerId: me.id,
      label,
      line,
      lat: coords ? coords.lat.toFixed(6) : null,
      lng: coords ? coords.lng.toFixed(6) : null,
      isDefault: makeDefault || existing.length === 0,
    })
    .returning();
  return Response.json({ address: row }, { status: 201 });
}

export async function DELETE(request: Request) {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id))
    return Response.json({ error: "id required" }, { status: 400 });
  await db
    .delete(customerAddresses)
    .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, me.id)));
  return Response.json({ ok: true });
}
