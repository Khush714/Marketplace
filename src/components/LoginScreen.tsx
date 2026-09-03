"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

/** PHASE 10 — Phone OTP + guest browsing. */
export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("return") || "/profile";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
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
        body: JSON.stringify({ phone }),
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
        body: JSON.stringify({ phone, code, name }),
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
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-orange-500 text-2xl text-white shadow-lg">
          🍽️
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          Sign in to TABLZ
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Phone OTP · guest browsing stays available.
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {step === "phone" ? (
          <>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Phone
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +1 555 123 4567"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Name (optional, for new accounts)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            {error && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </p>
            )}
            <button
              onClick={request}
              disabled={busy || !phone.trim()}
              className="mt-5 w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              We sent a 6-digit code to <strong>{phone}</strong>.
            </p>
            {devCode && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Development mode: your code is <code className="font-bold">{devCode}</code>.
                In production the SMS gateway (Twilio/etc.) delivers this
                privately — the endpoint hides it.
              </p>
            )}
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
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
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-center text-xl font-bold tracking-[0.5em] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            {error && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </p>
            )}
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="mt-5 w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              onClick={() => {
                setStep("phone");
                setCode("");
                setDevCode(null);
              }}
              className="mt-2 w-full text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Use a different number
            </button>
          </>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        <Link href={returnTo} className="hover:underline">
          Continue as guest →
        </Link>
      </p>
    </main>
  );
}
