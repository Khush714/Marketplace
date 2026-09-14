"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicReview } from "@/lib/marketplace";
import { Stars } from "./Stars";
import { shortDate } from "@/lib/format";
import { ArrowRightIcon } from "./ui/icons";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Reviews{" "}
          <span className="text-white/35">({reviews.length})</span>
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
        >
          {open ? "Cancel" : "Write a review"}
        </button>
      </div>

      {open && (
        <div className="card-lift mt-4 rounded-3xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-white/45">Name</label>
              <input
                value={form.customerName}
                onChange={(e) =>
                  setForm({ ...form, customerName: e.target.value })
                }
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/45">
                Rating
              </label>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setForm({ ...form, rating: n })}
                    className={`text-2xl leading-none transition-colors ${
                      n <= form.rating ? "text-ember-400" : "text-white/15 hover:text-white/30"
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
            <label className="text-xs font-medium text-white/45">
              Order reference (optional — verifies your review)
            </label>
            <input
              value={form.orderReference}
              onChange={(e) =>
                setForm({ ...form, orderReference: e.target.value })
              }
              placeholder="MKT-…"
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
            />
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-white/45">Comment</label>
            <textarea
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
            />
          </div>
          {error && (
            <p className="mt-2 text-xs text-rose-400">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-ember-500 px-6 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60 sm:w-auto"
          >
            {submitting ? "Submitting…" : "Submit review"} <ArrowRightIcon className="text-base" />
          </button>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {reviews.length === 0 && (
          <p className="text-sm text-white/45">
            No reviews yet. Be the first to leave one!
          </p>
        )}
        {reviews.map((r) => (
          <div
            key={r.id}
            className="card-lift rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium text-white">
                {r.author}
                {r.verified && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                    ✓ Verified order
                  </span>
                )}
              </span>
              <span className="text-xs text-white/35">
                {shortDate(r.createdAt)}
              </span>
            </div>
            <div className="mt-1">
              <Stars rating={r.rating} />
            </div>
            {r.comment && (
              <p className="mt-2 break-words text-sm text-white/60">{r.comment}</p>
            )}
            {r.response && (
              <div className="mt-3 rounded-2xl border border-ember-500/15 bg-ember-500/10 px-3 py-2.5">
                <p className="text-xs font-semibold text-ember-400">
                  Response from the restaurant
                </p>
                <p className="mt-0.5 break-words text-sm text-white/70">{r.response}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}