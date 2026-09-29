"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Check,
  Copy,
  Handshake,
  KeyRound,
  MapPin,
  Play,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  Store,
  Trash2,
  TriangleAlert,
  Utensils,
} from "lucide-react";
import { cn, CUISINES, DEFAULT_LOCALITY, LOCALITIES } from "@/lib/domain";
import { storeOwnerKey } from "@/lib/owner-key-store";
import { useToast } from "@/lib/toast";
import type { RestaurantDto, RestaurantManageDto } from "@/lib/types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function PartnerPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">
        <Handshake className="size-3.5" /> For restaurant partners
      </p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
        Connect your kitchen
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-cream-400">
        Marketplace ops mints single-use connection codes. A restaurant enters its code to be
        onboarded onto the platform.
      </p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Link
          href="/partner/menu"
          className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
        >
          <Utensils className="size-3.5" /> Menu editor
        </Link>
        <Link
          href="/partner/integrations"
          className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
        >
          <Handshake className="size-3.5" /> POS integration
        </Link>
        <Link
          href="/ops"
          className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
        >
          <ShieldAlert className="size-3.5" /> Ops console (mint codes)
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ConnectPanel />
        <ManagePanel />
      </div>
    </div>
  );
}

/* ------------------------------- connecting ------------------------------ */

