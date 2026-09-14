"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

/** PHASE 10 — Email OTP + guest browsing. */
export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("return") || "/profile";

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not send code");
      } else {
        setStep("code");
        setDevCode(data.devCode ?? null);
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
      } else {
        router.replace(returnTo);
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-10 sm:px-6">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-ember-500 text-2xl font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.35)]">
          T
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          Sign in to TABLZ
        </h1>
        <p className="mt-1 text-sm text-white/45">
          Email OTP · guest browsing stays available.
        </p>
      </div>

      <div className="card-lift mt-8 rounded-3xl border border-white/8 bg-ink-850 p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        {step === "email" ? (
          <>
            <label className="text-xs font-semibold uppercase tracking-wide text-white/45">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. you@example.com"
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
            />
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-white/45">
              Name (optional, for new accounts)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
            />
            {error && (
              <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                {error}
              </p>
            )}
            <button
              onClick={request}
              disabled={busy || !email.trim()}
              className="mt-5 w-full rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-white/55">
              We sent a 6-digit code to <strong className="text-white">{email}</strong>.
            </p>
            {devCode && (
              <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                Development mode: your code is <code className="font-bold">{devCode}</code>.
                In production the SMTP gateway delivers this privately — the
                endpoint hides it.
              </p>
            )}
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/45">
              Code
            </label>
            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center text-xl font-bold tracking-[0.5em] text-white outline-none transition-colors placeholder:text-white/30 focus:border-ember-500/50 focus:bg-white/8"
            />
            {error && (
              <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                {error}
              </p>
            )}
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="mt-5 w-full rounded-2xl bg-ember-500 py-3 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              onClick={() => {
                setStep("email");
                setCode("");
                setDevCode(null);
              }}
              className="mt-2 w-full text-xs font-medium text-white/40 transition-colors hover:text-white/70"
            >
              Use a different email
            </button>
          </>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-white/40">
        <Link href={returnTo} className="transition-colors hover:text-ember-400 hover:underline">
          Continue as guest →
        </Link>
      </p>
    </main>
  );
}