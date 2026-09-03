import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicMenu } from "@/lib/marketplace";
import { currency } from "@/lib/format";

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
      <div className="relative h-56 overflow-hidden bg-slate-200 sm:h-72 sm:rounded-b-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.imageUrl}
          alt={r.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        <Link
          href={`/restaurants/${r.slug}`}
          className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-800 shadow backdrop-blur transition hover:bg-white"
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
            <p className="text-lg font-semibold text-slate-400">
              No menu items available
            </p>
            <p className="mt-2 text-sm text-slate-400">
              This restaurant hasn&apos;t added any items yet.
            </p>
          </div>
        ) : (
          categories.map((cat) => (
            <section key={cat.name} className="mb-10">
              <h2 className="sticky top-0 z-10 -mx-4 border-b border-slate-100 bg-white/95 px-4 py-3 text-lg font-bold tracking-tight text-slate-900 backdrop-blur sm:-mx-6 sm:px-6">
                {cat.name}
              </h2>

              <div className="mt-4 space-y-4">
                {cat.items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex gap-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition hover:shadow-md ${
                      !item.available ? "opacity-50" : ""
                    }`}
                  >
                    {/* Item info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">
                          {item.name}
                        </h3>
                        {item.popular && (
                          <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
                            Popular
                          </span>
                        )}
                        {item.vegetarian && (
                          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-600">
                            Veg
                          </span>
                        )}
                      </div>

                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                          {item.description}
                        </p>
                      )}

                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {currency(item.price)}
                      </p>

                      {!item.available && (
                        <p className="mt-1 text-xs font-medium text-red-400">
                          Currently unavailable
                        </p>
                      )}
                    </div>

                    {/* Item image */}
                    {item.imageUrl && (
                      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {/* Back link */}
        <div className="mt-8 text-center">
          <Link
            href={`/restaurants/${r.slug}`}
            className="inline-block rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            ← Back to {r.name}
          </Link>
        </div>
      </div>
    </main>
  );
}
