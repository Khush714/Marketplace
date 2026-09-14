"use client";

import { useCallback, useEffect, useState } from "react";

type ConnectionState = {
  restaurantId: string;
  restaurantName: string;
  connectionCode: string;
  status: string;
  provider: string;
};

type Props = {
  restaurantDbId: number;
  restaurantName: string;
  marketplaceId: string;
  currentStatus: string;
  onClose: () => void;
  onStatusChange?: (status: string) => void;
};

const STATUS_INFO: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  disconnected: { label: "Not Connected", color: "text-white/40", bg: "bg-white/5" },
  connecting: { label: "Waiting for POS authorization…", color: "text-amber-400", bg: "bg-amber-500/10" },
  connected: { label: "Connected", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  error: { label: "Connection Error", color: "text-rose-400", bg: "bg-rose-500/10" },
  disabled: { label: "Disabled", color: "text-white/30", bg: "bg-white/5" },
};

export function ConnectRestaurantDialog({
  restaurantDbId,
  restaurantName,
  marketplaceId,
  currentStatus,
  onClose,
  onStatusChange,
}: Props) {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeStatus = state?.status || currentStatus;
  const info = STATUS_INFO[activeStatus] || STATUS_INFO.disconnected;

  const reportStatus = useCallback(
    (status: string) => onStatusChange?.(status),
    [onStatusChange],
  );

  // On mount, load the existing connection record so a restaurant already in
  // "connecting" shows its previously generated code.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/restaurants/${restaurantDbId}/connection`,
        );
        const data = await res.json();
        const row = data.connection;
        if (!row) return;
        let config: Record<string, unknown> = {};
        try {
          config = row.config ? JSON.parse(row.config) : {};
        } catch {
          config = {};
        }
        setState({
          restaurantId: typeof config.marketplaceId === "string" ? config.marketplaceId : "",
          restaurantName,
          connectionCode:
            typeof config.connectionCode === "string"
              ? config.connectionCode
              : "",
          status: row.status ?? currentStatus,
          provider: row.provider ?? "",
        });
      } catch {
        // No existing record — leave disconnected state as-is.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantDbId]);

  const initiateConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/restaurants/${restaurantDbId}/connection/initiate`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to initiate connection");
        return;
      }
      setState(data.connection);
      reportStatus(data.connection.status);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }, [restaurantDbId, reportStatus]);

  // Poll for status changes while in "connecting" state
  useEffect(() => {
    if (activeStatus !== "connecting") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/admin/restaurants/${restaurantDbId}/connection`,
        );
        const data = await res.json();
        if (data.connection?.status && data.connection.status !== "connecting") {
          setState((prev) =>
            prev ? { ...prev, status: data.connection.status } : prev,
          );
          reportStatus(data.connection.status);
        }
      } catch {
        // Silently ignore poll errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeStatus, restaurantDbId, reportStatus]);

  function copyCode() {
    if (!state) return;
    navigator.clipboard.writeText(state.connectionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
          <h2 className="text-lg font-bold text-white">Connect RestaurantAI</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/40 transition hover:bg-white/5 hover:text-white/70"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {/* Restaurant info */}
          <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
            <p className="text-sm font-semibold text-white">{restaurantName}</p>
            <p className="mt-0.5 text-xs text-white/40">
              Marketplace ID: {marketplaceId}
            </p>
          </div>

          {/* Status */}
          <div className={`mt-4 rounded-2xl border border-white/8 ${info.bg} px-4 py-3`}>
            <div className="flex items-center gap-2">
              {activeStatus === "connecting" && (
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              )}
              {activeStatus === "connected" && (
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
              )}
              {activeStatus === "disconnected" && (
                <span className="h-2 w-2 rounded-full bg-white/20" />
              )}
              {activeStatus === "error" && (
                <span className="h-2 w-2 rounded-full bg-rose-400" />
              )}
              <span className={`text-sm font-medium ${info.color}`}>
                {info.label}
              </span>
            </div>
          </div>

          {/* Connection code — only show when connecting */}
          {activeStatus === "connecting" && state && (
            <div className="mt-4">
              <p className="text-xs font-medium text-white/45">
                Connection Code
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-lg font-bold tracking-widest text-ember-400">
                  {state.connectionCode}
                </div>
                <button
                  onClick={copyCode}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80"
                  title="Copy code"
                >
                  {copied ? (
                    <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-white/35">
                Enter this code in the RestaurantAI POS to complete the connection.
              </p>
            </div>
          )}

          {/* Connected success */}
          {activeStatus === "connected" && (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
              <p className="text-sm font-medium text-emerald-400">
                POS authorized successfully
              </p>
              <p className="mt-1 text-xs text-emerald-400/60">
                This restaurant is now connected to RestaurantAI.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-white/8 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/60 transition hover:bg-white/10"
          >
            Close
          </button>
          {activeStatus === "disconnected" && (
            <button
              onClick={initiateConnection}
              disabled={loading}
              className="rounded-xl bg-ember-500 px-5 py-2 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? "Generating code..." : "Connect RestaurantAI"}
            </button>
          )}
          {activeStatus === "connecting" && (
            <button
              onClick={initiateConnection}
              disabled={loading}
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 transition hover:bg-amber-500/20"
            >
              Generate new code
            </button>
          )}
          {activeStatus === "error" && (
            <button
              onClick={initiateConnection}
              disabled={loading}
              className="rounded-xl bg-ember-500 px-5 py-2 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? "Retrying..." : "Retry connection"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
