import { NextRequest } from "next/server";
import { getPartnerMenu } from "@/db/partner-menu";
import { invalidOwnerKey, readOwnerKey } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

/**
 * The whole editable menu for the owner behind the key: dishes, modifier
 * groups with their options, and dish→group attachments. One document keeps the
 * editor a single fetch and every screen in sync after a write.
 */
export async function GET(req: NextRequest) {
  const menu = await getPartnerMenu(readOwnerKey(req));
  if (!menu) return invalidOwnerKey();
  return Response.json({ ok: true, menu }, { status: 200 });
}
