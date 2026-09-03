import { getRestaurants } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? undefined;
  const cuisine = searchParams.get("cuisine") ?? undefined;
  try {
    const data = await getRestaurants({ search, cuisine });
    return Response.json({ restaurants: data });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to load restaurants" }, { status: 500 });
  }
}
