"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/10 text-3xl">
        !
      </div>
      <h1 className="text-xl font-bold text-white">
        Something went wrong
      </h1>
      <p className="max-w-sm text-sm text-white/45">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-2 rounded-2xl bg-ember-500 px-6 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
      >
        Try again
      </button>
    </div>
  );
}
