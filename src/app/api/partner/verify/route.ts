import { NextRequest } from "next/server";
import { verifyOwner } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let ownerKey: string;
  try {
    const body = await req.json();
    ownerKey = String(body?.ownerKey ?? "").trim();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const restaurant = await verifyOwner(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });
  return Response.json({ ok: true, restaurant });
}