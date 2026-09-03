import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PosOrderQueue } from "@/components/pos/PosOrderQueue";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} · POS` };
}

export default async function PosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { slug } = await params;
  const { key } = await searchParams;

  const [r] = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 pb-20 sm:px-6">
      <nav className="mt-8">
        <Link
          href="/admin/pos"
          className="text-sm text-slate-500 hover:text-orange-600 hover:underline"
        >
          ← POS bridge
        </Link>
      </nav>

      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{r.name}</h1>
        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-600">
          POS queue
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Marketplace orders appear here in real time. Accepting advances the
        order through the same lifecycle the customer sees.
      </p>

      <div className="mt-6">
        <PosOrderQueue
          restaurantName={r.name}
          slug={slug}
          initialKey={key ?? ""}
        />
      </div>
    </main>
  );
}
