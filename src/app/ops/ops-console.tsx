"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BadgeCheck,
  Ban,
  Check,
  Clock,
  Copy,
  Flame,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Store,
  UserRoundCheck,
  Wallet,
  X,
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

/**
 * `open` arrives as a prop from the server-rendered page, which calls
 * `opsTokenOptional()` directly. It is deliberately NOT fetched from the
 * browser: a client-side probe for this makes the whole console's
 * usability depend on a round-trip, and a cold route in dev can stall that
 * request for several seconds with every action button disabled — which is
 * the exact dead-button experience this page is meant to avoid.
 */
export default function OpsConsole({ open }: { open: boolean }) {
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

  /**
   * Mirrors `requireOpsToken`: a pasted token always works, and on a deployment
   * with no token configured the server accepts the caller anyway, so the
   * console must not sit there refusing to try.
   */
  const canAct = token.trim().length > 0 || open;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 md:px-6 md:pt-11">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">
        <ShieldAlert className="size-3.5" /> Marketplace operations
      </p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
        Ops console
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-cream-400">
        Privileged actions only. A deployment with{" "}
        <span className="font-mono text-cream-300">POS_DELIVERY_OPS_TOKEN</span> set requires it
        on every request; one without it accepts them, which the banner below spells out.
      </p>

      <TokenGate
        token={token}
        open={open}
        onSave={setToken}
        onTest={() => testToken(call, toast, open)}
      />
        <PosBridgePanel token={token} call={call} />
        <CodesPanel token={token} canAct={canAct} call={call} />
        <ProvisionPanel canAct={canAct} call={call} />
        <ConnectionsPanel token={token} canAct={canAct} call={call} />
        <TransferPanel canAct={canAct} call={call} />
      <WorkersPanel token={token} canAct={canAct} call={call} />

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
  open: boolean,
) {
  void (async () => {
    try {
      await call<{ codes: unknown[] }>("/api/partner/codes");
      // With no token configured there is nothing to verify, so say that
      // instead of implying a pasted secret just passed a check.
      if (open) toast("No ops token required on this deployment", { kind: "success" });
      else toast("Ops token accepted", { kind: "success" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not verify the token", { kind: "error" });
    }
  })();
}

/* ------------------------------- token gate ------------------------------- */

function TokenGate({
  token,
  open,
  onSave,
  onTest,
}: {
  token: string;
  open: boolean;
  onSave: (value: string) => void;
  onTest: () => void;
}) {
  // A pasted token is verifiable, and on an open deployment the call succeeds
  // too (it just verifies nothing).
  const canActVerify = token.trim().length > 0 || open;

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
          disabled={!canActVerify}
          className="press shrink-0 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
        >
          Verify
        </button>
      </div>
      {open === true && (
        <p className="mt-2.5 rounded-xl border border-ember-500/25 bg-ember-500/8 px-3.5 py-2.5 text-xs leading-relaxed text-ember-200">
          <span className="font-bold">No ops token on this deployment.</span> POS_DELIVERY_OPS_TOKEN
          is unset and this is not a production build, so the server accepts privileged calls from
          anyone who can reach it. Leave the field empty — the buttons below work as-is. Set the
          variable before deploying anywhere reachable.
        </p>
      )}
      {!open && !token && (
        <p className="mt-2.5 rounded-xl border border-ember-500/25 bg-ember-500/8 px-3.5 py-2.5 text-xs leading-relaxed text-ember-200">
          <span className="font-bold">Paste the ops token to enable actions.</span> It must match{" "}
          <span className="font-mono">POS_DELIVERY_OPS_TOKEN</span> on the server. Without it this
          deployment answers 503 for every privileged route — nobody, including a restaurant, can
          mint an onboarding code.
        </p>
      )}
    </section>
  );
}

/* --------------------------------- panels --------------------------------- */

type OpsCall = <T>(url: string, init?: RequestInit) => Promise<T>;

interface ListingSetupDto {
  id: number;
  name: string;
  slug: string;
  externalId: string | null;
  hasOwnerKey: boolean;
  posLinked: boolean;
  posRestaurantId: string | null;
  recordStatus: string | null;
  needsSetup: boolean;
  featured: boolean;
  isActive: boolean;
}

/**
 * Provisioning for listings that cannot complete the POS handshake.
 *
 * A listing needs both an owner key and an external id before
 * /partner/integrations can connect it. Listings seeded straight into the
 * database have neither, and the /partner redemption that normally issues a key
 * cannot fix them because it needs an external id to create the listing at all.
 * That left them stranded with no route back except hand-editing the database.
 *
 * The key is displayed once and never re-fetchable, so the panel shows it inline
 * for the operator to copy rather than pretending it can be looked up later.
 */
function ProvisionPanel({
  canAct,
  call,
}: {
  canAct: boolean;
  call: OpsCall;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ListingSetupDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [featureBusyId, setFeatureBusyId] = useState<number | null>(null);
  const [extIds, setExtIds] = useState<Record<number, string>>({});
  const [issued, setIssued] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!canAct) return;
    try {
      const d = await call<{ listings: ListingSetupDto[] }>("/api/ops/owner-key");
      setRows(d.listings ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Could not load listings");
    }
  }, [call, canAct]);

  const provision = async (row: ListingSetupDto, rotate: boolean) => {
    setBusyId(row.id);
    try {
      const d = await call<{
        ok: boolean;
        externalId: string;
        ownerKey: string | null;
        rotated: boolean;
        unchanged?: boolean;
        warning?: string;
      }>("/api/ops/owner-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: row.id,
          external_id: extIds[row.id]?.trim() || undefined,
          rotate_owner_key: rotate,
        }),
      });
      if (d.ownerKey) {
        setIssued((p) => ({ ...p, [row.id]: d.ownerKey as string }));
        toast(`Owner key issued for ${row.name}`, { kind: "success" });
      } else {
        toast(d.warning ?? "Listing already provisioned", { kind: "info" });
      }
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not provision listing", { kind: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const setFeatured = async (row: ListingSetupDto, featured: boolean) => {
    setFeatureBusyId(row.id);
    try {
      const d = await call<{ ok: boolean; error?: string }>("/api/ops/featured", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: row.id, featured }),
      });
      if (!d.ok) {
        toast(d.error ?? "Could not update the featured rail", { kind: "error" });
        return;
      }
      toast(featured ? `${row.name} is featured tonight` : `${row.name} removed from featured`, {
        kind: "success",
      });
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update the featured rail", { kind: "error" });
    } finally {
      setFeatureBusyId(null);
    }
  };

  const copy = async (id: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
    } catch {
      toast("Could not copy to the clipboard", { kind: "error" });
    }
  };

  const stranded = rows.filter((r) => r.needsSetup);
  const ready = rows.filter((r) => !r.needsSetup);

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
            <KeyRound className="size-4.5 text-ember-400" /> Listing provisioning
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
            A listing needs an owner key and an external id before it can connect a POS. Issue them
            here for listings that were seeded without them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!canAct}
          className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", loaded && "animate-spin")} />
          Load
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-chili-500/30 bg-chili-500/10 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      {stranded.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ember-400">
            Needs setup ({stranded.length})
          </p>
          <ul className="mt-2 space-y-2.5">
            {stranded.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-white/10 bg-white/[0.045] p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-bold text-cream-50">{r.name}</span>
                  <span className="font-mono text-[11px] text-cream-500">#{r.id}</span>
                  <span className="rounded-full bg-chili-500/15 px-2 py-0.5 text-[11px] font-bold text-chili-400">
                    {!r.hasOwnerKey ? "no key" : "no external id"}
                  </span>
                </div>

                {!r.hasOwnerKey && (
                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={extIds[r.id] ?? ""}
                      onChange={(e) =>
                        setExtIds((p) => ({ ...p, [r.id]: e.target.value }))
                      }
                      placeholder={
                        r.externalId ? r.externalId : "external id, e.g. rst_04C3A00CA171"
                      }
                      className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void provision(r, false)}
                      disabled={!canAct || busyId === r.id}
                      className="press shrink-0 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-3.5 py-2 text-xs font-bold text-white transition-opacity disabled:opacity-50"
                    >
                      {busyId === r.id ? "Issuing…" : "Issue owner key"}
                    </button>
                  </div>
                )}

                {r.hasOwnerKey && !r.externalId && (
                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={extIds[r.id] ?? ""}
                      onChange={(e) =>
                        setExtIds((p) => ({ ...p, [r.id]: e.target.value }))
                      }
                      placeholder="external id to backfill"
                      className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void provision(r, false)}
                      disabled={!canAct || busyId === r.id}
                      className="press shrink-0 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
                    >
                      {busyId === r.id ? "Saving…" : "Set external id"}
                    </button>
                  </div>
                )}

                {issued[r.id] && (
                  <div className="mt-2.5 rounded-xl border border-mint-400/25 bg-black/25 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mint-400">
                      Owner key — shown once
                    </p>
                    <div className="mt-2 flex items-center gap-2.5">
                      <span className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-xs font-bold text-cream-50">
                        {issued[r.id]}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copy(r.id, issued[r.id])}
                        className="press flex shrink-0 items-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
                      >
                        {copiedId === r.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copiedId === r.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-cream-500">
                      Store it now. Only a hash is kept, so it cannot be recovered later.
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mint-400">
            Ready ({ready.length})
          </p>
          <ul className="mt-2 space-y-1.5">
            {ready.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] px-3.5 py-2.5"
              >
                <span className="font-display text-sm font-bold text-cream-50">{r.name}</span>
                <span className="font-mono text-[11px] text-cream-500">
                  {r.externalId ?? "no external id"}
                </span>
                {r.posRestaurantId ? (
                  <span className="rounded-full bg-mint-500/12 px-2 py-0.5 font-mono text-[11px] font-bold text-mint-400">
                    POS {r.posRestaurantId}
                  </span>
                ) : (
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-cream-500">
                    not connected to a POS
                  </span>
                )}
                <span className="ml-auto flex items-center gap-3 text-[11px] text-cream-500">
                  <button
                    type="button"
                    onClick={() => void setFeatured(r, !r.featured)}
                    disabled={!canAct || featureBusyId === r.id}
                    title={
                      r.featured
                        ? "Remove from the home page featured rail"
                        : "Feature on the home page tonight"
                    }
                    className={cn(
                      "press flex items-center gap-1 rounded-full px-2 py-0.5 font-bold transition-colors disabled:opacity-50",
                      r.featured
                        ? "bg-ember-500/20 text-ember-300 hover:bg-ember-500/30"
                        : "bg-white/8 text-cream-500 hover:bg-white/12",
                    )}
                  >
                    {featureBusyId === r.id ? (
                      <RefreshCw className="size-3 animate-spin" />
                    ) : (
                      <Flame className={cn("size-3", !r.featured && "opacity-50")} />
                    )}
                    {r.featured ? "Featured" : "Feature"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void provision(r, true)}
                    disabled={!canAct || busyId === r.id}
                    title="Issue a new owner key for this listing. The POS passkey is a separate credential and is left untouched, so an existing connection keeps working."
                    className="press text-cream-400 underline decoration-white/20 underline-offset-2 transition-colors hover:text-ember-300 disabled:opacity-50"
                  >
                    rotate key
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loaded && rows.length === 0 && !error && (
        <p className="mt-4 text-sm text-cream-500">No listings found.</p>
      )}
    </section>
  );
}

