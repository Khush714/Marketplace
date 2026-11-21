import { NextRequest } from "next/server";
import { getPartnerMenu } from "@/db/partner-menu";
import { authoriseMenu } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

/**
 * The whole editable menu for the signed-in partner: dishes, modifier groups with
 * their options, and dish↔group attachments. One document keeps the editor a
 * single fetch and every screen in sync after a write.
 */
export async function GET(req: NextRequest) {
  const auth = await authoriseMenu(req, false);
  if (!auth.ok) return auth.response;

  const menu = await getPartnerMenu(auth.restaurantId);
  if (!menu) return Response.json({ ok: false, error: "Sign in again" }, { status: 401 });
  return Response.json({ ok: true, menu }, { status: 200 });
}
