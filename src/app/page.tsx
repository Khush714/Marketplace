import { listPublicRestaurants, listCategories } from "@/lib/marketplace";
import { HomeScreen } from "@/components/home/HomeScreen";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categories, nearby, popular, topRated] = await Promise.all([
    listCategories(),
    listPublicRestaurants({ sort: "nearby", limit: 8 }),
    listPublicRestaurants({ sort: "popular", limit: 8 }),
    listPublicRestaurants({ sort: "rating", limit: 8, minRating: 4 }),
  ]);

  return (
    <HomeScreen
      categories={categories}
      rails={[
        {
          key: "nearby",
          title: "Nearby restaurants",
          subtitle: "Fastest to reach you",
          items: nearby.items,
        },
        {
          key: "popular",
          title: "Popular restaurants",
          subtitle: "Most ordered and reviewed",
          items: popular.items,
        },
        {
          key: "rating",
          title: "Top rated",
          subtitle: "Rated 4.0 and above",
          items: topRated.items,
        },
      ]}
    />
  );
}
