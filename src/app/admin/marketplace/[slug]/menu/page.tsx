import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getEditorMenu } from "@/lib/menu-admin";
import { MenuEditor } from "@/components/admin/MenuEditor";

export const dynamic = "force-dynamic";

export default async function MenuEditorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Owner-only — same guard as the rest of the admin marketplace tooling.
  if (!(await getCurrentAdmin())) redirect("/admin/login");

  const [r] = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);

  if (!r) notFound();

  const initial = await getEditorMenu(r.slug);
  if (!initial) notFound();

  return (
    <main className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
      <div className="mt-8">
        <Link
          href={`/admin/marketplace/${r.slug}`}
          className="text-sm text-white/45 hover:text-ember-400 hover:underline"
        >
          ← Restaurant settings
        </Link>
      </div>
      <div className="mt-4">
        <MenuEditor slug={r.slug} initial={initial} />
      </div>
    </main>
  );
}
