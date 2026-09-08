import type { Metadata } from "next";
import { PaymentsAdmin } from "@/components/admin/PaymentsAdmin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payments" };

export default function AdminPaymentsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Phase 24
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Payments</h1>
        <p className="mt-1 text-slate-500">
          Razorpay audit trail. Captured payments can be fully or partially
          refunded from here.
        </p>
      </div>
      <div className="mt-6">
        <PaymentsAdmin />
      </div>
    </main>
  );
}