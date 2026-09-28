import { NextRequest } from "next/server";
import { createMenuItem } from "@/db/partner-menu";
import { badRequest, readBody, readOwnerKey, respond } from "@/lib/partner-menu-api";

export const dynamic = "force-dynamic";

/** Add a dish to the owner's menu. POS identity columns stay unset. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return badRequest("Invalid request");
  return respond(await createMenuItem(readOwnerKey(req), body));
}
