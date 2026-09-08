"use client";

import { useState } from "react";

/**
 * Customer-initiated cancellation presentation. The decision (is it allowed?)
 * lives server-side and surfaces through `order.lifecycle.status`; the request
 * itself is owned by useOrderTracking.cancelOrder (POST → refetch), so this
 * component only asks for confirmation and renders the result states.
 *
 * Phase 19 — the frontend never decides that cancellation is valid: it shows
 * the action inside the customer window (`status === placed`) and the backend
 * authoritatively accepts or rejects the POST.
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
      // Server rejected (e.g. restaurant already accepted) — keep the dialog
      // open so `error` is visible and the customer can still Keep Order.
    }
  };

  return (
    <div className="mt-4">
      {error && (
        <p className="mb-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
          <p className="text-sm font-semibold text-slate-900">Are you sure?</p>
          <p className="mt-1 text-sm text-slate-600">
            If the restaurant accepts first, the order can no longer be
            cancelled from here.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Keep Order
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy}
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {busy ? "Cancelling…" : "Cancel Order"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-600">
            Changed your mind? You can cancel while the restaurant is still
            deciding.
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="mt-3 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
          >
            Cancel Order
          </button>
        </div>
      )}
    </div>
  );
}