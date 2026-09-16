import { getRestaurant } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const data = await getRestaurant(slug);
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(data);
}
