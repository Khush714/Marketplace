"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronDown, Star } from "lucide-react";
import { cn } from "@/lib/domain";
import { isLocalMediaUrl } from "@/lib/media-core";
import type { PublicReviewDto, PublicReviewPage } from "@/lib/public-review-core";

type ReviewsState =
  | { kind: "loading" }
  | { kind: "ready"; reviews: PublicReviewDto[]; nextCursor: string | null }
  | { kind: "error"; message: string };

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return DATE_FORMAT.format(date);
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "size-3.5",
            star <= rating ? "fill-current text-gold-400" : "text-cream-600",
          )}
        />
      ))}
    </span>
  );
}

export function PublicReviews({ slug }: { slug: string }) {
  const [state, setState] = useState<ReviewsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      try {
        const response = await fetch(`/api/restaurants/${encodeURIComponent(slug)}/reviews`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as PublicReviewPage | null;
        if (!response.ok || !data || !Array.isArray(data.reviews)) throw new Error("Reviews unavailable");
        setState({ kind: "ready", reviews: data.reviews, nextCursor: data.nextCursor });
      } catch {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: "Reviews could not be loaded right now." });
      }
    }

    void loadInitial();
    return () => controller.abort();
  }, [slug, attempt]);

  async function loadMore() {
    if (state.kind !== "ready" || !state.nextCursor || loadingMore) return;
    const cursor = state.nextCursor;
    setLoadingMore(true);
    setMoreError("");

    try {
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(slug)}/reviews?cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as PublicReviewPage | null;
      if (!response.ok || !data || !Array.isArray(data.reviews)) throw new Error("Reviews unavailable");
      setState((current) => current.kind === "ready"
        ? {
          kind: "ready",
          reviews: [...current.reviews, ...data.reviews],
          nextCursor: data.nextCursor,
        }
        : current);
    } catch {
      setMoreError("Could not load more reviews. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="mt-6 rounded-[26px] border border-white/8 bg-white/[0.03] p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
            Diner feedback
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-cream-50">
            Reviews from this kitchen
          </h2>
        </div>
        <span className="rounded-full bg-white/6 px-3 py-1 text-[11px] font-semibold text-cream-400">
          From order feedback
        </span>
      </div>

      {state.kind === "loading" && (
        <div className="grid gap-3 pt-5 sm:grid-cols-2" aria-busy="true">
          {[0, 1].map((slot) => (
            <div key={slot} className="h-28 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div className="pt-5">
          <p className="text-sm text-cream-400">{state.message}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="press mt-3 rounded-xl border border-white/12 px-3.5 py-2 text-xs font-bold text-cream-200 hover:bg-white/6"
          >
            Try again
          </button>
        </div>
      )}

      {state.kind === "ready" && state.reviews.length === 0 && (
        <p className="pt-5 text-sm text-cream-500">
          No reviews yet. Be the first to share what you thought after your order.
        </p>
      )}

      {state.kind === "ready" && state.reviews.length > 0 && (
        <div className="grid gap-3 pt-5 sm:grid-cols-2">
          {state.reviews.map((review, index) => (
            <article
              key={`${review.feedbackAt}-${index}`}
              className="rounded-2xl border border-white/8 bg-void/25 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars rating={review.rating} />
                {formatReviewDate(review.feedbackAt) && (
                  <time className="text-[11px] text-cream-500" dateTime={review.feedbackAt}>
                    {formatReviewDate(review.feedbackAt)}
                  </time>
                )}
              </div>
              <p className={cn(
                "mt-3 text-sm leading-relaxed",
                review.review ? "text-cream-200" : "italic text-cream-500",
              )}>
                {review.review || "Rated without a written comment."}
              </p>
              {review.photoUrls?.filter(isLocalMediaUrl).slice(0, 3).length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {review.photoUrls.filter(isLocalMediaUrl).slice(0, 3).map((url) => (
                    <span key={url} className="relative size-16 overflow-hidden rounded-xl border border-white/10 bg-white/6">
                      <Image src={url} alt="Review photo" fill sizes="64px" unoptimized className="object-cover" />
                    </span>
                  ))}
                </div>
              ) : null}
              {review.merchantResponse && (
                <div className="mt-3 rounded-xl border border-ember-400/15 bg-ember-500/[0.06] px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ember-300">
                    Kitchen response
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-cream-300">
                    {review.merchantResponse}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {state.kind === "ready" && state.nextCursor && (
        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-white/12 px-4 py-2 text-xs font-bold text-cream-200 hover:bg-white/6 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Show more reviews"}
            <ChevronDown className="size-3.5" />
          </button>
          {moreError && <p className="text-[11px] text-chili-300">{moreError}</p>}
        </div>
      )}
    </section>
  );
}
