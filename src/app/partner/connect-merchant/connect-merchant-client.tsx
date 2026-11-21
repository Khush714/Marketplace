"use client";

import { useState } from "react";
import { CheckCircle2, Store } from "lucide-react";
import { partnerFetch, SignInGate, usePartnerSession } from "@/lib/partner-session";

export default function ConnectMerchantClient({
  state,
  codeChallenge,
}: {
  state: string;
  codeChallenge: string;
}) {
  const session = usePartnerSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setBusy(true);
    setError("");
    const result = await partnerFetch<{ redirectUrl: string }>("/api/partner/merchant-authorization", {
      method: "POST",
      body: JSON.stringify({ state, codeChallenge }),
    });
    setBusy(false);
    if (!result.ok || !result.redirectUrl) {
      setError(result.ok ? "Could not start the connection. Please try again." : result.error);
      return;
    }
    window.location.assign(result.redirectUrl);
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return <section className="glass mx-auto mt-8 max-w-xl rounded-3xl p-6">
      <h1 className="font-display text-xl font-bold text-cream-50">This connection link is invalid</h1>
      <p className="mt-2 text-sm text-cream-400">Go back to Merchant and start the connection again.</p>
    </section>;
  }

  if (session.status === "loading") {
    return <section className="glass mx-auto mt-8 max-w-xl rounded-3xl p-6 text-sm text-cream-400">Checking your Marketplace session…</section>;
  }

  if (session.status === "signed-out") {
    return <div className="mx-auto max-w-xl">
      <h1 className="font-display text-2xl font-bold text-cream-50">Connect Marketplace to Merchant</h1>
      <SignInGate
        title="Sign in to approve"
        subtitle="Sign in to the Marketplace restaurant you want to connect. You’ll review the restaurant before sharing access with Merchant."
      />
    </div>;
  }

  return <section className="glass mx-auto mt-8 max-w-xl rounded-3xl p-6 md:p-8">
    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-mint-300">
      <Store className="size-4" /> Merchant connection request
    </p>
    <h1 className="mt-3 font-display text-2xl font-bold text-cream-50">Connect {session.restaurant.name}?</h1>
    <p className="mt-2 text-sm leading-relaxed text-cream-400">
      Merchant will be able to view this restaurant’s Marketplace menu and orders. Marketplace and your connected POS remain in control of fulfilment and order status.
    </p>
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-mint-300" />
      <div>
        <strong className="text-sm text-cream-100">{session.restaurant.name}</strong>
        <p className="mt-1 text-xs text-cream-500">This approval is one-time and can be revoked by disconnecting Merchant.</p>
      </div>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    <button
      type="button"
      disabled={busy}
      onClick={() => void approve()}
      className="press mt-5 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-mint-400 to-mint-300 px-4 py-3 text-sm font-bold text-ink-950 disabled:opacity-60"
    >
      {busy ? "Connecting…" : `Approve and connect ${session.restaurant.name}`}
    </button>
  </section>;
}
