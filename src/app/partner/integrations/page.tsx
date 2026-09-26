"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import {
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

interface IntegrationRecord {
  restaurantId: number;
  marketplaceId: string;
  provider: string;
  posRestaurantId: string | null;
  posBranchId: string | null;
  posOutletId: string | null;
  status: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface ManageRestaurant {
  id: number;
  name: string;
  slug: string;
  cuisines: string[];
  locality: string;
  isActive: boolean;
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

  const [ownerKey, setOwnerKey] = useState("");
  const [listing, setListing] = useState<ManageRestaurant | null>(null);
  const [record, setRecord] = useState<IntegrationRecord | null>(null);
  const [loading, setLoading] = useState(false);

  // Connect flow state
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; detected?: PosIdentity; error?: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(
    async (key: string) => {
      const trimmed = key.trim();
      if (!trimmed) return;
      setLoading(true);
      try {
        const d = await json<{
          ok: boolean;
          error?: string;
          restaurant?: ManageRestaurant;
          record?: IntegrationRecord | null;
        }>(`/api/partner/integrations`, { headers: { "x-owner-key": trimmed } });
        if (!d.ok || !d.restaurant) {
          setListing(null);
          setRecord(null);
          toast(d.error ?? "Invalid owner key", { kind: "error" });
          return;
        }
        setOwnerKey(trimmed);
        setListing(d.restaurant);
        setRecord(d.record ?? null);
        toast("Listing loaded", { sub: d.restaurant.name });
      } catch {
        toast("Could not load listing", { kind: "error" });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const verify = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setVerifying(true);
    setVerdict(null);
    try {
      const d = await json<{ ok: boolean; detected?: PosIdentity; error?: string }>(
        "/api/partner/integrations/verify",
        {
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
      const d = await json<{ ok: boolean; error?: string; record?: IntegrationRecord; already?: boolean }>(
        "/api/partner/integrations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerKey, connection_code: code.trim() }),
        },
      );
      if (!d.ok || !d.record) {
        toast(d.error ?? "Could not connect the POS", { kind: "error" });
        return;
      }
      setRecord(d.record);
      setCode("");
      setVerdict(null);
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
      const d = await json<{ ok: boolean; error?: string; record?: IntegrationRecord }>(
        "/api/partner/integrations",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerKey }),
        },
      );
      if (!d.ok || !d.record) {
        toast(d.error ?? "Could not disconnect", { kind: "error" });
        return;
      }
      setRecord(d.record);
      toast("POS disconnected", { kind: "info", sub: "Orders, identity and audit history are preserved" });
    } catch {
      toast("Disconnect failed", { kind: "error" });
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = record && record.status === "active";

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
        <Link
          href="/partner"
          className="press shrink-0 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
        >
          Back to partner tools
        </Link>
      </div>

      {/* Owner key */}
      <section className="glass mt-8 flex flex-col rounded-3xl p-5 md:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <KeyRound className="size-4.5 text-ember-400" /> Your listing
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
          Enter the owner key you received when connecting your restaurant.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={ownerKey}
            onChange={(e) => setOwnerKey(e.target.value)}
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
                connected ? "bg-mint-500/12 text-mint-400" : "bg-white/8 text-cream-300",
              )}
            >
              {connected ? (
                <>
                  <BadgeCheck className="size-3" strokeWidth={2.6} /> POS connected
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
              <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
                Ask your POS to generate a connection code, then paste it here. The code is verified
                against the POS before anything is consumed.
              </p>

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
                      }}
                      placeholder="MKT-3F8A-9C21"
                      className={cn(inputCls, "font-mono font-bold uppercase tabular-nums")}
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
                      verdict.ok
                        ? "border-mint-400/25 bg-mint-500/10"
                        : "border-chili-500/25 bg-chili-500/8",
                    )}
                  >
                    {verdict.ok && verdict.detected ? (
                      <>
                        <p className="flex items-center gap-1.5 text-sm font-bold text-mint-400">
                          <BadgeCheck className="size-4" /> POS detected
                        </p>
                        <div className="mt-2 space-y-1.5 text-sm text-cream-200">
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
            </section>
          ) : (
            <section className="glass mt-6 flex flex-col rounded-3xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
                  <BadgeCheck className="size-4.5 text-mint-400" /> Connected
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

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">POS restaurant</dt>
                  <dd className="mt-1.5 font-display text-lg font-bold text-cream-50">
                    {record?.posRestaurantId ?? "—"}
                  </dd>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-cream-500">Status</dt>
                  <dd className="mt-1.5 flex items-center gap-1.5 font-display text-lg font-bold text-mint-400">
                    <Check className="size-4" strokeWidth={3} /> ACTIVE
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
              </dl>

              <p className="mt-4 text-xs leading-relaxed text-cream-600">
                Provider: <span className="font-mono font-semibold text-cream-400">{record?.provider ?? "restaurant-ai"}</span>
                {" · "}Gateway id:{" "}
                <span className="font-mono font-semibold text-cream-400">{record?.marketplaceId ?? "—"}</span>
              </p>
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