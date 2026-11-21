"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  ImageOff,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Store,
  Trash2,
  TriangleAlert,
  Utensils,
} from "lucide-react";
import { cn, formatINR } from "@/lib/domain";
import { partnerFetch, RequirePartnerSession, usePartnerSession } from "@/lib/partner-session";
import { useToast } from "@/lib/toast";
import type { PartnerMenuDto, PartnerMenuItemDto, PartnerModifierGroupDto } from "@/lib/types";

type Reply<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Every partner call rides the session; nothing here touches the owner key.
 * `partnerFetch` attaches the CSRF token from the readable cookie, so the session
 * cannot be exercised cross-site even though it travels as a cookie.
 */
async function call<T>(path: string, init: RequestInit = {}): Promise<Reply<T>> {
  const res = await partnerFetch<T>(path, init);
  if (res.ok) return { ...res, ok: true as const };
  return { ok: false, error: res.error };
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none";
const labelCls = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500";
const ghostBtn =
  "press flex items-center justify-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50";

export default function PartnerMenuPage() {
  const { toast } = useToast();
  const session = usePartnerSession();
  const [menu, setMenu] = useState<PartnerMenuDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [groupEditor, setGroupEditor] = useState<number | "new" | null>(null);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      setLoading(true);
      const d = await call<{ menu: PartnerMenuDto }>("/api/partner/menu");
      setLoading(false);
      if (!d.ok) {
        setMenu(null);
        if (!quiet) toast(d.error, { kind: "error" });
        return;
      }
      setMenu(d.menu);
      if (!quiet) toast("Menu loaded", { sub: d.menu.restaurant.name });
    },
    [toast],
  );

  // Load once a session exists. The gate is what decides whether one does: on a
  // fresh sign-in the exchange has already set cookies, so this page just reads
  // the result. A partner who lands here signed out sees the gate instead.
  // Deferred to a macrotask so load()'s setState runs in a callback, not
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (session.status !== "signed-in") return;
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [session.status, load]);

  const run = async <T,>(
    work: () => Promise<Reply<T>>,
    success: { title: string; sub?: string } | null,
  ): Promise<boolean> => {
    const result = await work();
    if (!result.ok) {
      toast(result.error, { kind: "error" });
      return false;
    }
    if (success) toast(success.title, success.sub ? { sub: success.sub } : undefined);
    await load(true);
    return true;
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <Link
        href="/partner"
        className="press inline-flex items-center gap-1.5 text-xs font-semibold text-cream-400 transition-colors hover:text-cream-200"
      >
        <ArrowLeft className="size-3.5" /> Partner home
      </Link>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
        Menu editor
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
        Add dishes and modifier groups straight to your marketplace listing. Anything you write here
        goes live immediately.
      </p>

      <RequirePartnerSession>
        {menu && (
        <div className="mt-7 space-y-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-display text-xl font-bold text-cream-50">
              {menu.restaurant.name}
            </span>
            <Link
              href={`/restaurants/${menu.restaurant.slug}`}
              className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
            >
              <Store className="size-3.5" /> View listing
            </Link>
            {menu.restaurant.posConnected && (
              <span className="rounded-full bg-sky-500/12 px-2.5 py-0.5 text-[11px] font-bold text-sky-300">
                POS connected — its dishes sync alongside yours
              </span>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="press ml-auto inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              Refresh
            </button>
          </div>

          <DishSection
            menu={menu}
            adding={adding}
            setAdding={setAdding}
            busyId={busyId}
            setBusyId={setBusyId}
            run={run}
          />
          <GroupSection
            menu={menu}
            editor={groupEditor}
            setEditor={setGroupEditor}
            busyId={busyId}
            setBusyId={setBusyId}
            run={run}
          />
        </div>
        )}
      </RequirePartnerSession>
    </div>
  );
}

/* -------------------------------- dishes ---------------------------------- */

function DishSection({
  menu,
  adding,
  setAdding,
  busyId,
  setBusyId,
  run,
}: {
  menu: PartnerMenuDto;
  adding: boolean;
  setAdding: (v: boolean) => void;
  busyId: number | "new" | null;
  setBusyId: (v: number | "new" | null) => void;
  run: <T>(work: () => Promise<Reply<T>>, success: { title: string; sub?: string } | null) => Promise<boolean>;
}) {
  const byCategory = useMemo(() => {
    const groups = new Map<string, PartnerMenuItemDto[]>();
    for (const item of menu.items) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [menu.items]);

  return (
    <section className="glass rounded-3xl p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <Utensils className="size-4.5 text-ember-400" /> Dishes
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-cream-400">
            {menu.items.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          className={ghostBtn}
        >
          {adding ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
          {adding ? "Close" : "Add dish"}
        </button>
      </div>

      {adding && (
        <DishForm
          busy={busyId === "new"}
          onCancel={() => setAdding(false)}
          onSubmit={async (payload) => {
            setBusyId("new");
            const ok = await run(
              () =>
                call<{ item: PartnerMenuItemDto }>("/api/partner/menu/items", {
                  method: "POST",
                  body: JSON.stringify(payload),
                }),
              { title: "Dish added", sub: String(payload.name) },
            );
            setBusyId(null);
            if (ok) setAdding(false);
          }}
        />
      )}

      {byCategory.length === 0 && !adding && (
        <p className="mt-5 rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center text-xs text-cream-500">
          No dishes yet. Add your first one to put this listing on the marketplace.
        </p>
      )}

      <div className="mt-5 space-y-5">
        {byCategory.map(([category, items]) => (
          <div key={category}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ember-400">
              {category}
            </p>
            <ul className="mt-2 space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-black/40">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <ImageOff className="absolute inset-0 m-auto size-4 text-cream-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-bold text-cream-50">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          item.isVeg ? "bg-mint-400" : "bg-chili-500",
                        )}
                        title={item.isVeg ? "Vegetarian" : "Non-vegetarian"}
                      />
                      {item.name}
                    </p>
                    <p className="truncate text-xs text-cream-500">
                      {formatINR(item.priceCents)}
                      {item.description ? ` · ${item.description}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-cream-600">
                      {item.posSynced ? "POS-synced" : "Added by you"}
                      {item.modifierGroupIds.length > 0
                        ? ` · ${item.modifierGroupIds.length} modifier group(s)`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        () =>
                          call<{ item: PartnerMenuItemDto }>(
                            `/api/partner/menu/items/${item.id}`,
                            { method: "PATCH", body: JSON.stringify({ available: !item.available }) },
                          ),
                        { title: item.available ? "Dish hidden" : "Dish available" },
                      )
                    }
                    disabled={busyId === item.id}
                    className={cn(
                      "press rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors",
                      item.available
                        ? "bg-mint-500/12 text-mint-400"
                        : "bg-chili-500/15 text-chili-400",
                    )}
                  >
                    {item.available ? "Available" : "Sold out"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => {
                      if (!window.confirm(`Delete "${item.name}" from your menu?`)) return;
                      setBusyId(item.id);
                      void run(
                        () =>
                          call(`/api/partner/menu/items/${item.id}`, {
                            method: "DELETE",
                          }),
                        { title: "Dish deleted" },
                      ).finally(() => setBusyId(null));
                    }}
                    disabled={busyId === item.id}
                    className="press rounded-lg bg-chili-500/12 p-2 text-chili-400 transition-colors hover:bg-chili-500/20 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

interface DishPayload {
  category: string;
  name: string;
  description: string;
  priceRupees: string;
  imageUrl: string;
  isVeg: boolean;
}

function DishForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: DishPayload) => void;
}) {
  const [f, setF] = useState<DishPayload>({
    category: "",
    name: "",
    description: "",
    priceRupees: "",
    imageUrl: "",
    isVeg: false,
  });
  const set = <K extends keyof DishPayload>(k: K, v: DishPayload[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(f);
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 sm:grid-cols-2">
      <div>
        <label className={labelCls} htmlFor="dish-category">Category</label>
        <input
          id="dish-category"
          value={f.category}
          onChange={(e) => set("category", e.target.value)}
          placeholder="Starters, Mains…"
          required
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="dish-name">Dish name</label>
        <input
          id="dish-name"
          value={f.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Paneer Tikka"
          required
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="dish-price">Price (₹)</label>
        <input
          id="dish-price"
          value={f.priceRupees}
          onChange={(e) => set("priceRupees", e.target.value)}
          placeholder="249"
          inputMode="decimal"
          required
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="dish-image">Image URL <span className="normal-case text-cream-600">(optional)</span></label>
        <input
          id="dish-image"
          value={f.imageUrl}
          onChange={(e) => set("imageUrl", e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls} htmlFor="dish-desc">Description <span className="normal-case text-cream-600">(optional)</span></label>
        <input
          id="dish-desc"
          value={f.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Charred in the tandoor, served with mint chutney"
          className={inputCls}
        />
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-cream-300">
        <input
          type="checkbox"
          checked={f.isVeg}
          onChange={(e) => set("isVeg", e.target.checked)}
          className="size-4 accent-mint-400"
        />
        Vegetarian
      </label>
      <div className="flex gap-2 sm:justify-end">
        <button type="button" onClick={onCancel} className={ghostBtn}>Cancel</button>
        <button
          type="submit"
          disabled={busy}
          className="press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-60"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {busy ? "Saving…" : "Add dish"}
        </button>
      </div>
    </form>
  );
}

/* ----------------------------- modifier groups ---------------------------- */

function GroupSection({
  menu,
  editor,
  setEditor,
  busyId,
  setBusyId,
  run,
}: {
  menu: PartnerMenuDto;
  editor: number | "new" | null;
  setEditor: (v: number | "new" | null) => void;
  busyId: number | "new" | null;
  setBusyId: (v: number | "new" | null) => void;
  run: <T>(work: () => Promise<Reply<T>>, success: { title: string; sub?: string } | null) => Promise<boolean>;
}) {
  return (
    <section className="glass rounded-3xl p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <Layers className="size-4.5 text-ember-400" /> Modifier groups
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-cream-400">
            {menu.modifierGroups.length}
          </span>
        </h2>
        <button type="button" onClick={() => setEditor(editor === "new" ? null : "new")} className={ghostBtn}>
          {editor === "new" ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
          {editor === "new" ? "Close" : "New group"}
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
        Groups are the &quot;choose your size&quot; or &quot;add a topping&quot; steps a customer sees while
        ordering a dish. Link one to a dish from its row.
      </p>

      {editor === "new" && (
        <GroupForm
          busy={busyId === "new"}
          onCancel={() => setEditor(null)}
          onSubmit={async (payload) => {
            setBusyId("new");
            const ok = await run(
              () =>
                call<{ group: PartnerModifierGroupDto }>(
                  "/api/partner/menu/modifier-groups",
                  { method: "POST", body: JSON.stringify(payload) },
                ),
              { title: "Modifier group created", sub: payload.name },
            );
            setBusyId(null);
            if (ok) setEditor(null);
          }}
        />
      )}

      {menu.modifierGroups.length === 0 && editor !== "new" && (
        <p className="mt-5 rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center text-xs text-cream-500">
          No modifier groups yet.
        </p>
      )}

      <ul className="mt-5 space-y-2">
        {menu.modifierGroups.map((group) => (
          <li key={group.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="flex-1 text-sm font-bold text-cream-50">{group.name}</p>
              <span className="text-[11px] font-bold text-cream-500">
                {group.minSelect === group.maxSelect
                  ? `Pick exactly ${group.maxSelect}`
                  : group.maxSelect === 0
                    ? "Optional"
                    : `Pick ${group.minSelect}–${group.maxSelect}`}
                {group.itemCount > 0 ? ` · on ${group.itemCount} dish(es)` : ""}
              </span>
              <button
                type="button"
                onClick={() => setEditor(editor === group.id ? null : group.id)}
                className="press rounded-lg bg-white/8 p-2 text-cream-200 transition-colors hover:bg-white/12"
                aria-label={`Edit ${group.name}`}
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${group.name}`}
                onClick={() => {
                  if (!window.confirm(`Delete the "${group.name}" group and its options?`)) return;
                  setBusyId(group.id);
                  void run(
                    () =>
                      call(`/api/partner/menu/modifier-groups/${group.id}`, {
                        method: "DELETE",
                      }),
                    { title: "Group deleted" },
                  ).finally(() => setBusyId(null));
                }}
                disabled={busyId === group.id}
                className="press rounded-lg bg-chili-500/12 p-2 text-chili-400 transition-colors hover:bg-chili-500/20 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {group.options.map((o) => (
                <li
                  key={o.id}
                  className={cn(
                    "rounded-lg px-2 py-1 text-[11px] font-semibold",
                    o.available ? "bg-white/8 text-cream-300" : "bg-chili-500/12 text-chili-400 line-through",
                  )}
                >
                  {o.name}
                  {o.priceCents > 0 ? ` +${formatINR(o.priceCents)}` : ""}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <LinkGroups menu={menu} run={run} />
    </section>
  );
}

/** Attach or detach groups on a dish. */
function LinkGroups({
  menu,
  run,
}: {
  menu: PartnerMenuDto;
  run: <T>(work: () => Promise<Reply<T>>, success: { title: string; sub?: string } | null) => Promise<boolean>;
}) {
  if (menu.modifierGroups.length === 0 || menu.items.length === 0) return null;
  return (
    <div className="mt-6 space-y-2 border-t border-white/10 pt-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
        Offer a group on a dish
      </p>
      {menu.items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-cream-300">
            {item.name}
          </span>
          {menu.modifierGroups
            .filter((g) => item.modifierGroupIds.includes(g.id))
            .map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() =>
                  void run(
                    () =>
                      call(
                        `/api/partner/menu/items/${item.id}/modifier-groups/${g.id}`,
                        { method: "DELETE" },
                      ),
                    { title: `Removed "${g.name}"`, sub: item.name },
                  )
                }
                className="press flex items-center gap-1 rounded-lg bg-ember-500/12 px-2 py-1 text-[11px] font-semibold text-ember-300 transition-colors hover:bg-ember-500/20"
              >
                {g.name} <TriangleAlert className="size-2.5" />
              </button>
            ))}
          <select
            value=""
            onChange={(e) => {
              const groupId = e.target.value;
              if (!groupId) return;
              void run(
                () =>
                  call(`/api/partner/menu/items/${item.id}/modifier-groups`, {
                    method: "POST",
                    body: JSON.stringify({ groupId: Number(groupId) }),
                  }),
                { title: "Group added to dish" },
              );
            }}
            className={cn(inputCls, "w-auto py-1.5 text-xs")}
          >
            <option value="">Add group…</option>
            {menu.modifierGroups
              .filter((g) => !item.modifierGroupIds.includes(g.id))
              .map((g) => (
                <option key={g.id} value={g.id} className="bg-coal">
                  {g.name}
                </option>
              ))}
          </select>
        </div>
      ))}
    </div>
  );
}

