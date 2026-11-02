import { getMerchantIntegrationSession } from "@/db/queries";

export async function requireMerchantIntegration(req: Request): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getMerchantIntegrationSession>>> }
  | { ok: false; response: Response }
> {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32})$/.exec(authorization);
  if (!match) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Merchant integration authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  const session = await getMerchantIntegrationSession(match[1]);
  if (!session) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Merchant integration authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true, session };
}
