import { NextRequest } from "next/server";
import { searchAll } from "@/db/queries";
import { localityByKey } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const locality = localityByKey(req.nextUrl.searchParams.get("loc")).name;
  if (q.length < 2) return Response.json({ results: [] });
  return Response.json({ results: await searchAll(q, locality) });
}
