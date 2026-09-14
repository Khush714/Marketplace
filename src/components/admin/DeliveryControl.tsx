"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shortDateTime } from "@/lib/format";
import {
  DELIVERY_MAINLINE,
  DELIVERY_LABELS,
  nextDeliveryMainlineStep,
  isDeliveryTerminal,
  deliveryStatusCanonical,
  type DeliveryStatus,
} from "@/lib/delivery-status";

type Partner = {
  id: number;
  name: string;
  phone: string;
  vehicleType: string;
  status: string;
  active: boolean;
  totalDeliveries: number;
  rating: number;
  notes: string;
};

type DeliveryOrder = {
  reference: string;
  status: string;
  deliveryStatus: string | null;
  total: number;
  customerName: string;
  placedAt: string;
  scheduledFor: string | null;
  assignment: {
    status: string;
    partnerId: number | null;
    partnerName: string | null;
    token: string | null;
  } | null;
};

export function DeliveryControl() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const staleRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([
        fetch("/api/admin/delivery/partners").then((r) => r.json()),
        fetch("/api/admin/delivery/orders").then((r) => r.json()),
      ]);
      if (staleRef.current) return;
      setPartners(Array.isArray(p?.partners) ? p.partners : []);
      // PHASE 32 — ASAp jobs first; scheduled ones bubble up as their window
      // approaches (ascending window).
      const list = Array.isArray(o?.orders) ? o.orders : [];
      setOrders(
        [...list].sort((a, b) => {
          const aw = a.scheduledFor ? new Date(a.scheduledFor).getTime() : Infinity;
          const bw = b.scheduledFor ? new Date(b.scheduledFor).getTime() : Infinity;
          return (a.scheduledFor ? 1 : 0) - (b.scheduledFor ? 1 : 0) || aw - bw;
        }),
      );
      setError(null);
    } catch {
      if (!staleRef.current) setError("Failed to load delivery data.");
    }
  }, []);

  useEffect(() => {
    staleRef.current = false;
    const id = setTimeout(() => void load(), 0);
    return () => {
      staleRef.current = true;
      clearTimeout(id);
    };
  }, [load]);

  const act = useCallback(
    async (key: string, promise: Promise<Response>) => {
      setBusy(key);
      setError(null);
      try {
        const res = await promise;
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!res.ok) {
          setError(data?.error ?? "Request failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const createPartner = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await act("create", fetch("/api/admin/delivery/partners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        phone: fd.get("phone"),
        vehicleType: fd.get("vehicleType") ?? "bike",
        notes: "",
      }),
    }));
    const form = e.currentTarget;
    const first = form.querySelector("input[name='name']") as HTMLInputElement | null;
    if (first) form.reset();
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-400">
          {error}
        </div>
      )}

      {/* ── Live delivery orders / dispatch ─────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold tracking-tight text-white">
          Dispatch queue
        </h2>
        {orders.length === 0 ? (
          <p className="mt-2 text-sm text-white/45">
            No live delivery orders right now.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {orders.map((o) => (
              <li
                key={o.reference}
                className="rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
<div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-white">
                    #{o.reference}
                    <span className="ml-2 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                      {o.deliveryStatus ?? o.status}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-white/45">
                    {o.customerName} · ₹{o.total.toFixed(2)}
                    {o.scheduledFor && (
                      <span
                        title={new Date(o.scheduledFor).toLocaleString()}
                        className="ml-2 inline-flex items-center gap-1 text-sky-400"
                      >
                        <span className="h-1 w-1 rounded-full bg-sky-400" />
                        Sched {shortDateTime(new Date(o.scheduledFor))}
                      </span>
                    )}
                  </p>
                </div>

                  {!o.assignment ? (
                    <AssignSelect
                      orderRef={o.reference}
                      partners={partners}
                      busy={busy === o.reference}
                      onAssign={(ref, partnerId) =>
                        act(
                          ref,
                          fetch(
                            `/api/admin/delivery/orders/${encodeURIComponent(ref)}/assignment`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "assign", partnerId }),
                            },
                          ),
                        )
                      }
                    />
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                      <AssignmentActions
                        reference={o.reference}
                        assignment={o.assignment}
                        busy={busy === o.reference}
                        onAct={(ref, action, body) =>
                          act(
                            ref,
                            fetch(
                              `/api/admin/delivery/orders/${encodeURIComponent(ref)}/assignment`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action, ...body }),
                              },
                            ),
                          )
                        }
                      />
                      {o.assignment.token && (
                        <a
                          href={`/rider/${encodeURIComponent(o.assignment.token)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-xs font-bold text-sky-400 transition-colors hover:bg-sky-400/20"
                        >
                          Rider app ↗
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Rider directory ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold tracking-tight text-white">
          Rider directory
        </h2>
        <form
          onSubmit={createPartner}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-3xl border border-white/8 bg-ink-850 p-4"
        >
          <label className="flex-1 min-w-36">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Name
            </span>
            <input
              name="name"
              required
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-ember-500/50"
              placeholder="Rahul Verma"
            />
          </label>
          <label className="flex-1 min-w-36">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Phone
            </span>
            <input
              name="phone"
              required
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-ember-500/50"
              placeholder="+91 98765 43210"
            />
          </label>
          <label className="min-w-32">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Vehicle
            </span>
            <select
              name="vehicleType"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-ember-500/50"
            >
              <option value="bike">Bike</option>
              <option value="scooter">Scooter</option>
              <option value="car">Car</option>
              <option value="walking">Walking</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy === "create"}
            className="rounded-2xl bg-ember-500 px-4 py-2 text-sm font-bold text-ink-950 transition-colors hover:bg-ember-400 disabled:opacity-60"
          >
            {busy === "create" ? "Adding…" : "Add rider"}
          </button>
        </form>

        {partners.length === 0 ? (
          <p className="mt-2 text-sm text-white/45">
            No riders yet — add your first one above.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {partners.map((p) => (
              <li
                key={p.id}
                className="rounded-3xl border border-white/8 bg-ink-850 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-white">{p.name}</p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      p.active && p.status === "available"
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-400"
                        : p.status === "busy"
                          ? "border-ember-500/25 bg-ember-500/10 text-ember-400"
                          : "border-white/10 bg-white/5 text-white/45"
                    }`}
                  >
                    {p.active ? p.status : "archived"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/45">
                  {p.phone} · {p.vehicleType} · {p.totalDeliveries} deliveries
                </p>
                <div className="mt-2 flex gap-2">
                  {p.active && p.status === "offline" && (
                    <ToggleButton
                      label="Mark available"
                      busy={busy === `p${p.id}`}
                      onClick={() =>
                        act(
                          `p${p.id}`,
                          fetch(`/api/admin/delivery/partners/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: "available" }),
                          }),
                        )
                      }
                    />
                  )}
                  {p.active && p.status === "available" && (
                    <ToggleButton
                      label="Go offline"
                      busy={busy === `p${p.id}`}
                      onClick={() =>
                        act(
                          `p${p.id}`,
                          fetch(`/api/admin/delivery/partners/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: "offline" }),
                          }),
                        )
                      }
                    />
                  )}
                  {p.active && (
                    <ToggleButton
                      label="Archive"
                      busy={busy === `p${p.id}`}
                      onClick={() =>
                        act(
                          `p${p.id}`,
                          fetch(`/api/admin/delivery/partners/${p.id}`, {
                            method: "DELETE",
                          }),
                        )
                      }
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ToggleButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 disabled:opacity-60"
    >
      {busy ? "…" : label}
    </button>
  );
}

function AssignSelect({
  orderRef,
  partners,
  busy,
  onAssign,
}: {
  orderRef: string;
  partners: Partner[];
  busy: boolean;
  onAssign: (ref: string, partnerId: number) => void;
}) {
  const [selected, setSelected] = useState("");
  const available = partners.filter(
    (p) => p.active && p.status === "available",
  );
  if (available.length === 0) {
    return (
      <span className="text-xs font-semibold text-amber-400/70">
        No riders available
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-2xl border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-ember-500/50"
      >
        <option value="">Assign rider…</option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.vehicleType}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected || busy}
        onClick={() => selected && onAssign(orderRef, Number(selected))}
        className="rounded-2xl bg-ember-500 px-3 py-2 text-sm font-bold text-ink-950 transition-colors hover:bg-ember-400 disabled:opacity-60"
      >
        {busy ? "…" : "Assign"}
      </button>
    </div>
  );
}

function AssignmentActions({
  reference,
  assignment,
  busy,
  onAct,
}: {
  reference: string;
  assignment: NonNullable<DeliveryOrder["assignment"]>;
  busy: boolean;
  onAct: (ref: string, action: string, body: object) => void;
}) {
  const canonical = deliveryStatusCanonical(assignment.status);
  const next = nextDeliveryMainlineStep(canonical);
  const label = DELIVERY_LABELS[canonical] ?? assignment.status;
  const terminal = isDeliveryTerminal(canonical);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-xs font-bold text-sky-400">
        {label} {assignment.partnerName ? `· ${assignment.partnerName}` : ""}
      </span>
      {next && (
        <ToggleButton
          label={next === "delivered" ? "Mark delivered" : `Advance → ${DELIVERY_LABELS[next] ?? next}`}
          busy={busy}
          onClick={() => onAct(reference, "advance", { toStatus: next })}
        />
      )}
      {!terminal && (
        <ToggleButton
          label="Unassign"
          busy={busy}
          onClick={() => onAct(reference, "unassign", {})}
        />
      )}
    </div>
  );
}