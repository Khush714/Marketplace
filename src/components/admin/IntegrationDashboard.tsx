"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/format";

type Integration = {
  restaurantId: number;
  restaurantName: string;
  restaurantSlug: string;
  integrationId: number | null;
  provider: string;
  status: string;
  healthStatus: string;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  connectedAt: string | null;
  lastError: string;
  hasApiKey: boolean;
  apiKeyPrefix: string;
  webhookFailureCount: number;
  totalOrders: number;
  lastOrderReference: string | null;
};

type Props = {
  integrations: Integration[];
};

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  connected: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Connected",
  },
  connecting: {
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Connecting",
  },
  error: {
    dot: "bg-rose-400",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    label: "Error",
  },
  disabled: {
    dot: "bg-white/20",
    text: "text-white/30",
    bg: "bg-white/5",
    label: "Disabled",
  },
  disconnected: {
    dot: "bg-white/20",
    text: "text-white/30",
    bg: "bg-white/5",
    label: "Not Connected",
  },
};

const PROVIDER_LABELS: Record<string, string> = {
  restaurantai: "RestaurantAI",
  pos_openapi: "POS (OpenAPI)",
  manual: "\u2014",
  external: "External",
};

// PHASE 19 — live health reported by the integration itself (health.ping /
// menu.updated webhooks write these values), separate from the derived checks.
const HEALTH_STYLES: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  healthy: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Healthy",
  },
  degraded: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Degraded",
  },
  down: {
    dot: "bg-rose-400",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    label: "Down",
  },
  unknown: {
    dot: "bg-white/20",
    text: "text-white/30",
    bg: "bg-white/5",
    label: "Unknown",
  },
};

const HEALTH_CHECKS: { label: string; ok: (i: Integration) => boolean }[] = [
  {
    label: "Connection",
    ok: (i) => i.status === "connected",
  },
  {
    label: "Authentication",
    ok: (i) => i.hasApiKey,
  },
  {
    label: "Menu Sync",
    ok: (i) => i.status === "connected" && i.lastSyncAt !== null,
  },
  {
    label: "Order Sync",
    ok: (i) => i.totalOrders > 0,
  },
  {
    label: "Webhooks",
    ok: (i) => i.webhookFailureCount === 0 && i.status === "connected",
  },
];

export function IntegrationDashboard({ integrations }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const connected = integrations.filter((i) => i.status === "connected").length;
  const errors = integrations.filter((i) => i.status === "error").length;
  const totalFailures = integrations.reduce((s, i) => s + i.webhookFailureCount, 0);

  return (
    <div className="mt-6 space-y-6">
      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Restaurants" value={integrations.length} />
        <KpiCard label="Connected" value={connected} tone="emerald" />
        <KpiCard label="Errors" value={errors} tone="rose" />
        <KpiCard label="Webhook Failures" value={totalFailures} tone={totalFailures > 0 ? "rose" : undefined} />
      </div>

      {/* ── Restaurant table ──────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-ink-850">
        <div className="border-b border-white/6 bg-white/5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white/40">
          Restaurant Integrations
        </div>
        <ul className="divide-y divide-white/6">
          {integrations.length === 0 && (
            <li className="p-8 text-center text-sm text-white/45">
              No restaurants found.
            </li>
          )}
          {integrations.map((i) => {
            const s = STATUS_STYLES[i.status] || STATUS_STYLES.disconnected;
            const isOpen = expanded === i.restaurantId;

            return (
              <li key={i.restaurantId}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : i.restaurantId)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">
                      {i.restaurantName}
                    </p>
                    <p className="mt-0.5 text-xs text-white/35">
                      {PROVIDER_LABELS[i.provider] || i.provider}
                      {i.lastOrderReference
                        ? ` \u00b7 Last order: ${i.lastOrderReference}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full ${s.bg} px-2.5 py-1 text-[11px] font-medium ${s.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {s.label}
                    </span>
                    <svg
                      className={`h-4 w-4 text-white/25 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </button>

                {/* ── Expanded detail panel ──────────────────────────────── */}
                {isOpen && (
                  <div className="border-t border-white/6 bg-white/[0.015] px-4 py-4">
                    {/* Health checks */}
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                      Integration Health
                    </p>
                    {(() => {
                      const h = HEALTH_STYLES[i.healthStatus] || HEALTH_STYLES.unknown;
                      return (
                        <span className={`mb-3 inline-flex items-center gap-1.5 rounded-full ${h.bg} px-2.5 py-1 text-[11px] font-medium ${h.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${h.dot}`} />
                          {h.label}
                        </span>
                      );
                    })()}
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {HEALTH_CHECKS.map((hc) => {
                        const ok = hc.ok(i);
                        return (
                          <div
                            key={hc.label}
                            className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
                          >
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                ok
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : "bg-rose-500/15 text-rose-400"
                              }`}
                            >
                              {ok ? "\u2713" : "\u2717"}
                            </span>
                            <span className="text-xs text-white/70">
                              {hc.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Metrics row */}
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <MetricCard
                        label="Last Order"
                        value={i.lastOrderReference ?? "\u2014"}
                      />
                      <MetricCard
                        label="Last Sync"
                        value={i.lastSyncAt ? timeAgo(new Date(i.lastSyncAt).getTime()) : "Never"}
                      />
                      <MetricCard
                        label="Last Success"
                        value={i.lastSuccessAt ? timeAgo(new Date(i.lastSuccessAt).getTime()) : "Never"}
                        tone={i.lastSuccessAt ? "emerald" : undefined}
                      />
                      <MetricCard
                        label="Webhook Failures"
                        value={String(i.webhookFailureCount)}
                        tone={i.webhookFailureCount > 0 ? "rose" : undefined}
                      />
                      <MetricCard
                        label="Total Orders"
                        value={String(i.totalOrders)}
                      />
                    </div>

                    {/* Error banner */}
                    {i.lastError && (
                      <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400/70">
                          Last Error
                        </p>
                        <p className="mt-0.5 truncate text-xs text-rose-300/80">
                          {i.lastError}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "rose"
        ? "text-rose-400"
        : tone === "amber"
          ? "text-amber-400"
          : "text-white";
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-850 p-3">
      <p className="text-[11px] font-medium text-white/40">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "rose" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "rose"
        ? "text-rose-400"
        : tone === "amber"
          ? "text-amber-400"
          : "text-white";
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] font-medium text-white/35">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
