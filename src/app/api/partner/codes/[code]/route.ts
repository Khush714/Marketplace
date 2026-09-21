import { getConnectionCode } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const hit = await getConnectionCode(code);
  if (!hit) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ code: hit });
}