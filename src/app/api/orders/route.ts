import { NextRequest } from "next/server";
import { createOrder, listOrders, type CreateOrderInput } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const codes = (req.nextUrl.searchParams.get("codes") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!codes.length) return Response.json({ orders: [] });
  return Response.json({ orders: await listOrders(codes) });
}

export async function POST(req: NextRequest) {
  let body: CreateOrderInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  // Shape validation; all prices/totals are recomputed server-side from the DB.
  const phoneDigits = String(body?.phone ?? "").replace(/\D/g, "");
  const invalid =
    !body?.restaurantSlug ||
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    !body.customerName?.trim() ||
    !body.addressText?.trim() ||
    phoneDigits.length < 10;
  if (invalid) {
    return Response.json({ ok: false, error: "Missing or invalid required fields" }, { status: 400 });
  }
  body.phone = phoneDigits.slice(-10);

  const result = await createOrder(body);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 201 });
}
