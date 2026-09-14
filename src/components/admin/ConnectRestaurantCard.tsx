"use client";

import { useState } from "react";
import { ConnectRestaurantDialog } from "./ConnectRestaurantDialog";

const PROVIDER_LABELS: Record<string, string> = {
  restaurantai: "RestaurantAI",
  pos_openapi: "POS (OpenAPI)",
  manual: "Manual",
  external: "External",
};

const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  connected: { dot: "bg-emerald-400", text: "text-emerald-400", label: "Connected" },
  connecting: { dot: "bg-amber-400 animate-pulse", text: "text-amber-400", label: "Connecting" },
  error: { dot: "bg-rose-400", text: "text-rose-400", label: "Error" },
  disabled: { dot: "bg-white/20", text: "text-white/30", label: "Disabled" },
  disconnected: { dot: "bg-white/20", text: "text-white/30", label: "Not Connected" },
};

type Props = {
  restaurantDbId: number;
  restaurantName: string;
  marketplaceId: string;
  provider: string;
  status: string;
};

export function ConnectRestaurantCard({
  restaurantDbId,
  restaurantName,
  marketplaceId,
  provider,
  status,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);

  const style = STATUS_STYLES[currentStatus] || STATUS_STYLES.disconnected;
  const providerLabel = PROVIDER_LABELS[provider] || provider;

  return (
    <>
      <div className="rounded-2xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">RestaurantAI</p>
            <p className="mt-0.5 text-xs text-white/45">
              Connect this restaurant&apos;s POS to receive and fulfill
              marketplace orders automatically.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1">
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              <span className={`text-[11px] font-medium ${style.text}`}>
                {style.label}
              </span>
            </div>
            <span className="text-[11px] text-white/25">{providerLabel}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {currentStatus === "disconnected" && (
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-2xl bg-ember-500 px-4 py-2 text-xs font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
            >
              Connect RestaurantAI
            </button>
          )}
          {currentStatus === "connecting" && (
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-400 transition hover:bg-amber-500/20"
            >
              View connection code
            </button>
          )}
          {currentStatus === "connected" && (
            <span className="text-xs text-emerald-400/70">
              POS is connected and receiving orders.
            </span>
          )}
          {currentStatus === "error" && (
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-2xl bg-ember-500 px-4 py-2 text-xs font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
            >
              Retry connection
            </button>
          )}
        </div>
      </div>

      {dialogOpen && (
        <ConnectRestaurantDialog
          restaurantDbId={restaurantDbId}
          restaurantName={restaurantName}
          marketplaceId={marketplaceId}
          currentStatus={currentStatus}
          onClose={() => setDialogOpen(false)}
          onStatusChange={(s) => setCurrentStatus(s)}
        />
      )}
    </>
  );
}
