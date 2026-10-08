import { NextRequest } from "next/server";
import { createMenuItem } from "@/db/partner-menu";
import { authoriseMenu, badRequest, readBody, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

/** Add a dish to the signed-in partner's menu. POS identity columns stay unset. */
export async function POST(req: NextRequest) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await createMenuItem(auth.restaurantId, body));
}
