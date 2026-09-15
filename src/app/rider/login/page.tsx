"use client";

import type { Metadata } from "next";
import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";

export default function RiderLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Enter a delivery token");
      return;
    }
    router.push(`/rider/${encodeURIComponent(trimmed)}`);
  };

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-3xl border border-white/8 bg-ink-850 p-8 shadow-lg"
      >
        <h1 className="text-2xl font-bold text-cream">Rider login</h1>
        <p className="mt-2 text-sm text-cream/60">
          Paste the token you received from the dispatcher.
        </p>

        <label className="mt-6 block">
          <span className="text-xs font-medium uppercase tracking-wide text-cream/50">
            Delivery token
          </span>
          <input
            type="text"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            placeholder="e.g. a1b2c3d4e5f6.1l9k8j"
            autoFocus
            autoComplete="off"
            className="mt-1 w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-cream placeholder:text-cream/30 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>

        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}

        <button
          type="submit"
          className="mt-4 w-full rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
        >
          Open job
        </button>
      </form>
    </main>
  );
}