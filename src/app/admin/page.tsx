import type { Metadata } from "next";
import { OperatorDashboard } from "@/components/admin/OperatorDashboard";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Platform admin" };

export default function PlatformAdminPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Phase 17 · operator
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Marketplace admin
        </h1>
        <p className="mt-1 max-w-2xl text-slate-500">
          Approve restaurants, moderate reviews, and watch live marketplace
          orders — without touching the POS.
        </p>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/marketplace" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">
          Restaurant onboarding
        </Link>
        <Link href="/admin/pos" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">
          POS bridge
        </Link>
        <Link href="/admin/reviews" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">
          Review moderation
        </Link>
        <Link href="/admin/users" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">
          Operators
        </Link>
      </nav>
      <div className="mt-6">
        <OperatorDashboard />
      </div>
    </main>
  );
}
