import { NextRequest } from "next/server";
import { rotatePasskey } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let code: string;
  let passkey: string;
  try {
    const body = await req.json();
    code = String(body?.code ?? "").trim();
    passkey = String(body?.passkey ?? "");
  } catch {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }
  const result = await rotatePasskey(code, passkey);
  if (!result.ok) return Response.json(result, { status: 401 });
  return Response.json(result);
}