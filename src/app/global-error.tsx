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
      <body className="min-h-screen bg-ink-950 text-[#f5f3ef] antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/10 text-3xl">
            !
          </div>
          <h1 className="text-xl font-bold text-white">
            Application error
          </h1>
          <p className="max-w-sm text-sm text-white/45">
            A critical error occurred. Please reload the page.
          </p>
          <button
            onClick={reset}
            className="mt-2 rounded-2xl bg-ember-500 px-6 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
