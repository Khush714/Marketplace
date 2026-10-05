"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Blocks,
  Check,
  Handshake,
  KeyRound,
  Power,
  RefreshCw,
  Search,
  Store,
  Unplug,
  Waypoints,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/domain";
import { useToast } from "@/lib/toast";
import { forgetOwnerKey, readStoredOwnerKey, storeOwnerKey } from "@/lib/owner-key-store";

interface PosIdentity {
  provider: string;
  status: string;
  external_restaurant_id: string | null;
  restaurant: { id: number; name: string } | null;
  branch_id: string | null;
  external_outlet_id: string | null;
  branch: { id: string; name: string; status: string } | null;
  code_status?: string;
  expires_at?: string | null;
}

/**
 * Human wording for the readiness reasons the server computes. A raw enum like
 * "webhook_secret" tells a restaurant nothing about what to do next, and the
 * whole point of this panel is that it is actionable.
 */
const NOT_READY_COPY: Record<string, string> = {
  // Deliberately does NOT mention a webhook URL: in this integration the POS
  // generates the signing secret locally and hands it over on the claim
  // response. There is no URL to configure, and telling an operator to go
  // looking for one sends them down a path that does not exist.
  webhook_secret:
    "We could not read the signing secret from your POS, so orders cannot be signed and sent. Reconnect the POS to finish setup.",
  pos_restaurant_id:
    "We haven't received your POS restaurant id yet. Reconnect the POS to finish setup.",
  inactive: "This listing is hidden from customers. Publish it from Manage to start selling.",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending setup",
  revoked: "Revoked",
  error: "Error",
};

interface IntegrationRecord {
  restaurantId: number;
  marketplaceId: string;
  provider: string;
  posRestaurantId: string | null;
  posBranchId: string | null;
  posOutletId: string | null;
  status: string;
  connectedAt: string | null;
  lastHeartbeatAt?: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /**
   * Server-computed readiness — the three facts the POS bridge needs before it
   * will POST an order. `status === "active"` alone is NOT the same thing, and
   * this page used to assert "ACTIVE" unconditionally, which told a restaurant
   * it was live while checkout would refuse the order.
   */
  ready?: boolean;
  notReadyReason?: "webhook_secret" | "pos_restaurant_id" | "inactive" | null;
}

interface ManageRestaurant {
  id: number;
  name: string;
  slug: string;
  cuisines: string[];
  locality: string;
  isActive: boolean;
}

/** A POS identity this listing is asking to take from another listing. */
interface TransferState {
  requested: boolean;
  requestId: number | null;
  heldBy: { id: number; name: string; slug: string } | null;
  marketplaceId: string;
}

