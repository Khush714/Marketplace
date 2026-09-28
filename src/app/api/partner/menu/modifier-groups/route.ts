import { NextRequest } from "next/server";
import { createModifierGroup } from "@/db/partner-menu";
import { badRequest, readBody, readOwnerKey, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

/** Create a modifier group together with its first set of options. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await createModifierGroup(readOwnerKey(req), body));
}
