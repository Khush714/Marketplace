"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  BadgeCheck,
  Check,
  Heart,
  House,
  Leaf,
  LifeBuoy,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  PenLine,
  Phone,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { RestaurantCard } from "@/components/restaurant-card";
import { Rail } from "@/components/rail";
import { useCustomerAccount } from "@/lib/customer-account";
import { cn, formatINR } from "@/lib/domain";
import { avatarEmojiFor, CUSTOMER_AVATAR_OPTIONS } from "@/lib/customer-avatar";
import type { PublicOrder } from "@/lib/order-public";
import { useProfile } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";
import { CustomerAuthDialog } from "@/components/customer-auth-dialog";

interface AccountAddress {
  id: string;
  label: string;
  text: string;
  isDefault: boolean;
}

interface AccountFavorite {
  restaurantId: number;
  slug: string;
  name: string;
}

function formatPhone(phoneE164: string): string {
  const p = phoneE164.trim();
  if (p.startsWith("+91") && p.length === 13) {
    const d = p.slice(3);
    return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  }
  return p || "—";
}

export default function ProfilePage() {
  const profile = useProfile();
  const account = useCustomerAccount();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [favorites, setFavorites] = useState<RestaurantDto[] | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addrLabel, setAddrLabel] = useState("");
  const [addrText, setAddrText] = useState("");
  const [spent, setSpent] = useState<number | null>(null);
  const [accountOrderCount, setAccountOrderCount] = useState<number | null>(null);

  // --- account sign-in flow (popup) ---
  const [authOpen, setAuthOpen] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);

  // --- signed-in account data ---
  const [accountAddresses, setAccountAddresses] = useState<AccountAddress[]>([]);
  const [accountAddressesLoaded, setAccountAddressesLoaded] = useState(false);
  const [accountFavs, setAccountFavs] = useState<AccountFavorite[]>([]);
  const [accountFavsLoaded, setAccountFavsLoaded] = useState(false);
  const [savingAccountName, setSavingAccountName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const signedIn = account.status === "signedIn" && !!account.account;

  const loadAccountAddresses = useCallback(async () => {
    if (!signedIn) return;
    try {
      const res = await account.accountFetch("/api/customer/addresses", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; addresses?: AccountAddress[] } | null;
      setAccountAddresses(data?.ok && Array.isArray(data.addresses) ? data.addresses : []);
    } catch {
      setAccountAddresses([]);
    } finally {
      setAccountAddressesLoaded(true);
    }
  }, [account, signedIn]);

  const loadAccountFavorites = useCallback(async () => {
    if (!signedIn) return;
    try {
      const res = await account.accountFetch("/api/customer/favorites", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; favorites?: AccountFavorite[] } | null;
      setAccountFavs(data?.ok && Array.isArray(data.favorites) ? data.favorites : []);
    } catch {
      setAccountFavs([]);
    } finally {
      setAccountFavsLoaded(true);
    }
  }, [account, signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setAccountAddresses([]);
      setAccountAddressesLoaded(false);
      setAccountFavs([]);
      setAccountFavsLoaded(false);
      return;
    }
    void loadAccountAddresses();
    void loadAccountFavorites();
  }, [signedIn, loadAccountAddresses, loadAccountFavorites]);

  // Favorites cards: server-backed when signed in, local slugs when guest.
  useEffect(() => {
    if (!profile.hydrated) return;
    if (signedIn) {
      if (!accountFavsLoaded) return;
      if (!accountFavs.length) {
        setFavorites([]);
        return;
      }
      const slugs = accountFavs.map((f) => f.slug).join(",");
      fetch(`/api/restaurants?slugs=${encodeURIComponent(slugs)}`)
        .then((r) => r.json())
        .then((d) => setFavorites(d.restaurants ?? []))
        .catch(() => setFavorites([]));
      return;
    }
    if (!profile.favorites.length) {
      setFavorites([]);
    } else {
      fetch(`/api/restaurants?slugs=${encodeURIComponent(profile.favorites.join(","))}`)
        .then((r) => r.json())
        .then((d) => setFavorites(d.restaurants ?? []))
        .catch(() => setFavorites([]));
    }
  }, [profile.hydrated, profile.favorites, signedIn, accountFavs, accountFavsLoaded]);

  /**
   * Account-scoped order stats for signed-in users. Uses the same account-only
   * source as the Orders page to avoid cross-customer device-local leakage.
   */
  useEffect(() => {
    if (!signedIn) {
      setSpent(null);
      setAccountOrderCount(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await fetch("/api/orders", { cache: "no-store", credentials: "same-origin" });
        const d = (r.ok ? await r.json().catch(() => null) : null) as { orders?: PublicOrder[] } | null;
        if (cancelled) return;
        const list = Array.isArray(d?.orders) ? d!.orders : [];
        setAccountOrderCount(list.length);
        setSpent(
          list
            .filter((o) => {
              const paid = o.paymentStatus.toUpperCase();
              const closed = o.status.stageKey === "cancelled" || o.status.stageKey === "rejected";
              if (closed) return false;
              if (paid === "PAID" || paid === "CAPTURED") return true;
              // COD: count non-cancelled/rejected COD orders as spent (cash on fulfilment).
              const isCod = o.paymentMethod.toUpperCase() === "COD";
              if (isCod) return true;
              return false;
            })
            .reduce((n, o) => n + o.totalCents, 0),
        );
      } catch {
        if (!cancelled) {
          setSpent(null);
          setAccountOrderCount(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const onFocus = () => { void load(); };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn]);

  // Keep local profile identity in sync with signed-in account for checkout prefill compatibility.
  useEffect(() => {
    if (!signedIn || !account.account) return;
    const phoneDigits = account.account.phoneE164.replace(/\D/g, "").slice(-10);
    const name = account.account.name?.trim() || profile.name;
    if ((name && name !== profile.name) || (phoneDigits && phoneDigits !== profile.phone)) {
      profile.setIdentity(name || profile.name, phoneDigits || profile.phone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, account.account?.id, account.account?.name, account.account?.phoneE164]);

  const displayName = signedIn ? account.account?.name || "Signed-in customer" : profile.name || "Guest gourmand";
  const displayPhone = signedIn
    ? formatPhone(account.account?.phoneE164 ?? "")
    : profile.phone
      ? `+91 ${profile.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}`
      : "Add your name & number for faster checkout";
  const avatarEmoji = signedIn ? avatarEmojiFor(account.account?.avatar) : null;
  const guestInitial = (profile.name || "?").slice(0, 1).toUpperCase();
  const favoritesCount = signedIn ? accountFavs.length : profile.favorites.length;
  const addressesCount = signedIn ? accountAddresses.length : profile.addresses.length;


  const saveIdentity = async () => {
    if (signedIn) {
      if (savingAccountName) return;
      const name = draftName.trim();
      setSavingAccountName(true);
      try {
        const res = await account.accountFetch("/api/customer/profile", {
          method: "PATCH",
          mutating: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; account?: { name?: string; phoneE164?: string } } | null;
        if (!res.ok || !data?.ok) {
          toast("Could not update profile", { kind: "error" });
          return;
        }
        await account.refresh();
        const phoneDigits = (data.account?.phoneE164 ?? account.account?.phoneE164 ?? "").replace(/\D/g, "").slice(-10);
        profile.setIdentity(data.account?.name ?? name, phoneDigits || profile.phone);
        toast("Profile updated");
        setEditing(false);
      } finally {
        setSavingAccountName(false);
      }
      return;
    }
    profile.setIdentity(draftName.trim() || profile.name, draftPhone.replace(/\D/g, "").slice(-10) || profile.phone);
    toast("Profile updated");
    setEditing(false);
  };

  const saveAvatar = async (avatar: "male" | "female") => {
    if (!signedIn || savingAvatar) return;
    setSavingAvatar(true);
    try {
      const res = await account.accountFetch("/api/customer/profile", {
        method: "PATCH",
        mutating: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || !data?.ok) {
        toast("Could not update avatar", { kind: "error" });
        return;
      }
      await account.refresh();
      toast("Avatar updated");
    } finally {
      setSavingAvatar(false);
    }
  };

  const addAddress = async () => {
    if (addrText.trim().length <= 10) return;
    if (signedIn) {
      const res = await account.accountFetch("/api/customer/addresses", {
        method: "POST",
        mutating: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: addrLabel || "Other", text: addrText.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; address?: AccountAddress } | null;
      if (!res.ok || !data?.ok || !data.address) {
        toast("Could not save address", { kind: "error" });
        return;
      }
      setAccountAddresses((prev) => [data.address!, ...prev]);
      setAddrLabel("");
      setAddrText("");
      setShowAddressForm(false);
      toast("Address saved");
      return;
    }
    profile.addAddress(addrLabel || "Other", addrText.trim());
    setAddrLabel("");
    setAddrText("");
    setShowAddressForm(false);
    toast("Address saved");
  };

  const removeAddress = async (id: string) => {
    if (signedIn) {
      const res = await account.accountFetch(`/api/customer/addresses/${encodeURIComponent(id)}`, {
        method: "DELETE",
        mutating: true,
      });
      if (!res.ok) {
        toast("Could not remove address", { kind: "error" });
        return;
      }
      setAccountAddresses((prev) => prev.filter((a) => a.id !== id));
      toast("Address removed", { kind: "info" });
      return;
    }
    profile.removeAddress(id);
    toast("Address removed", { kind: "info" });
  };

  const removeFavorite = async (slug: string) => {
    if (signedIn) {
      const res = await account.accountFetch(`/api/customer/favorites?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE",
        mutating: true,
      });
      if (!res.ok) {
        toast("Could not remove favorite", { kind: "error" });
        return;
      }
      setAccountFavs((prev) => prev.filter((f) => f.slug !== slug));
      toast("Removed from favorites", { kind: "info" });
      return;
    }
    profile.toggleFavorite(slug);
  };

  const addresses = signedIn ? accountAddresses : profile.addresses;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">Account</p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Profile</h1>

      {/* sign-in / account status */}
      <section className="glass mt-6 overflow-hidden rounded-3xl">
        <div className="relative border-b border-white/8 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(255,158,67,0.18),transparent_55%),radial-gradient(100%_120%_at_100%_0%,rgba(255,90,60,0.14),transparent_55%)] p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-ember-400/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ember-300">
                <Sparkles className="size-3.5" /> Customer account
              </p>
              <h2 className="mt-3 flex items-center gap-2 font-display text-xl font-bold tracking-tight text-cream-50 md:text-2xl">
                <ShieldCheck className="size-5 text-ember-400" /> {signedIn ? "Your account" : "Sign in or create account"}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-cream-400">
                {signedIn
                  ? "Your account keeps orders and saved details across devices. Guest checkout and tracking links still work."
                  : "One quick phone verification to sign in or create your account. Save favorites, addresses, and access linked orders across devices."}
              </p>
            </div>
            {!signedIn && account.status !== "loading" && (
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-cream-300">
                <ShieldCheck className="size-4 text-ember-400" />
                Secure phone verification
              </div>
            )}
          </div>
        </div>

        <div className="p-5 md:p-6">
          {account.status === "loading" ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-5 text-sm text-cream-400">
              <LoaderCircle className="size-5 animate-spin-slow text-ember-400" /> Checking your session…
            </div>
          ) : signedIn ? (
            <div className="space-y-4 animate-fade-in">
              {justSignedIn && (
                <div className="rounded-2xl border border-mint-400/20 bg-mint-500/10 p-4">
                  <p className="flex items-center gap-2 font-display text-base font-bold text-mint-300">
                    <Sparkles className="size-4.5" /> Welcome{account.account?.name ? `, ${account.account.name}` : ""}!
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-cream-300">
                    Your account is ready. You can now save addresses and favorites, and access linked orders across devices.
                  </p>
                  <button type="button" onClick={() => setJustSignedIn(false)} className="press mt-3 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-semibold text-cream-200 hover:bg-white/12">
                    Got it
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-3.5">
                  <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-b from-ember-400/25 to-chili-600/20 text-ember-300 ring-1 ring-ember-400/20">
                    <BadgeCheck className="size-6" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-cream-50">{formatPhone(account.account!.phoneE164)}</p>
                    <p className="text-xs text-cream-500">{account.account!.name ? account.account!.name : "Add your name from profile below"} · Verified account</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await account.logout();
                      // Always clear device-local data on shared browsers.
                      setJustSignedIn(false);
                      profile.clearOrders();
                      profile.resetIdentity();
                      if (ok) toast("Signed out", { kind: "info" });
                      else toast("Signed out on this device", { kind: "info" });
                    }}
                    className="press inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-chili-500/10 hover:text-chili-300"
                  >
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-cream-500">
                Account history shows orders explicitly linked to your account (including across devices). Guest checkout and token/tracking links still work.
              </p>
            </div>
          ) : (
            <div className="animate-fade-in space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
                  <Smartphone className="size-4 text-ember-400" />
                  <p className="mt-2 text-sm font-semibold text-cream-100">Quick verification</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-cream-500">Secure one-time code on your phone.</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
                  <ShieldCheck className="size-4 text-mint-400" />
                  <p className="mt-2 text-sm font-semibold text-cream-100">Secure by design</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-cream-500">OTPs are hashed, time-limited, never logged.</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5">
                  <Sparkles className="size-4 text-ember-300" />
                  <p className="mt-2 text-sm font-semibold text-cream-100">New or returning</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-cream-500">Sign in or create an account automatically.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="press inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-3.5 text-sm font-bold text-white shadow-glow sm:w-auto"
              >
                <LogIn className="size-4" />
                Sign in / Create account
              </button>
              <p className="text-xs text-cream-500">A secure sign-in popup will open for phone verification.</p>
            </div>
          )}
        </div>
      </section>

      {signedIn && (<>
      {/* identity card */}
      <section className="glass mt-7 overflow-hidden rounded-3xl">
        <div className="h-16 bg-[radial-gradient(90%_180%_at_15%_0%,rgba(255,158,67,0.24),transparent_60%),radial-gradient(90%_180%_at_90%_20%,rgba(255,90,60,0.2),transparent_60%)]" />
        <div className="-mt-10 px-5 pb-5 md:px-7 md:pb-7">
          <div className="flex items-end justify-between">
            <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-b from-ember-400 to-chili-600 font-display text-3xl font-bold text-white shadow-glow ring-4 ring-coal">
              {signedIn ? (
                <span className="text-4xl leading-none font-normal" style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }} aria-hidden>{avatarEmoji}</span>
              ) : (
                guestInitial
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  void saveIdentity();
                } else {
                  setDraftName(signedIn ? (account.account?.name ?? "") : profile.name);
                  setDraftPhone(signedIn ? "" : profile.phone);
                  setEditing(true);
                }
              }}
              disabled={savingAccountName}
              className="press flex items-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50"
            >
              {editing ? (savingAccountName ? <LoaderCircle className="size-3.5 animate-spin-slow" /> : <Check className="size-3.5" />) : <PenLine className="size-3.5" />}
              {editing ? "Save" : "Edit"}
            </button>
          </div>

          {editing ? (
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
              />
              {!signedIn && (
                <input
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value.replace(/[^\d ]/g, ""))}
                  placeholder="10-digit mobile"
                  inputMode="tel"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
                />
              )}
              {signedIn && (
                <p className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-cream-400">
                  <Phone className="size-4" /> {formatPhone(account.account?.phoneE164 ?? "")} <span className="text-xs text-cream-600">(verified)</span>
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3.5">
              <h2 className="font-display text-2xl font-bold text-cream-50">{displayName}</h2>
              <p className="mt-0.5 text-sm text-cream-500">{displayPhone}</p>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cream-500">Profile avatar</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CUSTOMER_AVATAR_OPTIONS.map((opt) => {
                const selected = account.account?.avatar === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => void saveAvatar(opt.key)}
                    disabled={savingAvatar}
                    className={cn(
                      "press inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60",
                      selected
                        ? "border-ember-400/50 bg-ember-400/12 text-cream-50"
                        : "border-white/10 bg-white/[0.04] text-cream-300 hover:bg-white/[0.08]",
                    )}
                  >
                    <span className="text-xl leading-none" style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }} aria-hidden>{opt.emoji}</span>
                    <span>{opt.label}</span>
                    {selected && <Check className="size-3.5 text-ember-300" />}
                  </button>
                );
              })}
              {savingAvatar && <LoaderCircle className="size-4 animate-spin-slow text-cream-400 self-center" />}
            </div>
          </div>

          {/* stats */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <StatCard Icon={ReceiptText} label="Orders" value={accountOrderCount === null ? "—" : `${accountOrderCount}`} />
            <StatCard Icon={Heart} label="Favorites" value={`${favoritesCount}`} />
            <StatCard Icon={Wallet} label="Spent" value={spent === null ? "—" : formatINR(spent)} />
          </div>
          {signedIn && (
            <p className="mt-3 text-xs text-cream-500">Order count and spent reflect orders linked to your account.</p>
          )}
        </div>
      </section>

      {/* favorites */}
      <section className="mt-9">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <Heart className="size-4.5 text-chili-400" /> Favorites
        </h2>
        {favorites === null ? (
          <Rail ariaLabel="Loading favorite restaurants">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-48 w-[240px] shrink-0 snap-start rounded-3xl" />
            ))}
          </Rail>
        ) : favorites.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-5 py-8 text-center text-sm text-cream-500">
            {signedIn ? (
              <>No saved favorites on your account yet.</>
            ) : (
              <>
                Tap the <Heart className="inline size-3.5 text-chili-400" /> on any restaurant to pin it here.
              </>
            )}
          </p>
        ) : (
          <Rail ariaLabel="Favorite restaurants">
            {favorites.map((r) => (
              <div key={r.slug} className="relative w-[240px] shrink-0 snap-start">
                <RestaurantCard restaurant={r} className="w-full" />
                {signedIn && (
                  <button
                    type="button"
                    onClick={() => void removeFavorite(r.slug)}
                    className="press mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/8 py-2 text-xs font-semibold text-cream-300 transition-colors hover:bg-chili-500/10 hover:text-chili-300"
                  >
                    <Trash2 className="size-3.5" /> Remove from account
                  </button>
                )}
              </div>
            ))}
          </Rail>
        )}
      </section>

      {/* addresses */}
      <section className="mt-9">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <MapPin className="size-4.5 text-ember-400" /> Addresses
          {signedIn && accountAddressesLoaded && (
            <span className="ml-1 text-xs font-medium text-cream-500">(saved to account)</span>
          )}
        </h2>
        <div className="space-y-2.5">
          {addresses.map((a) => (
            <div key={a.id} className="glass lift flex items-start gap-3.5 rounded-2xl p-4 hover:shadow-lift">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/8 text-cream-300">
                <House className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-cream-50">
                  {a.label}
                  {"isDefault" in a && a.isDefault ? <span className="ml-2 text-[11px] font-semibold text-ember-300">Default</span> : null}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-cream-400">{a.text}</p>
              </div>
              {(signedIn || profile.addresses.length > 1) && (
                <button
                  type="button"
                  aria-label={`Delete ${a.label}`}
                  onClick={() => void removeAddress(String(a.id))}
                  className="press rounded-full p-2 text-cream-500 transition-colors hover:bg-chili-500/10 hover:text-chili-400"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
          {signedIn && !accountAddressesLoaded && (
            <div className="skeleton h-20 rounded-2xl" />
          )}
        </div>

        {showAddressForm ? (
          <div className="animate-fade-in glass mt-3 space-y-2.5 rounded-2xl p-4">
            <input
              value={addrLabel}
              onChange={(e) => setAddrLabel(e.target.value)}
              placeholder="Label — Home, Work…"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
            />
            <textarea
              value={addrText}
              onChange={(e) => setAddrText(e.target.value)}
              placeholder="Flat, street, landmark, city, pincode"
              rows={2}
              className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
            />
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => void addAddress()}
                className="press rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-2.5 text-sm font-bold text-white shadow-glow"
              >
                Save address
              </button>
              <button
                type="button"
                onClick={() => setShowAddressForm(false)}
                className="press rounded-xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-cream-200"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddressForm(true)}
            className="press mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 py-3 text-sm font-semibold text-cream-300 transition-colors hover:border-ember-400/40 hover:text-ember-300"
          >
            <Plus className="size-4" /> Add address
          </button>
        )}
      </section>

      {/* preferences */}
      <section className="mt-9">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <Moon className="size-4.5 text-berry-400" /> Preferences
        </h2>
        <div className="glass divide-y divide-white/6 rounded-3xl">
          <div className="flex items-center justify-between p-4.5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-white/8 text-cream-300"><Moon className="size-4" /></span>
              <div>
                <p className="text-sm font-semibold text-cream-50">Midnight theme</p>
                <p className="text-xs text-cream-500">Always on — designed for the dark</p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-semibold text-mint-400"><BadgeCheck className="size-4" /> On</span>
          </div>
          <div className="flex items-center justify-between p-4.5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-white/8 text-cream-300"><Leaf className="size-4" /></span>
              <div>
                <p className="text-sm font-semibold text-cream-50">Veg mode</p>
                <p className="text-xs text-cream-500">Surface pure-veg kitchens first in browse</p>
              </div>
            </div>
            <Link href="/restaurants?veg=1" className="press rounded-full bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12">
              Browse
            </Link>
          </div>
        </div>
      </section>

      {/* support */}
      <section className="mt-9">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <LifeBuoy className="size-4.5 text-ember-400" /> Help &amp; support
        </h2>
        <div className="glass rounded-3xl p-4.5">
          <p className="text-sm leading-relaxed text-cream-400">
            Need help with an order, payment, or refund? Contact support and include your order code for faster help.
          </p>
          <Link
            href="/contact"
            className="press mt-4 inline-flex items-center rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            Contact support
          </Link>
        </div>
      </section>
      </>)}

      <CustomerAuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={() => {
          setJustSignedIn(true);
          toast("Welcome! You’re signed in.");
        }}
        title="Sign in or create account"
        message="One quick phone verification to sign in or create your account. Save favorites, addresses, and access linked orders across devices."
      />
    </div>
  );
}

function StatCard({ Icon, label, value }: { Icon: typeof ReceiptText; label: string; value: ReactNode }) {
  return (
    <div className={cn("rounded-2xl bg-white/[0.045] px-4 py-3.5 text-left")}>
      <Icon className="size-4 text-ember-400" />
      <p className="mt-2 font-display text-lg font-bold leading-none text-cream-50 tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-cream-500">{label}</p>
    </div>
  );
}