/** The same thing as read back from the listing on load. */
interface PendingTransfer {
  id: number;
  status: string;
  requestedAt: string;
  heldBy: { id: number; name: string; slug: string } | null;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function PartnerIntegrationsPage() {
  const { toast } = useToast();

  // The owner key is unrecoverable and /partner already stashes it in
  // sessionStorage, so seed the field from there instead of making the operator
  // paste a secret the tab is holding one page away.
  // Seeded EMPTY rather than from localStorage. `readStoredOwnerKey()` returns
  // "" during SSR and the real key in the browser, so seeding from it makes the
  // server and client render different input values — React reports a hydration
  // mismatch and throws away the client tree. The stored key is picked up in the
  // mount effect below instead, which runs after hydration has already matched.
  const [ownerKey, setOwnerKey] = useState("");
  const [listing, setListing] = useState<ManageRestaurant | null>(null);
  const [record, setRecord] = useState<IntegrationRecord | null>(null);
  const [loading, setLoading] = useState(false);

  // Connect flow state
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<{
    ok: boolean;
    detected?: PosIdentity;
    error?: string;
    redeemed?: boolean;
    requiresClaim?: boolean;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Set when a claim was refused because the POS identity belongs to another
  // listing. The server raises the transfer request on our behalf, so this is
  // about explaining the wait — not about the operator pressing a button.
  const [transfer, setTransfer] = useState<TransferState | null>(null);

  const load = useCallback(
    async (key: string, opts?: { silent?: boolean }) => {
      const trimmed = key.trim();
      if (!trimmed) return;
      // Polling re-reads this on a timer; a toast every 5s would bury the page
      // in "Listing loaded" and is not news the second time.
      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      try {
        const d = await json<{
          ok: boolean;
          error?: string;
          restaurant?: ManageRestaurant;
          record?: IntegrationRecord | null;
          transfer?: PendingTransfer | null;
        }>(`/api/partner/integrations`, { headers: { "x-owner-key": trimmed } });
        if (!d.ok || !d.restaurant) {
          setListing(null);
          setRecord(null);
          if (!silent) toast(d.error ?? "Invalid owner key", { kind: "error" });
          return;
        }
        setOwnerKey(trimmed);
        setListing(d.restaurant);
        setRecord(d.record ?? null);
        // Restored on every load so a pending transfer survives a reload or a
        // second tab — otherwise the operator sees the empty connect form again
        // and mints yet another burned connection code.
        setTransfer(
          d.transfer
            ? {
                requested: true,
                requestId: d.transfer.id,
                heldBy: d.transfer.heldBy,
                marketplaceId: "",
              }
            : null,
        );
        storeOwnerKey(trimmed);
        if (!silent) toast("Listing loaded", { sub: d.restaurant.name });
      } catch {
        if (!silent) toast("Could not load listing", { kind: "error" });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast],
  );

  // Auto-load once when a key is already in browser storage, so arriving from
  // /partner lands on the listing instead of an empty paste box. Runs a single
  // time; the ref guards against React StrictMode's double effect.
  const autoLoadDone = useRef(false);
  useEffect(() => {
    if (autoLoadDone.current) return;
    const stored = readStoredOwnerKey();
    if (!stored) return;
    autoLoadDone.current = true;
    // Deferred to a macrotask so the fetch happens after the first paint and
    // load()'s setState runs in a callback instead of synchronously in the
    // effect body (react-hooks/set-state-in-effect).
    //
    // Deliberately NO cleanup that clears this timer. StrictMode invokes the
    // effect twice on mount: the first pass arms the timer, the second pass
    // runs this cleanup and then early-returns because `autoLoadDone` is
    // already true. Clearing the timer there therefore cancelled the only
    // fetch that would ever be scheduled, and the auto-load silently never
    // happened — the restaurant always landed on the empty paste box. A 0ms
    // timer needs no teardown, and the ref still prevents a duplicate fetch.
    window.setTimeout(() => {
      void load(stored);
    }, 0);
  }, [load]);

  /**
   * While a transfer is queued, poll for the ops decision instead of making the
   * restaurant sit on a read-only panel pressing "Check status".
   *
   * Approval is a human queue step (`decideIntegrationTransfer` flips the record
   * itself), so there is no push channel available here — polling the same
   * token-gated read the manual button used is the whole mechanism. It stops the
   * moment the server stops reporting a pending transfer, and it announces the
   * outcome once rather than on every tick.
   */
  const transferWasPending = useRef(false);
  useEffect(() => {
    const key = ownerKey.trim();
    if (!transfer || !key) {
      transferWasPending.current = false;
      return;
    }
    const tick = () => void load(key, { silent: true });
    // Give ops a moment before the first re-read; the decision is never instant.
    const interval = window.setInterval(tick, 6000);
    // Surface the transition once so "connected" appears without a page reload.
    if (transferWasPending.current) {
      transferWasPending.current = false;
      toast("Transfer updated", { sub: "Your POS identity status has changed." });
    } else {
      transferWasPending.current = true;
    }
    return () => window.clearInterval(interval);
  }, [transfer, ownerKey, load, toast]);

  const verify = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setVerifying(true);
    setVerdict(null);
    try {
      const d = await json<{
        ok: boolean;
        detected?: PosIdentity;
        error?: string;
        redeemed?: boolean;
        requiresClaim?: boolean;
      }>("/api/partner/integrations/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-owner-key": ownerKey.trim() },
          body: JSON.stringify({ connection_code: trimmed }),
        },
      );
      setVerdict(d);
    } catch {
      setVerdict({ ok: false, error: "Could not reach the POS" });
    } finally {
      setVerifying(false);
    }
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    try {
      const d = await json<{
        ok: boolean;
        error?: string;
        code?: string;
        record?: IntegrationRecord;
        already?: boolean;
        connected?: boolean;
        transfer?: TransferState | null;
      }>("/api/partner/integrations", {
        method: "POST",
        // Header rather than body, matching the route's preferred transport. The
        // key is a full-control credential and must not end up in an access log.
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey.trim() },
        body: JSON.stringify({ connection_code: code.trim() }),
      });
      if (!d.ok || !d.record) {
        // The identity belongs to another listing. The server has already filed
        // the transfer request and kept our claim, so this is not a failure to
        // retry — pressing Connect again would burn a second connection code.
        if (d.code === "MARKETPLACE_ID_TAKEN" && d.transfer) {
          setTransfer(d.transfer);
          setCode("");
          setVerdict(null);
          toast("Transfer requested — we'll move the POS across", {
            kind: "info",
            sub: d.transfer.heldBy
              ? `Currently linked to ${d.transfer.heldBy.name}`
              : "Linked to another listing",
          });
          return;
        }
        toast(d.error ?? "Could not connect the POS", { kind: "error" });
        return;
      }
      setRecord(d.record);
      setTransfer(null);
      setCode("");
      setVerdict(null);
      if (d.connected === false) {
        // The claim landed but the POS did not hand over everything delivery
        // needs, so the record is pending and checkout stays closed. Say why
        // rather than showing a bare "Disconnected" badge.
        toast(d.error ?? "POS linked, but not ready to take orders yet", {
          kind: "info",
          sub: `Gateway: ${d.record.posRestaurantId ?? "—"}`,
        });
        return;
      }
      toast(d.already ? "Already connected" : "POS connected", {
        sub: `Gateway: ${d.record.posRestaurantId ?? "—"}`,
      });
    } catch {
      toast("Connection failed", { kind: "error" });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!ownerKey) return;
    setDisconnecting(true);
    try {
      const d = await json<{ ok: boolean; error?: string; record?: IntegrationRecord | null }>(
        "/api/partner/integrations",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "x-owner-key": ownerKey.trim() },
        },
      );
      if (!d.ok) {
        toast(d.error ?? "Could not disconnect", { kind: "error" });
        return;
      }
      setRecord(d.record ?? null);
      toast("POS disconnected", { kind: "info", sub: "Orders, identity and audit history are preserved" });
    } catch {
      toast("Disconnect failed", { kind: "error" });
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = record && record.status === "active";
  // A record exists but is not deliverable yet: the POS has not shared a webhook
  // secret, so orders cannot be signed and sent. Distinct from "disabled",
  // which means the owner turned the connection off.
  const pending = !!record && record.status === "pending";

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-mint-400/60 focus:outline-none";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">
            <Handshake className="size-3.5" /> For restaurant partners
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
            POS integration
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-cream-400">
            Connect your listing to the POS with a single-use connection code, then confirm the
            restaurant, branch and status the POS detected.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2.5">
          <Link
            href="/partner/menu"
            className="press rounded-xl bg-white/8 px-4 py-2.5 text-center text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            Menu editor
          </Link>
          <Link
            href="/partner"
            className="press rounded-xl bg-white/8 px-4 py-2.5 text-center text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            Back to partner tools
          </Link>
        </div>
      </div>

      {/* Owner key */}
      <section className="glass mt-8 flex flex-col rounded-3xl p-5 md:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <KeyRound className="size-4.5 text-ember-400" /> Your listing
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
            Enter the owner key you received when connecting your restaurant. If you
            onboarded in this tab it is filled in already.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={ownerKey}
              onChange={(e) => {
                const next = e.target.value;
                setOwnerKey(next);
                // Drop the stored key the moment it is edited, so a stale
                // sessionStorage entry cannot silently reappear on a later visit.
                storeOwnerKey(next);
              }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(ownerKey);
            }}
            placeholder="Paste your owner key"
            className={cn(inputCls, "flex-1 font-mono font-bold")}
          />
          <button
            type="button"
            onClick={() => void load(ownerKey)}
            disabled={loading || !ownerKey.trim()}
            className="press flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white shadow-glow transition-opacity disabled:opacity-60"
          >
            {loading ? <RefreshCw className="size-4 animate-spin" /> : <Store className="size-4" />}
            {loading ? "Loading…" : "Load listing"}
          </button>
        </div>

        {listing && (
          <div className="animate-pop-in mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <span className="font-display text-lg font-bold text-cream-50">{listing.name}</span>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                connected
                  ? "bg-mint-500/12 text-mint-400"
                  : pending
                    ? "bg-ember-400/12 text-ember-400"
                    : "bg-white/8 text-cream-300",
              )}
            >
              {connected ? (
                <>
                  <BadgeCheck className="size-3" strokeWidth={2.6} /> POS connected
                </>
              ) : pending ? (
                <>
                  <RefreshCw className="size-3" strokeWidth={2.6} /> Waiting on POS
                </>
              ) : record ? (
                <>
                  <Unplug className="size-3" strokeWidth={2.6} /> Disconnected
                </>
              ) : (
                <>
                  <Blocks className="size-3" strokeWidth={2.6} /> Not connected
                </>
              )}
            </span>
            {record?.posRestaurantId && (
              <span className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-[11px] font-bold text-cream-300">
                ext {record.posRestaurantId}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Connect / CONNECTED */}
      {listing && (
        <>
          {!connected ? (
            <section className="glass mt-6 flex flex-col rounded-3xl p-5 md:p-6">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
                <Waypoints className="size-4.5 text-mint-400" /> Connect the POS
              </h2>

              {transfer ? (
                /* The POS identity is still held by another listing. The claim was
                   kept on our side (record stays PENDING) and ops has the request,
                   so the normal path is to wait — and say so plainly rather than
                   implying a form would do anything. The form still renders below
                   so a partner who would rather burn a fresh code than wait in a
                   queue is not trapped on a read-only panel. */
                <div className="animate-pop-in mt-4 rounded-2xl border border-ember-400/25 bg-ember-500/10 p-5">
                  <p className="flex items-center gap-2 text-sm font-bold text-ember-400">
                    <AlertTriangle className="size-4" /> This POS is linked to another listing
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-cream-200">
                    {transfer.heldBy ? (
                      <>
                        Your POS still answers to{" "}
                        <span className="font-semibold text-cream-50">{transfer.heldBy.name}</span>
                        . We have asked our team to move it to{" "}
                        <span className="font-semibold text-cream-50">{listing?.name}</span>.
                      </>
                    ) : (
                      <>
                        Your POS is still linked to a different listing on the marketplace. We
                        have asked our team to move it to{" "}
                        <span className="font-semibold text-cream-50">{listing?.name}</span>.
                      </>
                    )}
                  </p>
                  <p className="mt-2.5 text-xs leading-relaxed text-cream-400">
                    Your connection code has been kept, so you do not need a new one — this
                    finishes on its own once the transfer is approved. We&apos;re checking for
                    you; there&apos;s nothing to press. Ordering stays closed until then.
                  </p>
                  {transfer.requestId ? (
                    <p className="mt-2.5 font-mono text-[11px] text-cream-500">
                      request #{transfer.requestId}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void load(ownerKey)}
                    className="press mt-4 flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
                  >
                    <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                    Check now
                  </button>
                </div>
              ) : null}

              {!connected && (
                <>
                  <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
                    In your POS, open{" "}
                    <span className="font-semibold text-cream-300">Settings → Integrations</span>{" "}
                    and choose{" "}
                    <span className="font-semibold text-cream-300">Issue a connection code</span>,
                    then paste the code it shows here. Codes are issued by the POS, not here, and
                    are verified against it before anything is consumed.
                  </p>

                  {transfer && (
                    <p className="mt-2.5 text-xs leading-relaxed text-cream-400">
                      Still waiting on the transfer above? You can start over with a new code —
                      the request stays queued either way.
                    </p>
                  )}

              <form onSubmit={connect} className="mt-5 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                    Connection code
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={code}
onChange={(e) => {
                          setCode(e.target.value.toUpperCase());
                          setVerdict(null);
                          // Typing a fresh code is an explicit "forget the pending
                          // transfer" — otherwise the notice below would hide the
                          // form and the field could not be edited underneath it.
                          if (transfer) setTransfer(null);
                        }}
                      placeholder="MKT-3F8A-9C21"
                      className={cn(inputCls, "min-w-0 font-mono font-bold uppercase tabular-nums")}
                    />
                    <button
                      type="button"
                      onClick={() => void verify()}
                      disabled={verifying || !code.trim() || !ownerKey.trim()}
                      className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-60"
                    >
                      {verifying ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}
                      {verifying ? "Checking…" : "Verify"}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-cream-500">
                    Verifying a code requires your owner key, so the POS cannot be probed anonymously.
                  </p>
                </div>

                {verdict && (
                  <div
                    className={cn(
                      "animate-pop-in rounded-2xl border p-4",
                      verdict.ok && !verdict.requiresClaim
                        ? "border-mint-400/25 bg-mint-500/10"
                        : verdict.ok
                          ? "border-ember-400/25 bg-ember-500/10"
                          : "border-chili-500/25 bg-chili-500/8",
                    )}
                  >
                    {verdict.ok && verdict.detected ? (
                      <>
                        <p className="flex items-center gap-1.5 text-sm font-bold text-mint-400">
                          <BadgeCheck className="size-4" /> POS detected
                        </p>                        <div className="mt-2 space-y-1.5 text-sm text-cream-200">
                          <p>
                            <span className="text-cream-500">Restaurant:</span>{" "}
                            <span className="font-semibold">
                              {verdict.detected.restaurant?.name ?? "Unknown POS restaurant"}
                            </span>
                            {verdict.detected.external_restaurant_id && (
                              <span className="ml-2 rounded-full bg-white/8 px-2 py-0.5 font-mono text-[11px] text-cream-300">
                                {verdict.detected.external_restaurant_id}
                              </span>
                            )}
                          </p>
                          {verdict.detected.branch && (
                            <p>
                              <span className="text-cream-500">Branch:</span>{" "}
                              <span className="font-semibold">{verdict.detected.branch.name}</span>
                              <span
                                className={cn(
                                  "ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  verdict.detected.branch.status === "ACTIVE"
                                    ? "bg-mint-500/12 text-mint-400"
                                    : "bg-chili-500/15 text-chili-400",
                                )}
                              >
                                {verdict.detected.branch.status}
                              </span>
                            </p>
                          )}
                          {verdict.detected.expires_at && (
                            <p className="text-xs text-cream-500">
                              Code valid through {formatWhen(verdict.detected.expires_at)}
                            </p>
                          )}
                        </div>
                        <button
                          type="submit"
                          disabled={connecting || !ownerKey.trim()}
                          className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-mint-400 to-mint-600 py-3 text-sm font-bold text-emerald-950 transition-opacity disabled:opacity-60"
                        >
                          {connecting ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
                          {connecting ? "Connecting…" : "Confirm & connect"}
                        </button>
                      </>
                    ) : verdict.ok && verdict.requiresClaim ? (
                      // A redeemed code is not automatically good or bad: it is
                      // either this listing's own previous connection (reconnect)
                      // or a code already spent elsewhere. The claim step settles
                      // it — it compares the code's bound POS identity against
                      // this listing's active record and refuses a mismatch — so
                      // offer the button instead of a dead end.
                      <>
                        <p className="flex items-center gap-1.5 text-sm font-bold text-ember-400">
                          <AlertTriangle className="size-4" /> Code already used
                        </p>
                        <p className="mt-2 text-sm text-cream-200">{verdict.error}</p>
                        <p className="mt-1.5 text-xs text-cream-500">
                          Continuing is safe: the connection is only accepted if the code
                          belongs to the POS restaurant already on this listing.
                        </p>
                        <button
                          type="submit"
                          disabled={connecting || !ownerKey.trim()}
                          className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-60"
                        >
                          {connecting ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
                          {connecting ? "Connecting…" : "Reuse this code"}
                        </button>
                      </>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-chili-400">
                        {verdict.error ?? "Code could not be verified"}
                      </p>
                    )}
                  </div>
                )}

                {!verdict && (
                  <button
                    type="submit"
                    disabled={connecting || !code.trim() || !ownerKey.trim()}
                    className="press mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow transition-opacity disabled:opacity-60"
                  >
                    {connecting ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
                    {connecting ? "Connecting…" : "Connect"}
                  </button>
                )}
              </form>
                </>
              )}
            </section>
          ) : (
            <section className="glass mt-6 flex flex-col rounded-3xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
                  {record?.ready ? (
                    <BadgeCheck className="size-4.5 text-mint-400" />
                  ) : (
                    <AlertTriangle className="size-4.5 text-ember-400" />
                  )}{" "}
                  {record?.ready ? "Taking orders" : "Connected, not orderable yet"}
                </h2>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={disconnecting}
                  className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-chili-500/20 hover:text-chili-300 disabled:opacity-60"
                >
                  {disconnecting ? <RefreshCw className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>

              {/*
                Read-only mirror of the ordering gate. A connection row existing
                is not the same as orders flowing, and this panel used to claim
                "ACTIVE" no matter what the server said.
              */}
              {record?.notReadyReason && (
                <div className="mt-4 rounded-2xl border border-ember-400/25 bg-ember-500/10 p-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-ember-400">
                    <AlertTriangle className="size-4" /> Orders are switched off
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-cream-300">
                    {NOT_READY_COPY[record.notReadyReason] ??
                      "This connection isn't ready to take orders yet."}
                  </p>
                </div>
              )}

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">POS restaurant</dt>
                  <dd className="mt-1.5 font-display text-lg font-bold text-cream-50">
                    {record?.posRestaurantId ?? "—"}
                  </dd>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">Status</dt>
                  <dd
                    className={cn(
                      "mt-1.5 flex items-center gap-1.5 font-display text-lg font-bold",
                      record?.ready ? "text-mint-400" : "text-ember-400",
                    )}
                  >
                    {record?.ready ? (
                      <Check className="size-4" strokeWidth={3} />
                    ) : (
                      <AlertTriangle className="size-4" strokeWidth={3} />
                    )}
                    {STATUS_LABEL[record?.status ?? ""] ?? record?.status ?? "—"}
                  </dd>
                </div>
                {record?.posBranchId && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">Branch</dt>
                    <dd className="mt-1.5 font-mono text-sm font-bold text-cream-50">{record.posBranchId}</dd>
                  </div>
                )}
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">Connected</dt>
                  <dd className="mt-1.5 font-mono text-sm font-bold text-cream-50">
                    {record?.connectedAt ? formatWhen(record.connectedAt) : "—"}
                  </dd>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  {/* `last_sync_at` is written only by an identity push (the claim
                      or a manual connect) - the menu-item webhook passes `sync:
                      null` and orders never touch the column. Labelling it "Last
                      order sync" showed a timestamp on a restaurant that had never
                      taken an order, which is precisely the sort of false claim
                      this health panel must not make. */}
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">Last POS sync</dt>
                  <dd className="mt-1.5 font-mono text-sm font-bold text-cream-50">
                    {record?.lastSyncAt ? formatWhen(record.lastSyncAt) : "Never synced"}
                  </dd>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">POS heartbeat</dt>
                  <dd className="mt-1.5 font-mono text-sm font-bold text-cream-50">
                    {record?.lastHeartbeatAt ? formatWhen(record.lastHeartbeatAt) : "No ping yet"}
                  </dd>
                </div>
              </dl>

              {record?.lastError && (
                <p className="mt-4 rounded-2xl border border-chili-500/25 bg-chili-500/10 p-3.5 text-xs leading-relaxed text-chili-300">
                  <span className="font-bold">Last error:</span> {record.lastError}
                </p>
              )}

              <p className="mt-4 text-xs leading-relaxed text-cream-600">
                Provider: <span className="font-mono font-semibold text-cream-400">{record?.provider ?? "restaurant-ai"}</span>
                {" · "}Gateway id:{" "}
                <span className="font-mono font-semibold text-cream-400">{record?.marketplaceId ?? "—"}</span>
              </p>

              <OwnerKeyPanel />
            </section>
          )}
        </>
      )}

      {!listing && (
        <p className="mt-6 rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center text-xs text-cream-500">
          Load your listing to manage its POS connection.
        </p>
      )}
    </div>
  );
}

/* ------------------------------- owner key -------------------------------- */

/**
 * Rotation is not "recovery": the current key authorises the swap, so an
 * operator who still holds it can move to a new key deliberately (e.g. this
 * device may be shared). If the key is genuinely gone, only ops can restore
 * access, and the copy below says so instead of implying a self-service
 * escape hatch exists.
 */
function OwnerKeyPanel() {
  const { toast } = useToast();
  const [rotating, setRotating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const rotate = async () => {
    setRotating(true);
    try {
      const current = readStoredOwnerKey();
      const d = await json<{ ok: boolean; error?: string; ownerKey?: string }>(
        "/api/partner/owner-key/rotate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Rotation must be proved with the live key, not the (possibly
            // stale) textarea value, or pasting an old key would lock you out.
            "x-owner-key": current ?? "",
          },
        },
      );
      if (!d.ok || !d.ownerKey) {
        toast(d.error ?? "Could not rotate key", { kind: "error" });
        return;
      }
      storeOwnerKey(d.ownerKey);
      setRevealed(d.ownerKey);
      toast("New owner key issued", { sub: "The previous key no longer works." });
    } catch {
      toast("Could not rotate key", { kind: "error" });
    } finally {
      setRotating(false);
    }
  };

  const forget = () => {
    forgetOwnerKey();
    setRevealed(null);
    toast("Key removed from this device", {
      sub: "You'll need the key to load your listing again.",
    });
  };

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">
        <KeyRound className="size-3.5" /> Owner key
      </p>

      {revealed && (
        <div className="mt-2.5 rounded-xl border border-ember-400/25 bg-black/30 p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ember-400">
            New key — shown once
          </p>
          <p className="mt-1.5 break-all font-mono text-sm font-bold text-cream-50">{revealed}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-cream-500">
            Copy it into your password manager now. Saving it on this device alone
            is not enough — clearing site data will take it with it.
          </p>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => void rotate()}
          disabled={rotating}
          className="press flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-60"
        >
          {rotating ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <KeyRound className="size-3.5" />
          )}
          {rotating ? "Rotating…" : "Issue a new key"}
        </button>
        <button
          type="button"
          onClick={forget}
          className="press flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-300 transition-colors hover:bg-chili-500/20 hover:text-chili-300"
        >
          <Unplug className="size-3.5" />
          Forget this device
        </button>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-cream-600">
        This key is saved in this browser, so closing the tab no longer costs you
        access. If you lose it everywhere, contact ops to have it reset — nobody,
        including us, can read the stored copy.
      </p>
    </div>
  );
}