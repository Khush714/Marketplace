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
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{name}</h3>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
              pending review
            </span>
          </div>
          <p className="mt-1 text-sm text-white/45">
            {cuisine} · {address}
          </p>
        </div>
        <Link
          href={`/admin/marketplace/${slug}`}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10"
        >
          Review details →
        </Link>
      </div>

      {description && (
        <p className="mt-3 line-clamp-2 text-sm text-white/60">{description}</p>
      )}

      {menuUrl && (
        <p className="mt-2 break-all text-xs text-white/35">Menu: {menuUrl}</p>
      )}

      {qrImageUrl && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/8 bg-white/5 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrImageUrl}
            alt={`Menu QR for ${name}`}
            className="h-20 w-20 rounded-lg border border-white/10 bg-ink-900 object-contain"
          />
          <p className="text-xs text-white/45">
            Restaurant uploaded a menu QR code. Verify it scans to their menu
            before approving.
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => decide("approve")}
          disabled={busy !== null}
          className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-ink-950 transition-all duration-200 hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => decide("reject")}
          disabled={busy !== null}
          className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-5 py-2 text-sm font-semibold text-rose-400 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
