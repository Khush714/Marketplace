import type { Metadata } from "next";
import { RestaurantList } from "@/components/admin/RestaurantList";
import { requireAdmin } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Restaurants — Admin" };

export default async function AdminRestaurantsPage() {
  if (!(await requireAdmin())) redirect("/admin/login");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/admin/restaurants`,
    { cache: "no-store" },
  );
  const data = await res.json();
  const restaurants = data.restaurants ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Marketplace admin
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
          Restaurants
        </h1>
        <p className="mt-1 max-w-2xl text-white/45">
          Manage your restaurant directory. Add new restaurants and monitor
          their connection status.
        </p>
      </div>
      <div className="mt-6">
        <RestaurantList initialRestaurants={restaurants} />
      </div>
    </main>
  );
}
