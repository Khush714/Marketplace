import { opsTokenOptional } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * Tells the ops console whether this deployment has an ops token configured.
 *
 * This exists because of a real mismatch: `requireOpsToken` allows an
 * unauthenticated caller whenever `POS_DELIVERY_OPS_TOKEN` is unset outside
 * production, but the console used to gate its own buttons on a non-empty
 * token field. The result was a permanently dead Mint button on exactly the
 * deployments where minting was the one thing that worked, with no hint about
 * why. Rather than duplicating `NODE_ENV`/env knowledge in the client, the
 * console asks.
 *
 * The answer is a single boolean and reveals nothing an operator who can
 * already reach /ops does not know — it does not expose the token, its length,
 * or a hash. Do not widen this into a config dump.
 */
export async function GET() {
  return Response.json(
    { open: opsTokenOptional() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
