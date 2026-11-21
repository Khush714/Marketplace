import { NextRequest } from "next/server";
import { linkModifierGroup } from "@/db/partner-menu";
import { authoriseMenu, badRequest, readBody, readRowId, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Offer a modifier group on a dish. Re-linking the same pair is a no-op. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const itemId = readRowId((await ctx.params).id);
  if (itemId === null) return badRequest("Invalid dish id");
  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await linkModifierGroup(auth.restaurantId, itemId, body.groupId));
}
