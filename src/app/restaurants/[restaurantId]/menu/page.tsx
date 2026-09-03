import { redirect, notFound } from "next/navigation";
import { getPublicRestaurant } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

export default async function RestaurantMenuRedirect({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;

  const restaurant = await getPublicRestaurant(restaurantId);

  if (!restaurant) {
    notFound();
  }

  if (!restaurant.menuUrl) {
    redirect(`/restaurants/${restaurant.slug}`);
  }

  redirect(restaurant.menuUrl);
}
