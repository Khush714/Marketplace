import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { sql } from "drizzle-orm";
import { getOrderDeliveryList } from "@/lib/data";
import { OrderDeliveryStatus } from "@/components/admin/OrderDeliveryStatus";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order delivery queue" };

const FILTERS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Pending", value: "pending" },
  { label: "Queued", value: "queued" },
  { label: "Delivering", value: "delivering" },
  { label: "Failed", value: "failed" },
  { label: "Delivered", value: "delivered" },
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const statusFilter =
    status && FILTERS.some((f) => f.value === status) ? status : undefined;

  const deliveries = await getOrderDeliveryList(60, statusFilter ? [statusFilter] : undefined);

  const countRows = await db
    .select({ status: orders.posDeliveryStatus, count: sql<number>`count(*)` })
    .from(orders)
    .groupBy(orders.posDeliveryStatus);
  const counts = new Map(countRows.map((r) => [r.status, Number(r.count)]));
  const countOf = (s: string) => counts.get(s) ?? 0;
  const total = countRows.reduce((sum, r) => sum + Number(r.count), 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Phase 16 · failure handling
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
          Order delivery queue
        </h1>
        <p className="mt-1 max-w-2xl text-white/45">
          Orders are queued for the restaurant&apos;s POS after payment
          succeeds. When RestaurantAI is offline, delivery stays in the queue
          and retries automatically. Failed orders can be retried here.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active =
            (f.value ?? undefined) === statusFilter;
          return (
            <Link
              key={f.label}
              href={f.value ? `/admin/orders?status=${f.value}` : "/admin/orders"}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-ember-500 text-ink-950"
                  : "border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              {f.label}
              {f.value ? <span className="ml-1 opacity-60">{countOf(f.value)}</span> : null}
            </Link>
          );
        })}
        <span className="ml-auto text-xs text-white/35">{total} orders total</span>
      </div>

      <div className="mt-5 space-y-3">
        {deliveries.length === 0 && (
          <div className="rounded-2xl border border-white/8 bg-ink-850 p-10 text-center">
            <p className="text-sm text-white/40">No orders in this view yet.</p>
          </div>
        )}
        {deliveries.map((d) => (
          <OrderDeliveryStatus key={d.reference} delivery={d} />
        ))}
      </div>
    </main>
  );
}