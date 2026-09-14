"use client";

import { useEffect, useState } from "react";
import { shortDate } from "@/lib/format";
import { Stars } from "../Stars";

type ModReview = {
  id: number;
  restaurant: { id: number; name: string; slug: string };
  author: string;
  rating: number;
  comment: string;
  verified: boolean;
  moderationStatus: "published" | "pending" | "hidden";
  response: string;
  hasOrder: boolean;
  createdAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-400",
  pending: "bg-amber-500/10 text-amber-400",
  hidden: "bg-white/5 text-white/45",
};

export function ReviewModeration() {
  const [reviews, setReviews] = useState<ModReview[]>([]);
  const [stats, setStats] = useState({ total: 0, published: 0, pending: 0, hidden: 0 });
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/admin/reviews");
    const data = await res.json();
    setReviews(data.reviews ?? []);
    setStats(data.stats ?? { total: 0, published: 0, pending: 0, hidden: 0 });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function update(id: number, patch: { moderationStatus?: string; response?: string }) {
    const res = await fetch(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) load();
  }

  const visible = filter === "all" ? reviews : reviews.filter((r) => r.moderationStatus === filter);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={stats.total} />
        <Stat label="Published" value={stats.published} tone="emerald" />
        <Stat label="Pending" value={stats.pending} tone="amber" />
        <Stat label="Hidden" value={stats.hidden} />
      </div>

      <div className="mt-5 flex gap-1 rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
        {["all", "Published", "pending", "hidden"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f === "Published" ? "published" : f)}
            className={`flex-1 truncate rounded-full px-3 py-1.5 font-semibold capitalize transition-colors ${
              filter === (f === "Published" ? "published" : f)
                ? "bg-ink-800 text-white"
                : "text-white/45 hover:text-white/65"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {loading && <div className="h-32 animate-pulse rounded-2xl bg-white/5" />}
        {!loading && visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/10 bg-ink-850 p-8 text-center text-sm text-white/45">
            No reviews in this state.
          </p>
        )}
        {visible.map((r) => (
          <article key={r.id} className="rounded-2xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{r.restaurant.name}</p>
                <p className="text-xs text-white/45">{shortDate(r.createdAt)}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[r.moderationStatus]}`}
              >
                {r.moderationStatus}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <Stars rating={r.rating} />
              <span className="font-medium text-white/70">{r.author}</span>
              {r.verified && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                  ✓ Verified purchase
                </span>
              )}
              {!r.hasOrder && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/45">
                  guest
                </span>
              )}
            </div>

            {r.comment && (
              <p className="mt-2 text-sm text-white/60">{r.comment}</p>
            )}

            {r.response && (
              <div className="mt-2 rounded-lg bg-ember-500/10 px-3 py-2 text-sm">
                <p className="text-xs font-semibold text-ember-400">
                  Restaurant response
                </p>
                <p className="mt-0.5 text-white/70">{r.response}</p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/6 pt-3">
              <button
                onClick={() => update(r.id, { moderationStatus: "published" })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  r.moderationStatus === "published"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                Publish
              </button>
              <button
                onClick={() => update(r.id, { moderationStatus: "pending" })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  r.moderationStatus === "pending"
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                Hold
              </button>
              <button
                onClick={() => update(r.id, { moderationStatus: "hidden" })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  r.moderationStatus === "hidden"
                    ? "border-white/15 bg-white/10 text-white/80"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                Hide
              </button>
              <ResponseInput
                current={r.response}
                onSave={(response) => update(r.id, { response })}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "amber"
        ? "text-amber-400"
        : "text-white";
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-850 p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-white/40">{label}</div>
    </div>
  );
}

function ResponseInput({ current, onSave }: { current: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ml-auto rounded-lg border border-ember-500/25 bg-ember-500/10 px-3 py-1.5 text-xs font-semibold text-ember-400 hover:bg-ember-500/20"
      >
        {current ? "Edit response" : "Respond"}
      </button>
    );
  }
  return (
    <div className="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Restaurant reply…"
        className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50"
      />
      <button
        onClick={() => {
          onSave(value);
          setOpen(false);
        }}
        className="rounded-lg bg-ember-500 px-3 py-1.5 text-xs font-semibold text-ink-950"
      >
        Save
      </button>
    </div>
  );
}
