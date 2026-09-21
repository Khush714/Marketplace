import { NextRequest } from "next/server";
import { listConnections, redeemConnectionCode, type RedeemConnectionInput } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ connections: await listConnections() });
}

export async function POST(req: NextRequest) {
  let body: RedeemConnectionInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await redeemConnectionCode(body);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 201 });
}