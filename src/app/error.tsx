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
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-red-50 text-3xl">
        !
      </div>
      <h1 className="text-xl font-bold text-slate-900">
        Something went wrong
      </h1>
      <p className="max-w-sm text-sm text-slate-500">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-2 rounded-full bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 active:scale-95"
      >
        Try again
      </button>
    </div>
  );
}