interface GroupPayload {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: Array<{ name: string; priceRupees: string; isVeg: boolean }>;
}

function GroupForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: GroupPayload) => void;
}) {
  const [name, setName] = useState("");
  const [minSelect, setMinSelect] = useState("0");
  const [maxSelect, setMaxSelect] = useState("1");
  const [options, setOptions] = useState([{ name: "", priceRupees: "", isVeg: true }]);

  const setOption = (i: number, patch: Partial<(typeof options)[number]>) =>
    setOptions((p) => p.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, minSelect: Number(minSelect), maxSelect: Number(maxSelect), options });
      }}
      className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-black/25 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className={labelCls} htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Choose a size"
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="group-min">Min picks</label>
          <input
            id="group-min"
            value={minSelect}
            onChange={(e) => setMinSelect(e.target.value)}
            inputMode="numeric"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="group-max">Max picks</label>
          <input
            id="group-max"
            value={maxSelect}
            onChange={(e) => setMaxSelect(e.target.value)}
            inputMode="numeric"
            required
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <p className={labelCls}>Options</p>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={o.name}
                onChange={(e) => setOption(i, { name: e.target.value })}
                placeholder="Regular"
                required
                className={cn(inputCls, "min-w-0 flex-1")}
              />
              <input
                value={o.priceRupees}
                onChange={(e) => setOption(i, { priceRupees: e.target.value })}
                placeholder="+₹40"
                inputMode="decimal"
                className={cn(inputCls, "w-28 shrink-0")}
              />
              <button
                type="button"
                onClick={() => setOptions((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))}
                aria-label="Remove option"
                className="press rounded-lg bg-chili-500/12 p-2 text-chili-400 transition-colors hover:bg-chili-500/20"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOptions((p) => [...p, { name: "", priceRupees: "", isVeg: true }])}
          className={cn(ghostBtn, "mt-2")}
        >
          <Plus className="size-3.5" /> Add option
        </button>
      </div>

      <div className="flex gap-2 sm:justify-end">
        <button type="button" onClick={onCancel} className={ghostBtn}>Cancel</button>
        <button
          type="submit"
          disabled={busy}
          className="press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-60"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {busy ? "Saving…" : "Create group"}
        </button>
      </div>
    </form>
  );
}
