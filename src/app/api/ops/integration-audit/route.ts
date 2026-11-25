import type { NextRequest } from "next/server";
import { AUDIT_ACTORS, listAuditRows, parseAuditActor, type AuditRow } from "@/db/audit-read";
import { guardRead } from "@/lib/abuse";
import { maskIp, redactAuditDetail } from "@/lib/audit-redaction-core";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" } as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

function boundedInt(raw: string | null, min: number, max: number, fallback: number): number {
  const value = Number(raw ?? "");
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function boundedRestaurantId(raw: string | null): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  return value > 0 && value <= 2_147_483_647 ? value : null;
}

/** Redacted integration audit page for the ops console; never a write surface. */
export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "auditRead");
  if (blocked) return blocked;

  const denied = requireOpsToken(req);
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const query = {
    limit: boundedInt(params.get("limit"), 1, MAX_LIMIT, DEFAULT_LIMIT),
    offset: boundedInt(params.get("offset"), 0, MAX_OFFSET, 0),
    actor: parseAuditActor(params.get("actor")),
    event: (params.get("event") ?? "").replace(/[\\%_]/g, "").trim().slice(0, 64),
    restaurantId: boundedRestaurantId(params.get("restaurant_id") ?? params.get("restaurantId")),
  };

  const rows = await listAuditRows(query);
  const redacted: AuditRow[] = rows.map((row) => ({
    ...row,
    detail: redactAuditDetail(row.detail),
    ipAddress: maskIp(row.ipAddress),
  }));

  return Response.json(
    {
      ok: true,
      rows: redacted,
      actors: AUDIT_ACTORS,
      limit: query.limit,
      offset: query.offset,
    },
    { status: 200, headers: noStore },
  );
}
