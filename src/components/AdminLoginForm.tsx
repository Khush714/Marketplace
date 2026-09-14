"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Admin login — per-user operator authentication for /admin/*. */
export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
      } else {
        router.replace("/admin");
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-16 sm:px-6">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-ink-800 text-2xl shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-white/10">
          🛡️
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          Admin sign in
        </h1>
        <p className="mt-1 text-sm text-white/45">
          Restricted area — operator access only.
        </p>
      </div>

      <div className="card-lift mt-8 rounded-3xl border border-white/8 bg-ink-850 p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <label className="text-xs font-semibold uppercase tracking-wide text-white/45">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="username"
          autoFocus
          className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
        />
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-white/45">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="••••••••"
          autoComplete="current-password"
          className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
        />
        {error && (
          <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            {error}
          </p>
        )}
        <button
          onClick={submit}
          disabled={busy || !email || !password}
          className="mt-5 w-full rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </main>
  );
}