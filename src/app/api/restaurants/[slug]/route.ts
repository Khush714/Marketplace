import { getRestaurantBySlug } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const data = await getRestaurantBySlug(slug);
    if (!data) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }
    return Response.json({ restaurant: data });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to load restaurant" }, { status: 500 });
  }
}
