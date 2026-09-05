"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function PendingReviewCard({
  name,
  slug,
  cuisine,
  address,
  description,
  menuUrl,
  qrImageUrl,
}: {
  name: string;
  slug: string;
  cuisine: string;
  address: string;
  description: string;
  menuUrl: string;
  qrImageUrl?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/marketplace/${slug}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{name}</h3>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
              pending review
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {cuisine} · {address}
          </p>
        </div>
        <Link
          href={`/admin/marketplace/${slug}`}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Review details →
        </Link>
      </div>

      {description && (
        <p className="mt-3 line-clamp-2 text-sm text-slate-600">{description}</p>
      )}

      {menuUrl && (
        <p className="mt-2 break-all text-xs text-slate-400">Menu: {menuUrl}</p>
      )}

      {qrImageUrl && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrImageUrl}
            alt={`Menu QR for ${name}`}
            className="h-20 w-20 rounded-lg border border-slate-200 bg-white object-contain"
          />
          <p className="text-xs text-slate-500">
            Restaurant uploaded a menu QR code. Verify it scans to their menu
            before approving.
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => decide("approve")}
          disabled={busy !== null}
          className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => decide("reject")}
          disabled={busy !== null}
          className="rounded-xl border border-rose-300 px-5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
