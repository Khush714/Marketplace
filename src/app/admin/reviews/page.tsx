import type { Metadata } from "next";
import { ReviewModeration } from "@/components/admin/ReviewModeration";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review moderation" };

export default function ReviewModerationPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 pb-12 sm:px-6">
      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Phase 14
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Review moderation
        </h1>
        <p className="mt-1 text-slate-500">
          Only verified, purchase-eligible reviews are counted toward a
          restaurant&apos;s published rating. Moderate here; restaurants can
          respond on their own reviews.
        </p>
      </div>
      <div className="mt-6">
        <ReviewModeration />
      </div>
    </main>
  );
}
