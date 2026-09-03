export const dynamic = "force-dynamic";

/**
 * POST /api/web-vitals — receive client metrics (LCP/FID/etc.) for Phase 23.
 * Logged via console; a real pipeline can flush to a warehouse later.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    // Simple scalar metrics only — no PII, no free-text payloads.
    const safe = {
      name: String(body.name ?? "").slice(0, 16),
      value: Number(body.value) || 0,
      id: String(body.id ?? "").slice(0, 64),
      route: String(body.route ?? "").slice(0, 120),
    };
    console.log("[web-vitals]", safe);
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "bad metrics" }, { status: 400 });
  }
}
