"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-red-50 text-3xl">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            Application error
          </h1>
          <p className="max-w-sm text-sm text-slate-500">
            A critical error occurred. Please reload the page.
          </p>
          <button
            onClick={reset}
            className="mt-2 rounded-full bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 active:scale-95"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
