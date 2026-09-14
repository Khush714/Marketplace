import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicMenu } from "@/lib/marketplace";
import { OrderMenuClient } from "@/components/OrderMenuClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const menu = await getPublicMenu(restaurantId);
  return { title: menu ? `${menu.restaurant.name} Menu` : "Menu" };
}

export default async function RestaurantMenuPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const menu = await getPublicMenu(restaurantId);

  if (!menu) notFound();

  const { restaurant: r, categories } = menu;

  return (
    <main className="mx-auto max-w-4xl pb-16">
      {/* Hero */}
      <div className="relative h-56 overflow-hidden bg-white/5 sm:h-72 sm:rounded-b-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.imageUrl}
          alt={r.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        <Link
          href={`/restaurants/${r.slug}`}
          className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-ink-900/90 text-white shadow backdrop-blur ring-1 ring-white/15 transition hover:bg-ink-800"
          aria-label="Back to restaurant"
        >
          ←
        </Link>

        <div className="absolute bottom-4 left-4 right-4 text-white">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {r.name}
          </h1>
          <p className="mt-1 text-sm text-white/80">
            {r.cuisines.join(" • ")} • {r.priceRange}
          </p>
        </div>
      </div>

      {/* Menu content */}
      <div className="px-4 pt-6 sm:px-6">
        {categories.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-lg font-semibold text-white/45">
              No menu items available
            </p>
            <p className="mt-2 text-sm text-white/40">
              This restaurant hasn&apos;t added any items yet.
            </p>
          </div>
        ) : (
          <OrderMenuClient
            categories={categories}
            restaurant={{
              slug: r.slug,
              name: r.name,
              taxRate: r.taxRate,
              deliveryFee: r.deliveryFee,
              minOrder: r.minOrder,
              accepts: r.accepts,
            }}
          />
        )}

        {/* Back link */}
        <div className="mt-8 text-center">
          <Link
            href={`/restaurants/${r.slug}`}
            className="inline-block rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
          >
            ← Back to {r.name}
          </Link>
        </div>
      </div>
    </main>
  );
}
