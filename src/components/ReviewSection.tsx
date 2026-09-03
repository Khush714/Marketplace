"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicReview } from "@/lib/marketplace";
import { Stars } from "./Stars";
import { shortDate } from "@/lib/format";

export function ReviewSection({
  slug,
  reviews,
}: {
  slug: string;
  reviews: PublicReview[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerName: "",
    rating: 5,
    comment: "",
    orderReference: "",
  });

  async function submit() {
    setError(null);
    if (!form.customerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/marketplace/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant: slug,
          author: form.customerName,
          rating: form.rating,
          comment: form.comment,
          orderReference: form.orderReference,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit review.");
        setSubmitting(false);
        return;
      }
      setForm({ customerName: "", rating: 5, comment: "", orderReference: "" });
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Reviews{" "}
          <span className="text-slate-400">({reviews.length})</span>
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          {open ? "Cancel" : "Write a review"}
        </button>
      </div>

      {open && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Name</label>
              <input
                value={form.customerName}
                onChange={(e) =>
                  setForm({ ...form, customerName: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">
                Rating
              </label>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setForm({ ...form, rating: n })}
                    className={`text-2xl leading-none ${
                      n <= form.rating ? "text-amber-400" : "text-slate-300"
                    }`}
                    aria-label={`${n} stars`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-slate-500">
              Order reference (optional — verifies your review)
            </label>
            <input
              value={form.orderReference}
              onChange={(e) =>
                setForm({ ...form, orderReference: e.target.value })
              }
              placeholder="MKT-…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-slate-500">Comment</label>
            <textarea
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </div>
          {error && (
            <p className="mt-2 text-xs text-rose-600">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-3 rounded-xl bg-orange-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit review"}
          </button>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {reviews.length === 0 && (
          <p className="text-sm text-slate-500">
            No reviews yet. Be the first to leave one!
          </p>
        )}
        {reviews.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium text-slate-900">
                {r.author}
                {r.verified && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    ✓ Verified order
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {shortDate(r.createdAt)}
              </span>
            </div>
            <div className="mt-1">
              <Stars rating={r.rating} />
            </div>
            {r.comment && (
              <p className="mt-2 text-sm text-slate-600">{r.comment}</p>
            )}
            {r.response && (
              <div className="mt-3 rounded-xl bg-orange-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-orange-700">
                  Response from the restaurant
                </p>
                <p className="mt-0.5 text-sm text-slate-700">{r.response}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
