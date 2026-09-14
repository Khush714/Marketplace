import { reportRiderLocation } from "@/lib/delivery";

export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/assignments/:token/location — report the rider's live
 * position fix.
 *   { "lat": 28.613939, "lng": 77.209021, "heading": 144.5 }
 *
 * Authority is the assignment token (same public credential as the order
 * reference). Fixes are persisted + streamed over the dedicated real-time
 * `marketplace_rider_locations` channel, rate-limited server-side. A
 * `skipped: true` response means the previous fix was too recent to matter —
 * the caller can keep the last known position.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = (await params).token.trim();
  const body = (await request.json().catch(() => null)) as {
    lat?: unknown;
    lng?: unknown;
    heading?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  const res = await reportRiderLocation(token, {
    lat: body.lat == null ? Number.NaN : Number(body.lat),
    lng: body.lng == null ? Number.NaN : Number(body.lng),
    heading: body.heading == null ? null : Number(body.heading),
  });
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });

  return Response.json({
    ok: true,
    skipped: res.skipped ?? false,
    rider: res.rider,
  });
}