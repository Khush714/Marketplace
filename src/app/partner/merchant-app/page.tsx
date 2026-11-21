"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Copy, Link2, RefreshCw, Unplug } from "lucide-react";
import { partnerFetch, RequirePartnerSession, usePartnerSession } from "@/lib/partner-session";
import { cn } from "@/lib/domain";

type LinkState = { linked: boolean; connectedAt: string | null; lastUsedAt: string | null };

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await partnerFetch<T>(url, init);
  if (!response.ok) throw new Error(response.error || "Request failed");
  return response as T;
}

export default function PartnerMerchantAppPage() {
  const session = usePartnerSession();
  const [state, setState] = useState<LinkState>({ linked: false, connectedAt: null, lastUsedAt: null });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await call<LinkState>("/api/partner/merchant-link");
      setState(next);
      if (next.linked) { setCode(null); setExpiresAt(null); }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load connection status."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // The initial load is the external-system sync this effect exists for; the
    // loading flag is set by the async fetch it starts, not by render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session.status === "signed-in") void load();
  }, [session.status, load]);

  useEffect(() => {
    if (!code || state.linked) return;
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [code, state.linked, load]);

  async function generate() {
    setBusy(true); setError(""); setMessage(""); setCode(null); setExpiresAt(null);
    try {
      const result = await call<{ code: string; expiresAt: string; ttlSeconds: number }>("/api/partner/merchant-link", { method: "POST", body: JSON.stringify({}) });
      setCode(result.code); setExpiresAt(result.expiresAt); setMessage("Pairing code created. It can be used once and expires in 10 minutes.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create pairing code."); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setMessage("Pairing code copied. Paste it into Savour Merchant."); }
    catch { setError("Clipboard access failed. Select and copy the code manually."); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect the Merchant App? This revokes its access to this listing.")) return;
    setBusy(true); setError(""); setMessage("");
    try { await call<{ linked: false }>("/api/partner/merchant-link", { method: "DELETE", body: JSON.stringify({}) }); setState({ linked: false, connectedAt: null, lastUsedAt: null }); setCode(null); setExpiresAt(null); setMessage("Merchant App disconnected. Existing orders are preserved."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect the Merchant App."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-4xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400"><Link2 className="size-3.5" /> Savour partner tools</p><h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Merchant App connection</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-cream-400">Connect this Marketplace listing to Savour Merchant so menu changes, incoming orders, and order status updates use the same Marketplace records.</p></div>
      <Link href="/partner" className="press rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12">Back to partner tools</Link>
    </div>
    <RequirePartnerSession>
      <section className="glass mt-7 rounded-3xl p-5 md:p-7">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-mint-500/12 text-mint-400"><Link2 className="size-5" /></span><div><h2 className="font-display text-lg font-bold text-cream-50">Connection status</h2><p className="mt-0.5 text-xs text-cream-500">Only a one-time pairing code is shared with the Merchant App.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="press ml-auto inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-cream-200 hover:bg-white/12 disabled:opacity-50"><RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh</button></div>
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          {loading ? <p className="text-sm text-cream-400">Checking connection…</p> : state.linked ? <><p className="flex items-center gap-2 text-sm font-bold text-mint-400"><BadgeCheck className="size-4" /> Merchant App connected</p><p className="mt-2 text-xs leading-relaxed text-cream-400">Connected {state.connectedAt ? new Date(state.connectedAt).toLocaleString("en-IN") : ""}. {state.lastUsedAt ? `Last API activity: ${new Date(state.lastUsedAt).toLocaleString("en-IN")}.` : "Waiting for first Merchant App request."}</p><button type="button" onClick={() => void disconnect()} disabled={busy} className="press mt-4 inline-flex items-center gap-2 rounded-xl border border-chili-500/25 bg-chili-500/8 px-4 py-2.5 text-xs font-semibold text-chili-300 hover:bg-chili-500/12 disabled:opacity-50"><Unplug className="size-3.5" /> {busy ? "Disconnecting…" : "Disconnect Merchant App"}</button></> : <><p className="text-sm font-bold text-cream-100">Not connected yet</p><p className="mt-1.5 text-xs leading-relaxed text-cream-400">Generate a temporary code, then enter it in <strong className="text-cream-200">Savour Merchant → Business settings → Marketplace connection</strong>. The code is single-use and expires after 10 minutes.</p><button type="button" onClick={() => void generate()} disabled={busy} className="press mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-xs font-bold text-white shadow-glow disabled:opacity-50"><Link2 className="size-3.5" /> {busy ? "Generating…" : "Generate pairing code"}</button></>}
        </div>
        {code && <div className="mt-4 rounded-2xl border border-ember-400/25 bg-ember-500/8 p-4"><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ember-400">One-time pairing code</p><div className="mt-2 flex flex-wrap items-center gap-3"><code className="min-w-0 flex-1 break-all font-mono text-sm font-bold text-cream-50">{code}</code><button type="button" onClick={() => void copyCode()} className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-cream-200 hover:bg-white/12"><Copy className="size-3.5" /> Copy</button></div><p className="mt-2 text-xs text-cream-500">Expires {expiresAt ? new Date(expiresAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "in 10 minutes"}. Generate a new code if it expires or is consumed.</p></div>}
        {message && <p role="status" className="mt-4 text-xs text-mint-400">{message}</p>}{error && <p role="alert" className="mt-4 text-xs text-chili-300">{error}</p>}
      </section>
      <section className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4"><h3 className="text-sm font-bold text-cream-100">What this connection does</h3><ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-cream-400"><li>Marketplace remains the source of truth for the public listing, published menu, customer orders, and payment state.</li><li>Savour Merchant receives the same order records and sends accept/reject/preparation updates back to the Marketplace.</li><li>Disconnecting revokes Merchant App API access; it does not delete existing orders or customer history.</li><li>This connection is separate from the Restaurant POS integration.</li></ul></section>
    </RequirePartnerSession>
  </div>;
}
