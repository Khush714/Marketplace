"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  BadgeCheck,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Store,
  UserRoundCheck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/domain";
import { useToast } from "@/lib/toast";
import type { ConnectionCodeDto, ConnectionDto } from "@/lib/types";

/**
 * Marketplace operations console.
 *
 * Everything here is the privileged half of the platform surface: minting and
 * enumerating partner onboarding codes, listing live POS connections, and
 * driving the delivery / payment workers by hand. Each request carries the
 * operator's `x-ops-token` (see src/lib/ops-auth.ts), which is why this page is
 * separate from /partner — a restaurant never needs any of it.
 *
 * The token is deliberately held in component state and never written to
 * sessionStorage or localStorage: it is a bearer secret, and persisting it to
 * web storage would hand it to any injected script for the life of the tab.
 * Trade-off is re-pasting it on reload, which is the right trade for a secret.
 * It is only ever sent to same-origin Marketplace API paths.
 */

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Thrown for a non-2xx so callers can branch on the status. */
class OpsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default function OpsPage() {
  const { toast } = useToast();
  const [token, setToken] = useState("");

  const call = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: { "x-ops-token": token, ...(init?.headers ?? {}) },
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        throw new OpsError(
          res.status,
          res.status === 401
            ? "Ops token rejected"
            : res.status === 503
              ? "This deployment has no ops token configured"
              : (data?.error ?? `Request failed (${res.status})`),
        );
      }
      return data;
    },
    [token],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 md:px-6 md:pt-11">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">
        <ShieldAlert className="size-3.5" /> Marketplace operations
      </p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
        Ops console
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-cream-400">
        Privileged actions only. Every request is authenticated with the ops token; without it the
        server answers 401.
      </p>

      <TokenGate token={token} onSave={setToken} onTest={() => testToken(call, toast)} />
      <CodesPanel token={token} call={call} />
      <ConnectionsPanel token={token} call={call} />
      <WorkersPanel token={token} call={call} />

      <Link
        href="/partner"
        className="press mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-cream-400 transition-colors hover:text-cream-50"
      >
        ← Back to partner onboarding
      </Link>
    </div>
  );
}

