import { guardRead } from "@/lib/abuse";
import { isGoogleAuthConfigured } from "@/lib/customer-google-auth";

export const dynamic = "force-dynamic";

/**
 * Whether the optional free Google Sign-In is configured for this deployment.
 * A boolean only — no client id, secret, redirect URI or account state. The
 * existing mobile OTP flow is independent and does not consult this endpoint.
 */
export function GET(req: Request) {
  const blocked = guardRead(req, "customerAuthStart");
  if (blocked) return blocked;

  return Response.json(
    { ok: true, available: isGoogleAuthConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
