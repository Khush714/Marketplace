import { NextRequest } from "next/server";
import { authenticateIntegration, createIntegrationSession } from "@/db/queries";

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
  const identity = await authenticateIntegration(code, passkey);
  if (!identity) {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }
  const { token, expiresAtIso } = await createIntegrationSession(identity);
  return Response.json({
    ok: true,
    restaurant: identity.restaurant,
    token,
    tokenExpiresAt: expiresAtIso,
  });
}