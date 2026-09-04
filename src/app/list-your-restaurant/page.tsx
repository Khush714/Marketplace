import type { Metadata } from "next";
import { EnrollmentForm } from "@/components/EnrollmentForm";

export const metadata: Metadata = { title: "List your restaurant" };

export default function ListYourRestaurantPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-500">
          List your restaurant
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          Get your restaurant on TABLZ
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-500">
          Add your restaurant to our local marketplace so customers can discover
          you and order online. Your submission is reviewed and approved by our
          team before it goes live.
        </p>
      </div>

      <div className="mt-8">
        <EnrollmentForm />
      </div>
    </main>
  );
}