function CodesPanel({
  token,
  canAct,
  call,
}: {
  token: string;
  canAct: boolean;
  call: OpsCall;
}) {
  const { toast } = useToast();
  const [codes, setCodes] = useState<ConnectionCodeDto[]>([]);
  const [last, setLast] = useState<ConnectionCodeDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canAct) return;
    try {
      const d = await call<{ codes: ConnectionCodeDto[] }>("/api/partner/codes");
      setCodes(d.codes ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setCodes([]);
      setError(e instanceof Error ? e.message : "Could not load codes");
    }
  }, [call, canAct]);

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

  /**
   * Withdraw an unused code.
   *
   * Revoking is irreversible and the code's contents are unrecoverable, so it is
   * two-step: the first click arms the row, the second confirms. That is cheaper
   * than a modal for an operator who is working through a list, and it cannot be
   * mis-hit the way a bare trash icon in a dense table can.
   */
  const revoke = async (code: string) => {
    setRevoking(code);
    try {
      const d = await call<{ ok: boolean; code: ConnectionCodeDto }>(
        `/api/partner/codes/${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      toast(`${code} revoked`, {
        kind: "success",
        sub: "It can no longer be redeemed",
      });
      // The minted-code banner shows the code most likely to be the one just
      // revoked, so drop it rather than leave a dead code on screen looking live.
      setLast((prev) => (prev?.code === code ? null : prev));
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke the code", { kind: "error" });
    } finally {
      setRevoking(null);
      setConfirming(null);
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
            A code is the single-use capability that lets a restaurant claim its listing. Withdraw
            one that leaked or went to the wrong address — a redeemed code cannot be revoked.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={!canAct || busy}
            className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            Load
          </button>
          <button
            type="button"
            onClick={mint}
            disabled={!canAct || busy}
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
          {!last.expiresAt && (
            <p className="mt-1.5 text-xs text-cream-500">
              No expiry set — this code stays redeemable until it is used or revoked.
            </p>
          )}
        </div>
      )}

      {canAct && !error && loaded && (
        <div className="mt-5">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-cream-500">History</p>
          {codes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-xs text-cream-500">
              Nothing minted yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {codes.map((c) => {
                const expired = !!c.expiresAt && new Date(c.expiresAt) < new Date();
                const armed = confirming === c.code;
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5",
                      armed ? "bg-chili-500/12" : "bg-white/[0.045]",
                    )}
                  >
                    <span
                      className={cn(
                        "font-mono text-sm font-bold tabular-nums",
                        c.status === "revoked" ? "text-cream-600 line-through" : "text-cream-100",
                      )}
                    >
                      {c.code}
                    </span>

                    {c.status === "used" ? (
                      <>
                        <span className="ml-auto max-w-[9rem] truncate text-xs text-cream-400">
                          {c.restaurantName}
                        </span>
                        <span className="flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-bold text-mint-400">
                          <UserRoundCheck className="size-3" /> Used
                        </span>
                      </>
                    ) : c.status === "revoked" ? (
                      <span className="ml-auto flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-cream-400">
                        <Ban className="size-3" /> Revoked
                      </span>
                    ) : expired ? (
                      <span className="ml-auto flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-cream-500">
                        <Clock className="size-3" /> Expired
                      </span>
                    ) : (
                      <>
                        <span className="ml-auto flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-cream-300">
                          <BadgeCheck className="size-3" /> Unused
                        </span>
                        {armed ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void revoke(c.code)}
                              disabled={revoking === c.code}
                              className="press flex items-center gap-1 rounded-lg bg-chili-500 px-2.5 py-1 text-[11px] font-bold text-white transition-opacity disabled:opacity-60"
                            >
                              {revoking === c.code ? (
                                <LoaderCircle className="size-3 animate-spin" />
                              ) : (
                                <Ban className="size-3" />
                              )}
                              Confirm revoke
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirming(null)}
                              className="press rounded-lg px-2 py-1 text-[11px] font-semibold text-cream-400 transition-colors hover:text-cream-200"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirming(c.code)}
                            title="Withdraw this code so it can never be redeemed"
                            className="press flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-cream-500 transition-colors hover:bg-chili-500/15 hover:text-chili-300"
                          >
                            <Ban className="size-3" /> Revoke
                          </button>
                        )}
                      </>
                    )}

                    <span className="hidden shrink-0 text-[11px] text-cream-600 sm:block">
                      {formatWhen(c.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ConnectionsPanel({
  token,
  canAct,
  call,
}: {
  token: string;
  canAct: boolean;
  call: OpsCall;
}) {
  const [rows, setRows] = useState<ConnectionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!canAct) return;
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
  }, [call, canAct]);

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
          disabled={!canAct || busy}
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

      {canAct && !error && loaded && (
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

interface PosBridgeProbe {
  ok: boolean;
  baseUrl: string | null;
  host: string | null;
  configured: boolean;
  loopback: boolean;
  status: number | null;
  latencyMs: number | null;
  reason: string | null;
  detail: string | null;
}

/**
 * Reachability of the POS itself, checked before anything else in this panel.
 *
 * Every marketplace→POS call resolves its host from one env var, so a wrong
 * POS_BASE_URL makes connection verify, claim, order ingest, payments and
 * cancellations all fail together with an identical, context-free 502. A
 * deployment once carried a quick-tunnel URL that had already stopped resolving
 * and nothing surfaced it until a restaurant tried to connect. Read this first
 * when a bridge call 502s.
 */
/**
 * Identity transfers: one listing asking to take a POS identity
 * (`restaurants.marketplace_id`) from another that still holds it.
 *
 * This queue exists because the alternative was a hand-written UPDATE. The claim
 * route refuses with MARKETPLACE_ID_TAKEN when the unique id is spoken for, and
 * it does so *after* the POS burned its single-use connection code — so the
 * operator had no route forward and the only fix was an engineer editing the
 * database. Now the refusal files a request and the claim is preserved as a
 * PENDING record, so approving here finishes the connection without the
 * restaurant going back to the POS for a new code.
 *
 * Approving takes capability away from one partner and gives it to another, so
 * the consequences are shown before the click: the listing that loses the id has
 * its checkout closed, and any order still mid-flight loses its status webhook.
 * Those counts come from the server rather than being recomputed in the browser.
 */
/**
 * One row of the identity-transfer queue, mirroring
 * `IntegrationTransferDto` from src/db/queries.ts.
 *
 * `holderStats` is the reason this panel exists rather than a confirm dialog:
 * approving takes a working checkout away from another restaurant, and the
 * operator should see how much is riding on it before agreeing.
 */
interface TransferRow {
  id: number;
  status: string;
  marketplaceId: string;
  posRestaurantId: string | null;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  requestedBy: { id: number; name: string; slug: string };
  heldBy: { id: number; name: string; slug: string } | null;
  holderRecordStatus: string | null;
  holderStats: { orders: number; openOrders: number };
}

function TransferPanel({ canAct, call }: { canAct: boolean; call: OpsCall }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<Record<number, string[]>>({});

  const load = useCallback(async () => {
    if (!canAct) return;
    setBusy(true);
    try {
      const d = await call<{ transfers: TransferRow[] }>("/api/ops/integration-transfers");
      setRows(d.transfers ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Could not load transfer requests");
    } finally {
      setBusy(false);
    }
  }, [call, canAct]);

  const decide = async (row: TransferRow, decision: "approved" | "denied") => {
    setDeciding(row.id);
    setWarnings((p) => {
      const next = { ...p };
      delete next[row.id];
      return next;
    });
    try {
      const d = await call<{
        ok: boolean;
        outcome?: string;
        grantedTo?: number;
        releasedFrom?: number;
        activated?: boolean;
        warnings?: string[];
        error?: string;
      }>("/api/ops/integration-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: row.id, decision }),
      });
      if (!d.ok) {
        toast(d.error ?? "Could not decide transfer", { kind: "error" });
        return;
      }
      if (decision === "denied") {
        toast(`Transfer to ${row.requestedBy.name} denied`, { kind: "info" });
      } else if (d.warnings?.length) {
        // Warnings do not block, but they are the whole reason this panel shows
        // counts — surface them instead of burying them in a success toast.
        setWarnings((p) => ({ ...p, [row.id]: d.warnings as string[] }));
        toast(`Moved to ${row.requestedBy.name} — with warnings`, { kind: "info" });
      } else {
        toast(`Moved to ${row.requestedBy.name}`, {
          kind: "success",
          sub: d.activated ? "Connection is live" : "Connected, still waiting on the POS secret",
        });
      }
      void load();
    } catch (e) {
      // A 409 here means the read was stale: the holder moved on, or someone
      // else decided first. Reload rather than leaving a queue that lies.
      if (e instanceof OpsError && e.status === 409) {
        toast(e.message, { kind: "error" });
        void load();
        return;
      }
      toast(e instanceof Error ? e.message : "Could not decide transfer", { kind: "error" });
    } finally {
      setDeciding(null);
    }
  };

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
            <ArrowRightLeft className="size-4.5 text-ember-400" /> Identity transfers
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
            Listings asking to take a POS identity from another listing. Approving moves the id,
            closes the old listing&apos;s checkout, and cancels its in-flight status webhooks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!canAct || busy}
          className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Load
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-chili-500/25 bg-chili-500/8 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      {loaded && !rows.length && !error && (
        <p className="mt-4 rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-xs text-cream-500">
          No pending transfer requests.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-cream-50">{row.requestedBy.name}</span>
              <ArrowRightLeft className="size-3.5 text-ember-400" />
              <span className="font-semibold text-cream-300">{row.heldBy?.name ?? "unknown"}</span>
              <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[11px] text-cream-400">
                {row.marketplaceId}
              </span>
            </div>

            <p className="mt-1.5 text-xs text-cream-500">
              Requested {formatWhen(row.requestedAt)}
              {row.holderRecordStatus ? ` · holder record ${row.holderRecordStatus}` : ""}
              {row.holderStats.orders > 0 ? ` · ${row.holderStats.orders} orders` : ""}
              {row.holderStats.openOrders > 0 ? ` · ${row.holderStats.openOrders} still open` : ""}
            </p>

            {row.note && <p className="mt-1.5 text-xs italic text-cream-400">&ldquo;{row.note}&rdquo;</p>}

            {/* Shown after the fact: approval already happened, so these describe
                consequences that are live rather than ones being considered. */}
            {warnings[row.id]?.length ? (
              <ul className="mt-3 space-y-1 rounded-xl border border-ember-500/25 bg-ember-500/8 px-3.5 py-2.5">
                {warnings[row.id].map((w) => (
                  <li key={w} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ember-200">
                    <AlertTriangle className="mt-px size-3 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void decide(row, "approved")}
                disabled={deciding === row.id}
                className="press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-mint-400 to-mint-600 px-4 py-2 text-xs font-bold text-emerald-950 transition-opacity disabled:opacity-60"
              >
                {deciding === row.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Approve transfer
              </button>
              <button
                type="button"
                onClick={() => void decide(row, "denied")}
                disabled={deciding === row.id}
                className="press flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-chili-500/20 hover:text-chili-300 disabled:opacity-60"
              >
                <X className="size-3.5" />
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PosBridgePanel({ token, call }: { token: string; call: OpsCall }) {
  const [probe, setProbe] = useState<PosBridgeProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await call<{ ok: boolean; probe: PosBridgeProbe }>("/api/ops/pos-bridge");
      setProbe(d.probe);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the probe endpoint");
    } finally {
      setBusy(false);
    }
  }, [call]);

  return (
    <section className="glass mt-5 rounded-3xl p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream-50">
        <Activity className="size-4.5 text-ember-400" /> POS bridge
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
        Where the marketplace sends orders, payments and connection codes, and whether that host
        answers. Check this first when a bridge call returns 502.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-chili-500/30 bg-chili-600/10 px-3.5 py-2.5 text-xs text-chili-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={check}
        disabled={busy}
        className="press mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-bold text-cream-50 transition-colors hover:bg-white/12 disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Check POS bridge
      </button>

      {probe && (
        <div className="mt-4 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                probe.ok ? "bg-mint-500/12 text-mint-400" : "bg-chili-500/15 text-chili-400",
              )}
            >
              {probe.ok ? <BadgeCheck className="size-3" strokeWidth={2.6} /> : <ShieldAlert className="size-3" strokeWidth={2.6} />}
              {probe.ok ? "Reachable" : "Unreachable"}
            </span>
            <span className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-cream-300">
              {probe.host ?? "no POS_BASE_URL"}
            </span>
            {probe.latencyMs != null && (
              <span className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-cream-300">
                {probe.latencyMs}ms
              </span>
            )}
            {probe.status != null && (
              <span className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-cream-300">
                HTTP {probe.status}
              </span>
            )}
          </div>
          {!probe.ok && (
            <p className="rounded-xl border border-chili-500/25 bg-chili-600/10 px-3.5 py-2.5 text-chili-300">
              {probe.reason === "not_configured"
                ? "POS_BASE_URL is not set on this deployment."
                : probe.reason === "loopback_in_production"
                  ? "POS_BASE_URL points at localhost, which a deployed function can never reach. Set it to the POS's public URL."
                  : (probe.detail ?? "The POS did not answer.")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function WorkersPanel({
  token,
  canAct,
  call,
}: {
  token: string;
  canAct: boolean;
  call: OpsCall;
}) {
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
          disabled={!canAct || busy !== null}
          className="press flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow disabled:opacity-50"
        >
          {busy === "pos" ? <LoaderCircle className="size-4 animate-spin" /> : <Store className="size-4" />}
          Drain POS deliveries
        </button>
        <button
          type="button"
          onClick={runPayments}
          disabled={!canAct || busy !== null}
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