function ConnectPanel() {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [cuisines, setCuisines] = useState("");
  const [locality, setLocality] = useState(DEFAULT_LOCALITY.name);
  const [externalId, setExternalId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<RestaurantDto | null>(null);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setConnected(null);
    setOwnerKey(null);
    try {
      const d = await json<
        { ok: boolean; error?: string; restaurant?: RestaurantDto; ownerKey?: string }
      >("/api/partner/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          tagline,
          cuisines: cuisines.split(",").map((c) => c.trim()).filter(Boolean),
          locality,
          externalId,
          imageUrl,
          heroUrl,
        }),
      });
      if (!d.ok || !d.restaurant || !d.ownerKey) {
        toast(d.error ?? "Could not connect restaurant", { kind: "error" });
        return;
      }
      setConnected(d.restaurant);
      setOwnerKey(d.ownerKey);
      setKeyCopied(false);
      // Cache the key for this tab so the menu editor is one click away — it is
      // never recoverable if the restaurant loses it.
      storeOwnerKey(d.ownerKey);
      toast("Restaurant connected", { sub: `${d.restaurant.name} is now live` });
      setCode("");
      setName("");
      setTagline("");
      setCuisines("");
      setExternalId("");
      setImageUrl("");
      setHeroUrl("");
    } catch {
      toast("Something went wrong", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const copyOwnerKey = async () => {
    if (!ownerKey) return;
    try {
      await navigator.clipboard.writeText(ownerKey);
      setKeyCopied(true);
      toast("Owner key copied — save it somewhere safe");
    } catch {
      toast("Copy failed", { kind: "error" });
    }
  };

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-mint-400/60 focus:outline-none";

  return (
    <section className="glass flex flex-col rounded-3xl p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
        <Store className="size-4.5 text-ember-400" /> Connect your restaurant
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
        Enter the code your marketplace partner gave you, plus a few details, to go live.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            Connection code
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CNX-HD6K2"
            className={cn(inputCls, "font-mono font-bold tabular-nums uppercase")}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            Restaurant name
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spice Route" className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            <KeyRound className="size-3" /> Marketplace store ID <span className="text-chili-400">*</span>
          </label>
          <input
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder="Stable ID for this kitchen (POS/account id)"
            className={inputCls}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-cream-600">
            Unique per kitchen. One store ID can never be onboarded twice.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            Tagline <span className="normal-case text-cream-600">(optional)</span>
          </label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Coastal classics, wood-fired"
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            Cuisines <span className="normal-case text-cream-600">(comma separated)</span>
          </label>
          <input
            value={cuisines}
            onChange={(e) => setCuisines(e.target.value)}
            placeholder="Biryani, North Indian"
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            <MapPin className="size-3" /> Locality
          </label>
          <select value={locality} onChange={(e) => setLocality(e.target.value)} className={inputCls}>
            {LOCALITIES.map((l) => (
              <option key={l.key} value={l.name} className="bg-coal">
                {l.name} · {l.city}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            Image URL <span className="normal-case text-cream-600">(optional)</span>
          </label>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
            className={inputCls}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-cream-600">
            Square card image used in listings and search. Falls back to a
            placeholder until your POS menu syncs.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
            Cover image URL <span className="normal-case text-cream-600">(optional)</span>
          </label>
          <input
            value={heroUrl}
            onChange={(e) => setHeroUrl(e.target.value)}
            placeholder="https://…"
            className={inputCls}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-cream-600">
            Wide banner across the top of your restaurant page.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="press mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow transition-opacity disabled:opacity-60"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {busy ? "Connecting…" : "Connect restaurant"}
        </button>
      </form>

      {connected && (
        <div className="animate-pop-in mt-4 rounded-2xl border border-mint-400/25 bg-mint-500/10 p-4">
          <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-mint-400">
            <BadgeCheck className="size-4" /> {connected.name} is live
          </p>
          <Link
            href="/partner/menu"
            className="press mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2 text-xs font-bold text-white transition-opacity"
          >
            <Utensils className="size-3.5" /> Add your first dish
          </Link>
          <Link
            href={`/restaurants/${connected.slug}`}
            className="press mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            <Store className="size-3.5" /> View restaurant page
          </Link>
          {/*
            The POS handshake lives on /partner/integrations, which now picks the
            owner key up from sessionStorage on its own. Without this link the
            operator finishes onboarding and has no signpost to the connect step.
          */}
          <Link
            href="/partner/integrations"
            className="press mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            <Handshake className="size-3.5" /> Connect your POS
          </Link>

          {ownerKey && (
            <div className="mt-3 rounded-xl border border-ember-400/25 bg-black/25 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ember-400">
                Your owner key — shown once
              </p>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-sm font-bold text-cream-50">
                  {ownerKey}
                </span>
                <button
                  type="button"
                  onClick={copyOwnerKey}
                  className={cn(
                    "press flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    keyCopied ? "bg-ember-500/20 text-ember-300" : "bg-white/8 text-cream-200 hover:bg-white/12",
                  )}
                >
                  {keyCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {keyCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-cream-500">
                Proves ownership of this listing. Save it now — it cannot be recovered later.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* --------------------------------- manage -------------------------------- */

interface ProfileDraft {
  name: string;
  tagline: string;
  cuisines: string;
  locality: string;
  imageUrl: string;
  heroUrl: string;
  pureVeg: boolean;
}

function ManagePanel() {
  const { toast } = useToast();
  const [ownerKey, setOwnerKey] = useState("");
  const [restaurant, setRestaurant] = useState<RestaurantManageDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = async (key = ownerKey) => {
    const trimmed = key.trim();
    setLoading(true);
    try {
      const d = await json<{ ok: boolean; error?: string; restaurant?: RestaurantManageDto }>(
        `/api/partner/restaurant`,
        { headers: { "x-owner-key": trimmed } },
      );
      if (!d.ok || !d.restaurant) {
        setRestaurant(null);
        toast(d.error ?? "Invalid owner key", { kind: "error" });
        return;
      }
      setRestaurant(d.restaurant);
      setOwnerKey(trimmed);
      setProfile({
        name: d.restaurant.name,
        tagline: d.restaurant.tagline,
        cuisines: d.restaurant.cuisines.join(", "),
        locality: d.restaurant.locality,
        imageUrl: d.restaurant.imageUrl,
        heroUrl: d.restaurant.heroUrl,
        pureVeg: d.restaurant.pureVeg,
      });
      // Remember the verified key for this tab so /partner/menu opens straight
      // into the editor — the key is unrecoverable if it is ever lost.
      storeOwnerKey(trimmed);
      setConfirmName("");
      toast("Restaurant loaded", { sub: d.restaurant.name });
    } catch {
      toast("Could not load restaurant", { kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    if (!restaurant) return;
    const next = !restaurant.isActive;
    setToggling(true);
    try {
      const d = await json<{ ok: boolean; error?: string; restaurant?: RestaurantManageDto }>(
        "/api/partner/restaurant",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerKey, active: next }),
        },
      );
      if (!d.ok || !d.restaurant) {
        toast(d.error ?? "Update failed", { kind: "error" });
        return;
      }
      setRestaurant(d.restaurant);
      toast(next ? "Restaurant is back online" : "Restaurant paused", {
        sub: next ? d.restaurant.name : "Hidden from browsing and new orders blocked",
      });
    } catch {
      toast("Update failed", { kind: "error" });
    } finally {
      setToggling(false);
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      const d = await json<{ ok: boolean; error?: string; restaurant?: RestaurantManageDto }>(
        "/api/partner/restaurant",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerKey,
            profile: {
              name: profile.name,
              tagline: profile.tagline,
              cuisines: profile.cuisines.split(",").map((c) => c.trim()).filter(Boolean),
              locality: profile.locality,
              imageUrl: profile.imageUrl,
              heroUrl: profile.heroUrl,
              pureVeg: profile.pureVeg,
            },
          }),
        },
      );
      if (!d.ok || !d.restaurant) {
        toast(d.error ?? "Could not save your listing", { kind: "error" });
        return;
      }
      setRestaurant(d.restaurant);
      setConfirmName("");
      toast("Listing updated", { sub: "Your changes are live in the marketplace" });
    } catch {
      toast("Could not save your listing", { kind: "error" });
    } finally {
      setSavingProfile(false);
    }
  };

  const remove = async () => {
    if (!restaurant) return;
    setDeleting(true);
    try {
      const d = await json<{ ok: boolean; error?: string; restaurantName?: string }>(
        "/api/partner/restaurant",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerKey, confirmName }),
        },
      );
      if (!d.ok) {
        toast(d.error ?? "Delete failed", { kind: "error" });
        return;
      }
      toast(`${d.restaurantName} deleted`, {
        kind: "info",
        sub: "Listing, menu and order history removed",
      });
      setRestaurant(null);
      setConfirmName("");
      setOwnerKey("");
    } catch {
      toast("Delete failed", { kind: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const canDelete =
    !!restaurant && confirmName.trim().toLowerCase() === restaurant.name.toLowerCase();
  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none";

  return (
    <section className="glass mt-6 flex flex-col rounded-3xl p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-cream-50">
        <KeyRound className="size-4.5 text-ember-400" /> Manage your restaurant
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-cream-500">
        Enter the owner key you received when connecting to pause, resume or permanently remove your
        listing.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
          placeholder="Paste your owner key"
          className={cn(inputCls, "flex-1 font-mono font-bold")}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !ownerKey.trim()}
          className="press flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white shadow-glow transition-opacity disabled:opacity-60"
        >
          {loading ? <RefreshCw className="size-4 animate-spin" /> : <Store className="size-4" />}
          {loading ? "Loading…" : "Load listing"}
        </button>
      </div>

      {restaurant && profile && (
        <div className="animate-pop-in mt-5 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-bold text-cream-50">{restaurant.name}</span>
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                  restaurant.isActive
                    ? "bg-mint-500/12 text-mint-400"
                    : "bg-chili-500/15 text-chili-400",
                )}
              >
                {restaurant.isActive ? (
                  <>
                    <Play className="size-3" strokeWidth={2.6} /> Active
                  </>
                ) : (
                  <>
                    <Power className="size-3" strokeWidth={2.6} /> Paused
                  </>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-cream-500">
              {restaurant.cuisines.join(" · ")} · {restaurant.locality} ·{" "}
              {restaurant.deliveryMinutes} min
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void toggle()}
                disabled={toggling}
                className={cn(
                  "press flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors disabled:opacity-60",
                  restaurant.isActive
                    ? "bg-white/8 text-cream-200 hover:bg-white/12"
                    : "bg-gradient-to-b from-mint-400 to-mint-600 text-emerald-950",
                )}
              >
                {toggling ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : restaurant.isActive ? (
                  <Power className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {toggling
                  ? "Updating…"
                  : restaurant.isActive
                    ? "Pause restaurant"
                    : "Bring back online"}
              </button>
              <Link
                href="/partner/menu"
                className="press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2 text-xs font-bold text-white transition-opacity"
              >
                <Utensils className="size-3.5" /> Edit menu
              </Link>
              <Link
                href={`/restaurants/${restaurant.slug}`}
                className="press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
              >
                <Store className="size-3.5" /> View listing
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-ember-400">
              Listing details
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-cream-500">
              Onboarding is one shot, so fix anything that was wrong here. Your
              address and distance are set by the marketplace, not editable.
            </p>
            <div className="mt-3.5 space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                  Restaurant name
                </label>
                <input
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                  Tagline
                </label>
                <input
                  value={profile.tagline}
                  onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
                  placeholder="e.g. Coastal classics, wood-fired"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                  Cuisines <span className="normal-case text-cream-600">(comma separated)</span>
                </label>
                <input
                  value={profile.cuisines}
                  onChange={(e) => setProfile({ ...profile, cuisines: e.target.value })}
                  className={inputCls}
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-cream-600">
                  Must match the marketplace filter: {CUISINES.join(", ")}.
                  An unrecognised tag makes your listing unfindable by cuisine.
                </p>
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                  <MapPin className="size-3" /> Locality
                </label>
                <select
                  value={profile.locality}
                  onChange={(e) => setProfile({ ...profile, locality: e.target.value })}
                  className={inputCls}
                >
                  {LOCALITIES.map((l) => (
                    <option key={l.key} value={l.name} className="bg-coal">
                      {l.name} · {l.city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                  Image URL
                </label>
                <input
                  value={profile.imageUrl}
                  onChange={(e) => setProfile({ ...profile, imageUrl: e.target.value })}
                  placeholder="https://…"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-cream-500">
                  Cover image URL
                </label>
                <input
                  value={profile.heroUrl}
                  onChange={(e) => setProfile({ ...profile, heroUrl: e.target.value })}
                  placeholder="https://…"
                  className={inputCls}
                />
              </div>
              <label className="flex items-center gap-2.5 text-xs font-semibold text-cream-300">
                <input
                  type="checkbox"
                  checked={profile.pureVeg}
                  onChange={(e) => setProfile({ ...profile, pureVeg: e.target.checked })}
                  className="size-4 accent-mint-400"
                />
                Pure vegetarian kitchen
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={savingProfile || !profile.name.trim()}
                className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-xs font-bold text-white transition-opacity disabled:opacity-60"
              >
                {savingProfile ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {savingProfile ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-chili-500/25 bg-chili-500/8 p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-chili-400">
              <TriangleAlert className="size-3.5" /> Delete permanently
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-cream-500">
              This removes the listing, its menu, connection and all order history for{" "}
              <span className="font-semibold text-cream-300">{restaurant.name}</span>. Type the
              restaurant name to confirm. This cannot be undone.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={`Type "${restaurant.name}"`}
                className={cn(inputCls, "flex-1")}
              />
              <button
                type="button"
                onClick={() => void remove()}
                disabled={!canDelete || deleting}
                className="press flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-chili-500 to-chili-700 px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-50"
              >
                {deleting ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {deleting ? "Deleting…" : "Delete restaurant"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!restaurant && (
        <p className="mt-5 rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-xs text-cream-500">
          No listing loaded yet — enter your owner key to manage your restaurant.
        </p>
      )}
    </section>
  );
}