function testToken(
  call: <T>(url: string, init?: RequestInit) => Promise<T>,
  toast: ReturnType<typeof useToast>["toast"],
) {
  void (async () => {
    try {
      await call<{ codes: unknown[] }>("/api/partner/codes");
      toast("Ops token accepted", { kind: "success" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not verify the token", { kind: "error" });
    }
  })();
}

/* ------------------------------- token gate ------------------------------- */

function TokenGate({
  token,
  onSave,
  onTest,
}: {
  token: string;
  onSave: (value: string) => void;
  onTest: () => void;
}) {
  return (
    <section className="glass mt-7 rounded-3xl p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
        <KeyRound className="size-4.5 text-ember-400" /> Ops token
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
        Must match <span className="font-mono text-cream-300">POS_DELIVERY_OPS_TOKEN</span> on the
        server. Held in memory for this page only — never stored in the browser.
      </p>
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <input
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onSave(e.target.value.trim())}
          placeholder="Paste ops token"
          aria-label="Ops token"
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={onTest}
          disabled={!token}
          className="press shrink-0 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
        >
          Verify
        </button>
      </div>
      {!token && (
        <p className="mt-2.5 text-xs text-cream-500">
          On a deployment with no token configured these endpoints are open in development and
          closed in production.
        </p>
      )}
    </section>
  );
}

/* --------------------------------- panels --------------------------------- */

type OpsCall = <T>(url: string, init?: RequestInit) => Promise<T>;

function CodesPanel({ token, call }: { token: string; call: OpsCall }) {
  const { toast } = useToast();
  const [codes, setCodes] = useState<ConnectionCodeDto[]>([]);
  const [last, setLast] = useState<ConnectionCodeDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await call<{ codes: ConnectionCodeDto[] }>("/api/partner/codes");
      setCodes(d.codes ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setCodes([]);
      setError(e instanceof Error ? e.message : "Could not load codes");
    }
  }, [call, token]);

  const mint = async () => {
    setBusy(true);
    try {
      const d = await call<{ code: ConnectionCodeDto }>("/api/partner/codes", { method: "POST" });
      setLast(d.code);
      setCopied(false);
      toast("Connection code minted");
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not mint a code", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last.code);
      setCopied(true);
    } catch {
      toast("Copy failed", { kind: "error" });
    }
  };

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
            <KeyRound className="size-4.5 text-mint-400" /> Onboarding codes
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
            A code is the single-use capability that lets a restaurant claim its listing.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={!token || busy}
            className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            Load
          </button>
          <button
            type="button"
            onClick={mint}
            disabled={!token || busy}
            className="press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-mint-400 to-mint-600 px-4 py-2 text-sm font-bold text-emerald-950 transition-opacity disabled:opacity-60"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Mint
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-chili-500/30 bg-chili-600/10 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      {last && (
        <div className="mt-4 rounded-2xl border border-mint-400/25 bg-mint-500/10 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mint-400">Latest code</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="font-display text-3xl font-bold tracking-tight text-cream-50 tabular-nums">
              {last.code}
            </span>
            <button
              type="button"
              onClick={copy}
              className={cn(
                "press flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                copied ? "bg-mint-500/20 text-mint-300" : "bg-white/8 text-cream-200 hover:bg-white/12",
              )}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {last.expiresAt && (
            <p className="mt-1.5 text-xs text-cream-500">Valid through {formatWhen(last.expiresAt)}</p>
          )}
        </div>
      )}

      {token && !error && loaded && (
        <div className="mt-5">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-cream-500">History</p>
          {codes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-xs text-cream-500">
              Nothing minted yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {codes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.045] px-3.5 py-2.5"
                >
                  <span className="font-mono text-sm font-bold text-cream-100 tabular-nums">{c.code}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {c.status === "used" ? (
                      <>
                        <span className="max-w-[9rem] truncate text-xs text-cream-400">{c.restaurantName}</span>
                        <span className="flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-bold text-mint-400">
                          <UserRoundCheck className="size-3" /> Used
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-cream-300">
                        <BadgeCheck className="size-3" /> Unused
                      </span>
                    )}
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-cream-600 sm:block">
                    {formatWhen(c.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ConnectionsPanel({ token, call }: { token: string; call: OpsCall }) {
  const [rows, setRows] = useState<ConnectionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const d = await call<{ connections: ConnectionDto[] }>("/api/partner/connect");
      setRows(d.connections ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Could not load connections");
    } finally {
      setBusy(false);
    }
  }, [call, token]);

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
            <Store className="size-4.5 text-ember-400" /> Live connections
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
            Restaurants bound to a Marketplace external id.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!token || busy}
          className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Load
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-chili-500/30 bg-chili-600/10 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      {token && !error && loaded && (
        <div className="mt-4">
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-xs text-cream-500">
              No POS connections yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/[0.045] px-3.5 py-2.5"
                >
                  <span className="text-sm font-semibold text-cream-100">{c.restaurantName}</span>
                  <span className="font-mono text-[11px] text-cream-500">{c.marketplace}</span>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                      c.status === "active"
                        ? "bg-mint-500/12 text-mint-400"
                        : "bg-white/8 text-cream-300",
                    )}
                  >
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface PosDrainSummary {
  processed: number;
  delivered: number;
  retryScheduled: number;
  terminalFailed: number;
  skipped: number;
  errored: number;
}

function WorkersPanel({ token, call }: { token: string; call: OpsCall }) {
  const { toast } = useToast();
  const [pos, setPos] = useState<PosDrainSummary | null>(null);
  const [payments, setPayments] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pos" | "payments" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const drainPos = async () => {
    setBusy("pos");
    setError(null);
    try {
      const d = await call<PosDrainSummary & { ok: boolean }>("/api/integrations/pos/drain", {
        method: "POST",
      });
      setPos(d);
      toast("POS delivery drain finished", { sub: `${d.delivered} delivered` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drain failed");
    } finally {
      setBusy(null);
    }
  };

  const runPayments = async () => {
    setBusy("payments");
    setError(null);
    try {
      const d = await call<{ ok: boolean; drain: unknown; reconcile: unknown }>(
        "/api/integrations/payments/ops",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      setPayments(JSON.stringify(d, null, 2));
      toast("Payment pipeline processed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment ops failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
        <Play className="size-4.5 text-ember-400" /> Workers
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
        The delivery and payment pipelines retry on their own schedule. These run one pass now.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-chili-500/30 bg-chili-600/10 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={drainPos}
          disabled={!token || busy !== null}
          className="press flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow disabled:opacity-50"
        >
          {busy === "pos" ? <LoaderCircle className="size-4 animate-spin" /> : <Store className="size-4" />}
          Drain POS deliveries
        </button>
        <button
          type="button"
          onClick={runPayments}
          disabled={!token || busy !== null}
          className="press flex items-center justify-center gap-2 rounded-2xl bg-white/8 py-3 text-sm font-bold text-cream-50 transition-colors hover:bg-white/12 disabled:opacity-50"
        >
          {busy === "payments" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Wallet className="size-4" />
          )}
          Reconcile payments
        </button>
      </div>

      {pos && (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {(
            [
              ["processed", pos.processed],
              ["delivered", pos.delivered],
              ["retry", pos.retryScheduled],
              ["terminal", pos.terminalFailed],
              ["skipped", pos.skipped],
              ["errored", pos.errored],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/[0.045] px-3 py-2">
              <dt className="text-cream-500">{label}</dt>
              <dd className="font-bold text-cream-50 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {payments && (
        <pre className="mt-4 max-h-64 overflow-auto rounded-2xl bg-black/40 p-3.5 text-[11px] leading-relaxed text-cream-300">
          {payments}
        </pre>
      )}
    </section>
  );
}
