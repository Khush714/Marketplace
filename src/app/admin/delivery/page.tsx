import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryControl } from "@/components/admin/DeliveryControl";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delivery partners · Platform admin" };

export default function DeliveryAdminPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Phase 29 · dispatch
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
          Delivery partners
        </h1>
        <p className="mt-1 max-w-2xl text-white/45">
          Run the rider directory and assign partners to live delivery orders.
          Customers see the rider and progress on their tracker in real time.
        </p>
        <Link
          href="/admin"
          className="mt-4 inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
        >
          ← Back to admin
        </Link>
      </div>
      <div className="mt-6">
        <DeliveryControl />
      </div>
    </main>
  );
}