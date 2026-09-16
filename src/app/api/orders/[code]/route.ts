import { getOrderByCode } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ order });
}
