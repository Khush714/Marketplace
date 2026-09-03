import {
  assertCustomerSafe,
  listPublicRestaurants,
  getPublicRestaurant,
  listPublicReviews,
  listCategories,
  searchMarketplace,
} from "@/lib/marketplace";

export const dynamic = "force-dynamic";

const REDACTED = [
  "inventory cost",
  "staff information",
  "restaurant financials",
  "supplier information",
  "internal analytics",
  "other customers",
  "POS configuration",
  "commission / commercial terms",
  "internal relational ids",
];

/**
 * Customer-safety regression gate for the discovery-only surface.
 * Order tracking moved to the POS; the audit no longer probes it.
 */
export async function GET() {
  const checks: { endpoint: string; status: "pass" | "fail"; detail: string }[] =
    [];

  const run = async (
    endpoint: string,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      const payload = await fn();
      assertCustomerSafe(payload);
      checks.push({ endpoint, status: "pass", detail: "no internal fields" });
    } catch (e) {
      checks.push({
        endpoint,
        status: "fail",
        detail: e instanceof Error ? e.message : "unknown error",
      });
    }
  };

  const list = await listPublicRestaurants({ limit: 5 });
  const first = list.items[0];

  await run("GET /restaurants", () => listPublicRestaurants({ limit: 5 }));
  if (first) {
    await run(`GET /restaurants/${first.id}`, () => getPublicRestaurant(String(first.id)));
    await run(
      `GET /restaurants/${first.id}/reviews`,
      () => listPublicReviews(String(first.id)),
    );
  }
  await run("GET /categories", () => listCategories());
  await run("GET /search?q=ramen", () => searchMarketplace("ramen"));

  const failed = checks.filter((c) => c.status === "fail");
  return Response.json(
    {
      ok: failed.length === 0,
      summary: `${checks.length - failed.length}/${checks.length} endpoints customer-safe`,
      neverExposed: REDACTED,
      checks,
    },
    { status: failed.length === 0 ? 200 : 500 },
  );
}
