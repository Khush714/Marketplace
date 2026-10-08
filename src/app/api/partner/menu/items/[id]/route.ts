import { NextRequest } from "next/server";
import { deleteMenuItem, updateMenuItem } from "@/db/partner-menu";
import { authoriseMenu, badRequest, readBody, readRowId, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Update one dish. Unsent fields keep their stored value. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const id = readRowId((await ctx.params).id);
  if (id === null) return badRequest("Invalid dish id");
  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await updateMenuItem(auth.restaurantId, id, body));
}

/** Delete a dish; its modifier-group links cascade away with it. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const id = readRowId((await ctx.params).id);
  if (id === null) return badRequest("Invalid dish id");
  return respond(await deleteMenuItem(auth.restaurantId, id));
}
