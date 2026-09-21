import { NextRequest } from "next/server";
import { listConnectionCodes, mintConnectionCode } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ codes: await listConnectionCodes() });
}

export async function POST(req: NextRequest) {
  let days = 0;
  try {
    const body = await req.json();
    const raw = Math.floor(Number(body?.days));
    days = Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    // Bodies are optional — callers may mint without configuring expiry.
  }
  const code = await mintConnectionCode(days);
  return Response.json({ code }, { status: 201 });
}