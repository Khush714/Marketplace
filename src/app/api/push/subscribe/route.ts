import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";

export const dynamic = "force-dynamic";

const ENDPOINT_RE = /^https:\/\/[a-z0-9.-]+\//;
const MAX_ENDPOINT = 512;
const MAX_KEY = 256;

/**
 * POST /api/push/subscribe — register (or re-register) a PushSubscription for
 * the signed-in customer. Upserts on endpoint so a re-subscribe is idempotent.
 *
 * DELETE /api/push/subscribe?endpoint=… — revoke a subscription by endpoint
 * (only the owning customer may revoke their own).
 */
export async function POST(req: Request) {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = await req.json();
  const endpoint: unknown = body?.endpoint;
  const keys: unknown = body?.keys;
  const label: unknown = body?.label;

  if (typeof endpoint !== "string" || !ENDPOINT_RE.test(endpoint) || endpoint.length > MAX_ENDPOINT) {
    return Response.json({ error: "Invalid subscription endpoint" }, { status: 400 });
  }
  const p256dh = typeof keys === "object" && keys !== null ? (keys as { p256dh?: unknown }).p256dh : undefined;
  const auth = typeof keys === "object" && keys !== null ? (keys as { auth?: unknown }).auth : undefined;
  if (typeof p256dh !== "string" || p256dh.length > MAX_KEY) {
    return Response.json({ error: "Invalid p256dh key" }, { status: 400 });
  }
  if (typeof auth !== "string" || auth.length > MAX_KEY) {
    return Response.json({ error: "Invalid auth key" }, { status: 400 });
  }
  const safeLabel = typeof label === "string" && label.trim()
    ? label.trim().slice(0, 40)
    : "browser";

  // Upsert — reactivate a previously-revoked subscription for this endpoint
  // so an app reinstall or re-permission can refresh the record in place.
  await db
    .insert(pushSubscriptions)
    .values({
      customerId: me.id,
      endpoint,
      p256dh,
      auth,
      label: safeLabel,
      revoked: false,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        customerId: me.id,
        p256dh,
        auth,
        label: safeLabel,
        revoked: false,
        lastError: null,
      },
    });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });

  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";

  await db
    .update(pushSubscriptions)
    .set({ revoked: true })
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.customerId, me.id),
      ),
    );

  return Response.json({ ok: true });
}