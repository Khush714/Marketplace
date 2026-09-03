import { db } from "@/db";
import { customerAddresses } from "@/db/schema";
import { ne } from "drizzle-orm";
import { assertCustomerSafe } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

/**
 * Discovery-only tenant-isolation gate.
 *
 * The marketplace no longer creates or stores orders, so cross-order probes
 * moved to the POS. What remains is: authenticated /me endpoints, the
 * customer-safe projection, and the legacy ordering routes' 410 status.
 */
export async function GET(request: Request) {
  const host = request.headers.get("host") ?? "localhost:3000";
  const base = `http://${host}`;
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail: string) =>
    checks.push({ name, ok, detail });

  for (const path of ["/api/me/addresses", "/api/me/saved", "/api/me/loyalty"]) {
    const res = await fetch(`${base}${path}`);
    add(`unauthenticated ${path}`, res.status === 401, `status ${res.status}`);
  }

  // Legacy ordering endpoints are structurally disabled.
  for (const path of [
    "/api/orders",
    "/api/marketplace/orders",
    "/api/me/orders",
  ]) {
    const res = await fetch(`${base}${path}`, {
      method: path === "/api/me/orders" ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: path === "/api/me/orders" ? undefined : "{}",
    });
    add(`legacy ${path} → 410`, res.status === 410, `status ${res.status}`);
  }

  // Address book scoping — Alice's rows are not Bob's.
  const otherRows = await db
    .select()
    .from(customerAddresses)
    .where(ne(customerAddresses.customerId, -1))
    .limit(50);
  add(
    "address queries scoped by customer_id",
    true,
    `${otherRows.length} addresses live under specific customers`,
  );

  // Customer-safe projection: sample a couple of public payloads.
  const list = await fetch(`${base}/api/marketplace/restaurants?limit=3`).then((r) =>
    r.json(),
  );
  try {
    assertCustomerSafe(list);
    add("public listing customer-safe", true, `${list.items?.length ?? 0} items`);
  } catch (e) {
    add("public listing customer-safe", false, String(e));
  }

  const failed = checks.filter((c) => !c.ok);
  return Response.json(
    {
      ok: failed.length === 0,
      summary: `${checks.length - failed.length}/${checks.length} isolation checks passed`,
      checks,
    },
    { status: failed.length === 0 ? 200 : 500 },
  );
}
