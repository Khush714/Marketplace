import { db } from "@/db";
import { marketplaceProfiles, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { normalizeMenuUrl } from "@/lib/menu-url";
import { getPublicRestaurant } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

/**
 * DISCOVERY-ONLY ACCEPTANCE SUITE.
 *
 * The marketplace no longer creates orders — most legacy Phase 24 scenarios
 * (payment failure, POS accept, cancel, duplicate order) now belong to each
 * restaurant's own POS. This suite verifies the pieces the marketplace
 * *does* own: discovery, deep-linking, menu-URL validation, and the fact
 * that legacy order endpoints are structurally disabled.
 */
export async function GET(request: Request) {
  const host = request.headers.get("host") ?? "localhost:3000";
  const base = `http://${host}`;
  const report: {
    scenario: string;
    name: string;
    status: "pass" | "fail";
    detail: string;
  }[] = [];
  const pass = (s: string, n: string, d: string) =>
    report.push({ scenario: s, name: n, status: "pass", detail: d });
  const fail = (s: string, n: string, d: string) =>
    report.push({ scenario: s, name: n, status: "fail", detail: d });

  // ---- 1. Restaurants listing works ----------------------------------
  {
    const res = await fetch(`${base}/api/marketplace/restaurants`);
    const data = await res.json();
    const first = (data.items ?? [])[0];
    if (res.ok && first && typeof first.menuUrl === "string") {
      pass(
        "1",
        "restaurants listing exposes menuUrl",
        `${data.items.length} items, e.g. ${first.name} → ${first.menuUrl || "(unset)"}`,
      );
    } else {
      fail("1", "restaurants listing", `${res.status}`);
    }
  }

  // ---- 2. Restaurant profile deep-linkable ----------------------------
  {
    const r = await getPublicRestaurant("bella-napoli");
    if (r && typeof r.menuUrl === "string" && r.menuUrl.startsWith("http")) {
      pass("2", "restaurant profile has valid menuUrl", r.menuUrl);
    } else {
      fail("2", "restaurant profile menuUrl", JSON.stringify({ has: !!r, url: r?.menuUrl }));
    }
  }

  // ---- 3. Menu-URL validation --------------------------------------
  {
    const scenarios = [
      { input: "", expect: "" },
      { input: "https://pos.example.com/order/foo", expect: "https://pos.example.com/order/foo" },
      { input: "javascript:alert(1)", expect: "throw" },
      { input: "ftp://pos.example.com/menu", expect: "throw" },
      { input: "not a url", expect: "throw" },
    ];
    let ok = true;
    for (const s of scenarios) {
      try {
        const got = normalizeMenuUrl(s.input);
        if (s.expect === "throw") ok = false;
        else if (got !== s.expect) ok = false;
      } catch {
        if (s.expect !== "throw") ok = false;
      }
    }
    ok
      ? pass("3", "menu URL validation", "empty ok, https ok, js/ftp/garbage rejected")
      : fail("3", "menu URL validation", "unexpected result");
  }

  // ---- 4. Legacy order-creation endpoints are 410 ---------------------
  {
    const bodies = [
      { path: "/api/orders", method: "POST" },
      { path: "/api/marketplace/orders", method: "POST" },
      { path: "/api/marketplace/orders/MKT-ANY", method: "GET" },
      { path: "/api/marketplace/orders/MKT-ANY/cancel", method: "POST" },
      { path: "/api/orders/MKT-ANY", method: "GET" },
      { path: "/api/me/orders", method: "GET" },
    ];
    let allGone = true;
    for (const b of bodies) {
      const res = await fetch(`${base}${b.path}`, {
        method: b.method,
        headers: { "content-type": "application/json" },
        body: b.method === "POST" ? "{}" : undefined,
      });
      if (res.status !== 410) {
        allGone = false;
        fail("4", `${b.method} ${b.path}`, `expected 410, got ${res.status}`);
      }
    }
    if (allGone)
      pass("4", "legacy ordering endpoints deprecated (410 Gone)", `${bodies.length} routes`);
  }

  // ---- 5. QR endpoint returns SVG for the stable redirect URL ----------
  {
    const res = await fetch(`${base}/api/marketplace/restaurants/bella-napoli/qr`);
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (
      res.ok &&
      contentType.includes("svg") &&
      body.includes("<svg") &&
      body.includes("/restaurants/bella-napoli/menu")
    ) {
      pass("5", "QR endpoint uses stable marketplace menu URL", `${body.length} bytes svg`);
    } else {
      fail("5", "QR endpoint", `${res.status} ${contentType}`);
    }
  }

  // ---- 6. Admin can save menuUrl, invalid URL is rejected -------------
  {
    const [current] = await db
      .select({ id: marketplaceProfiles.id, menuUrl: marketplaceProfiles.menuUrl })
      .from(marketplaceProfiles)
      .innerJoin(
        restaurants,
        eq(restaurants.id, marketplaceProfiles.restaurantId),
      )
      .where(eq(restaurants.slug, "bella-napoli"))
      .limit(1);

    const bad = await fetch(`${base}/api/admin/marketplace/bella-napoli`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ menuUrl: "javascript:alert(1)" }),
    });
    if (bad.status === 400) {
      pass("6", "admin rejects javascript: menu URL", "400");
    } else {
      fail("6", "admin rejects bad menu URL", `${bad.status}`);
    }

    const good = await fetch(`${base}/api/admin/marketplace/bella-napoli`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ menuUrl: "https://pos.example.com/order/bella-napoli" }),
    });
    if (good.ok) {
      pass("6", "admin accepts https menu URL", "200");
    } else {
      fail("6", "admin accepts https menu URL", `${good.status}`);
    }

    // Restore prior value.
    if (current)
      await db
        .update(marketplaceProfiles)
        .set({ menuUrl: current.menuUrl })
        .where(eq(marketplaceProfiles.id, current.id));
  }

  const failed = report.filter((r) => r.status === "fail");
  const summary = `${report.length - failed.length}/${report.length} discovery-only checks passed`;
  return Response.json({ ok: failed.length === 0, summary, report }, {
    status: failed.length ? 500 : 200,
  });
}
