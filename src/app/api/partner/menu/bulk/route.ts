import type { NextRequest } from "next/server";
import { applyBulkMenuUpdates } from "@/db/partner-menu-bulk";
import { guardBudget, readRawBodyCapped } from "@/lib/abuse";
import { BULK_MENU_MAX_BYTES, parseBulkMenuPaste } from "@/lib/bulk-menu-core";
import { authoriseMenu } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" } as const;

/** POST a bounded CSV/tab paste to update partner-owned dishes atomically. */
export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "partnerBulkMenu");
  if (blocked) return blocked;

  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const raw = await readRawBodyCapped(req, BULK_MENU_MAX_BYTES);
  if (!raw.ok) return raw.response;

  const parsed = parseBulkMenuPaste(raw.text);
  if (!parsed.ok) {
    return Response.json(
      {
        ok: false,
        error: parsed.error ?? "Fix the highlighted rows before applying.",
        issues: parsed.issues,
        rows: parsed.rows,
      },
      { status: 400, headers: noStore },
    );
  }

  const result = await applyBulkMenuUpdates(auth.restaurantId, parsed);
  if (!result.ok) {
    return Response.json(result, { status: 400, headers: noStore });
  }
  return Response.json(result, { status: 200, headers: noStore });
}
