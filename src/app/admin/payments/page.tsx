import type { Metadata } from "next";
import { PaymentsAdmin } from "@/components/admin/PaymentsAdmin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payments" };

export default function AdminPaymentsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Phase 24
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Payments</h1>
        <p className="mt-1 text-white/45">
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
