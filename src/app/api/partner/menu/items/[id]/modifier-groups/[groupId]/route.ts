import { NextRequest } from "next/server";
import { unlinkModifierGroup } from "@/db/partner-menu";
import { authoriseMenu, badRequest, readRowId, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; groupId: string }> };

/** Stop offering a modifier group on a dish, leaving the group itself intact. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await authoriseMenu(req, true);
  if (!auth.ok) return auth.response;

  const { id, groupId } = await ctx.params;
  const itemId = readRowId(id);
  const modifierGroupId = readRowId(groupId);
  if (itemId === null) return badRequest("Invalid dish id");
  if (modifierGroupId === null) return badRequest("Invalid modifier group id");
  return respond(await unlinkModifierGroup(auth.restaurantId, itemId, modifierGroupId));
}
