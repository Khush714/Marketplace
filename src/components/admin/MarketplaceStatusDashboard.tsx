import Link from "next/link";
import { currency } from "@/lib/format";

/**
 * PHASE 16 — Restaurant Admin Marketplace Controls.
 * The "Marketplace" panel lives INSIDE the existing POS/admin — owners don't
 * need a second application to run their storefront.
 */
export function MarketplaceStatusDashboard({
  slug,
  isListed,
  marketplaceStatus,
  acceptOnlineOrders,
  acceptDelivery,
  acceptPickup,
  menuUrl,
  stats,
}: {
  slug: string;
  isListed: boolean;
  marketplaceStatus: string;
  acceptOnlineOrders: boolean;
  acceptDelivery: boolean;
  acceptPickup: boolean;
  menuUrl: string;
  stats: {
    orderCount: number;
    revenue: number;
    liveOrders: number;
    rating: number;
    reviewCount: number;
  };
}) {
  const live = isListed && marketplaceStatus === "live";

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Marketplace
      </h2>

      <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {/* Status + controls */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <p className="text-xs font-medium text-slate-400">Status</p>
            <p
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${
                live
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  live ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
              {live ? "LIVE" : marketplaceStatus.replace("_", " ").toUpperCase()}
            </p>
          </div>

          <MiniToggle label="Visibility" on={isListed} onText="Listed" offText="Hidden" />
          <MiniToggle
            label="Orders"
            on={acceptOnlineOrders}
            onText="Accept online orders"
            offText="Ordering off"
          />
          <MiniToggle label="Pickup" on={acceptPickup} onText="Enabled" offText="Off" />
          <MiniToggle
            label="Delivery"
            on={acceptDelivery}
            onText="Enabled"
            offText="Off"
          />
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Controls live in the Marketplace form below — same admin as the POS,
          no second application.
        </p>

        {/* Menu link status — discovery-only marketplace deep-links here. */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-medium text-slate-400">ORDER ONLINE deep-link</p>
          {menuUrl ? (
            <a
              href={menuUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-1 block truncate font-mono text-xs text-slate-700 hover:text-orange-600"
              title={menuUrl}
            >
              {menuUrl} ↗
            </a>
          ) : (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              Not set — ORDER ONLINE will show &ldquo;MENU LINK NOT SET&rdquo; until you add your POS URL.
            </p>
          )}
        </div>

        {/* KPI grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Reviews"
            value={stats.rating > 0 ? `${stats.rating.toFixed(1)} ★` : "—"}
            sub={`${stats.reviewCount} published`}
          />
          <Kpi
            label="Marketplace Orders"
            value={String(stats.orderCount)}
            sub={`${stats.liveOrders} live right now`}
          />
          <Kpi
            label="Revenue"
            value={currency(stats.revenue)}
            sub="excl. cancelled"
          />
          <div className="flex flex-col gap-2">
            <Link
              href={`/admin/pos/${slug}`}
              className="flex-1 rounded-xl bg-slate-900 px-3 py-2 text-center text-xs font-bold text-white transition hover:bg-slate-800"
            >
              Open POS queue →
            </Link>
            <Link
              href="/admin/reviews"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-center text-xs font-bold text-slate-600 transition hover:border-orange-300 hover:text-orange-600"
            >
              Moderate reviews →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniToggle({
  label,
  on,
  onText,
  offText,
}: {
  label: string;
  on: boolean;
  onText: string;
  offText: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
        <span
          className={`grid h-4 w-4 place-items-center rounded border text-[10px] ${
            on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"
          }`}
        >
          {on ? "✓" : ""}
        </span>
        <span className={on ? "text-slate-800" : "text-slate-400"}>
          {on ? onText : offText}
        </span>
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}
