import { NextRequest } from "next/server";
import { createModifierGroup } from "@/db/partner-menu";
import { authoriseMenu, badRequest, readBody, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

/** Create a modifier group together with its first set of options. */
export async function POST(req: NextRequest) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await createModifierGroup(auth.restaurantId, body));
}
