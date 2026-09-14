"use client";

import { useState } from "react";

/**
 * Customer-initiated cancellation presentation. The decision (is it allowed?)
 * lives server-side and surfaces through `order.lifecycle.status`; the request
 * itself is owned by useOrderTracking.cancelOrder (POST → refetch), so this
 * component only asks for confirmation and renders the result states.
 *
 * Phase 19 — the frontend never decides that cancellation is valid: it shows
 * the action inside the customer window (`status === accepted`, the Phase 9
 * ACCEPTED → CANCELLED edge) and the backend authoritatively accepts or
 * rejects the POST.
 */
export function OrderCancelButton({
  busy,
  error,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    try {
      await onCancel();
      // Success only: the re-fetch in the hook flips the order to cancelled
      // and the parent unmounts this button. A rejected POST rejects here.
      setConfirming(false);
    } catch {
      // Server rejected (e.g. kitchen already preparing) — keep the dialog
      // open so `error` is visible and the customer can still Keep Order.
    }
  };

  return (
    <div className="mt-4">
      {error && (
        <p className="mb-2 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="card-lift rounded-3xl border border-rose-500/20 bg-rose-500/10 p-4">
          <p className="text-sm font-semibold text-white">Are you sure?</p>
          <p className="mt-1 text-sm text-white/55">
            Once the kitchen starts preparing, the order can no longer be
            cancelled.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 disabled:opacity-60 sm:w-auto"
            >
              Keep Order
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy}
              className="w-full rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-rose-400 disabled:opacity-60 sm:w-auto"
            >
              {busy ? "Cancelling…" : "Cancel Order"}
            </button>
          </div>
        </div>
      ) : (
        <div className="card-lift rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <p className="text-sm text-white/55">
            Changed your mind? You can cancel while the restaurant is
            accepting but hasn&apos;t started preparing yet.
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="mt-3 w-full rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-400 transition-colors hover:bg-rose-500/20 disabled:opacity-60 sm:w-auto"
          >
            Cancel Order
          </button>
        </div>
      )}
    </div>
  );
}