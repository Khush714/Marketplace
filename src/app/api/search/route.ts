import { NextRequest } from "next/server";
import { searchAll } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  return Response.json({ results: await searchAll(q) });
}
