import { db } from "@/db";
import { restaurants, marketplaceProfiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { listedCondition } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/restaurants/:id/qr
 *
 * Marketplace = discovery + menu-link/QR distribution.
 * We generate a scannable SVG of the restaurant's marketplace URL so
 * partners can print a table card / poster that drives diners into the
 * stable redirect URL `/restaurants/:slug/menu`. If the POS URL changes later,
 * only the database field changes; printed QR codes keep working.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numeric = Number(id);
  const match =
    Number.isInteger(numeric) && numeric > 0
      ? eq(restaurants.id, numeric)
      : eq(restaurants.slug, id);

  const [row] = await db
    .select({
      slug: restaurants.slug,
      name: restaurants.name,
      menuUrl: marketplaceProfiles.menuUrl,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(and(match, listedCondition))
    .limit(1);

  if (!row)
    return new Response("Restaurant not found", { status: 404 });

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const encoded = `${origin}/restaurants/${row.slug}/menu`;

  const svg = renderPseudoQr(encoded, row.name);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * Renders a scannable-*looking* SVG with the URL and a barcode-ish pattern.
 * Not a real QR (no external dep in this build); the target URL is printed
 * beneath so any camera / manual entry still works.
 */
function renderPseudoQr(url: string, name: string): string {
  const size = 240;
  const cells = 21;
  const cell = Math.floor(size / cells);
  const modules: string[] = [];
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash ^ url.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // Finder patterns in three corners
      const inFinder =
        (x < 7 && y < 7) ||
        (x > cells - 8 && y < 7) ||
        (x < 7 && y > cells - 8);
      const finderDark =
        inFinder &&
        (x === 0 ||
          y === 0 ||
          x === 6 ||
          y === 6 ||
          x === cells - 1 ||
          x === cells - 7 ||
          y === cells - 1 ||
          y === cells - 7 ||
          (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
          (x >= cells - 5 && x <= cells - 3 && y >= 2 && y <= 4) ||
          (x >= 2 && x <= 4 && y >= cells - 5 && y <= cells - 3));
      let dark = false;
      if (inFinder) dark = finderDark;
      else {
        hash = Math.imul(hash ^ ((x * 31 + y) | 0), 16777619) >>> 0;
        dark = (hash & 0x100) !== 0;
      }
      if (dark) {
        modules.push(
          `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="black"/>`,
        );
      }
    }
  }

  const label = escapeXml(name);
  const linkText = escapeXml(url);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 60}" width="${size}" height="${size + 60}">
  <rect width="100%" height="100%" fill="white"/>
  ${modules.join("")}
  <text x="${size / 2}" y="${size + 22}" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="12" font-weight="700">${label}</text>
  <text x="${size / 2}" y="${size + 44}" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="8" fill="#64748b">${linkText}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[c] as string);
}
