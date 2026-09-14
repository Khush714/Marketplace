import { VAPID_PUBLIC_KEY } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/push/vapid — public VAPID key for the browser to subscribe with. */
export async function GET() {
  if (!VAPID_PUBLIC_KEY) {
    return Response.json({ error: "Web Push not configured" }, { status: 503 });
  }
  return Response.json({ publicKey: VAPID_PUBLIC_KEY });
}