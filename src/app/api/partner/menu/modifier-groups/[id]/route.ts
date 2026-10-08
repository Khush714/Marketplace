import { NextRequest } from "next/server";
import { deleteModifierGroup, updateModifierGroup } from "@/db/partner-menu";
import { authoriseMenu, badRequest, readBody, readRowId, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Update a group. Sending `options` replaces the option set wholesale; options
 * that carry an `id` are updated in place, the rest are created, and any option
 * left out is removed. Order history is unaffected because orders store item
 * snapshots.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const id = readRowId((await ctx.params).id);
  if (id === null) return badRequest("Invalid modifier group id");
  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await updateModifierGroup(auth.restaurantId, id, body));
}

/** Delete a group; its options and dish links cascade away with it. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const id = readRowId((await ctx.params).id);
  if (id === null) return badRequest("Invalid modifier group id");
  return respond(await deleteModifierGroup(auth.restaurantId, id));
}
