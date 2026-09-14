"use client";

type Props = {
  provider: string;
  status: string;
};

const STYLES: Record<string, { dot: string; text: string; label: string }> = {
  connected: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    label: "Connected",
  },
  connecting: {
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-400",
    label: "Connecting",
  },
  error: {
    dot: "bg-rose-400",
    text: "text-rose-400",
    label: "Error",
  },
  disabled: {
    dot: "bg-white/20",
    text: "text-white/30",
    label: "Disabled",
  },
  disconnected: {
    dot: "bg-white/20",
    text: "text-white/30",
    label: "Not Connected",
  },
  unknown: {
    dot: "bg-white/20",
    text: "text-white/30",
    label: "Unknown",
  },
};

const PROVIDER_LABELS: Record<string, string> = {
  restaurantai: "RestaurantAI",
  pos_openapi: "POS (OpenAPI)",
  manual: "Manual",
  external: "External",
};

export function ConnectionBadge({ provider, status }: Props) {
  const style = STYLES[status] || STYLES.unknown;
  const providerLabel = PROVIDER_LABELS[provider] || provider;

  return (
    <div className="hidden shrink-0 items-center gap-2 sm:flex">
      <div className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1">
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        <span className={`text-[11px] font-medium ${style.text}`}>
          {style.label}
        </span>
      </div>
      <span className="text-[11px] text-white/25">{providerLabel}</span>
    </div>
  );
}
