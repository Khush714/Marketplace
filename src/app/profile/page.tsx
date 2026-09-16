"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Check,
  Heart,
  House,
  Leaf,
  MapPin,
  Moon,
  PenLine,
  Plus,
  ReceiptText,
  Trash2,
  Wallet,
} from "lucide-react";
import { RestaurantCard } from "@/components/restaurant-card";
import { Rail } from "@/components/rail";
import { cn, formatINR } from "@/lib/domain";
import { useProfile } from "@/lib/profile";
import { useToast } from "@/lib/toast";
import type { RestaurantDto } from "@/lib/types";

export default function ProfilePage() {
  const profile = useProfile();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [favorites, setFavorites] = useState<RestaurantDto[] | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addrLabel, setAddrLabel] = useState("");
  const [addrText, setAddrText] = useState("");
  const [spent, setSpent] = useState<number | null>(null);

  useEffect(() => {
    if (!profile.hydrated) return;
    if (!profile.favorites.length) {
      setFavorites([]);
    } else {
      fetch(`/api/restaurants?slugs=${profile.favorites.join(",")}`)
        .then((r) => r.json())
        .then((d) => setFavorites(d.restaurants ?? []))
        .catch(() => setFavorites([]));
    }
  }, [profile.hydrated, profile.favorites]);

  useEffect(() => {
    if (!profile.hydrated || !profile.orderCodes.length) {
      setSpent(0);
      return;
    }
    fetch(`/api/orders?codes=${profile.orderCodes.join(",")}`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.orders ?? []) as Array<{ totalCents: number }>;
        setSpent(list.reduce((n, o) => n + o.totalCents, 0));
      })
      .catch(() => setSpent(null));
  }, [profile.hydrated, profile.orderCodes]);

  const initials = profile.name ? profile.name.slice(0, 1).toUpperCase() : "?";

  return (
    <div className="mx-auto max-w-4xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">Account</p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Profile</h1>

      {/* identity card */}
      <section className="glass mt-7 overflow-hidden rounded-3xl">
        <div className="h-16 bg-[radial-gradient(90%_180%_at_15%_0%,rgba(255,158,67,0.24),transparent_60%),radial-gradient(90%_180%_at_90%_20%,rgba(255,90,60,0.2),transparent_60%)]" />
        <div className="-mt-10 px-5 pb-5 md:px-7 md:pb-7">
          <div className="flex items-end justify-between">
            <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-b from-ember-400 to-chili-600 font-display text-3xl font-bold text-white shadow-glow ring-4 ring-coal">
              {initials}
            </span>
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  profile.setIdentity(draftName.trim() || profile.name, draftPhone.replace(/\D/g, "").slice(-10) || profile.phone);
                  toast("Profile updated");
                } else {
                  setDraftName(profile.name);
                  setDraftPhone(profile.phone);
                }
                setEditing((e) => !e);
              }}
              className="press flex items-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
            >
              {editing ? <Check className="size-3.5" /> : <PenLine className="size-3.5" />}
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
              <input
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value.replace(/[^\d ]/g, ""))}
                placeholder="10-digit mobile"
                inputMode="tel"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none"
              />
            </div>
          ) : (
            <div className="mt-3.5">
              <h2 className="font-display text-2xl font-bold text-cream-50">
                {profile.name || "Guest gourmand"}
              </h2>
              <p className="mt-0.5 text-sm text-cream-500">
                {profile.phone ? `+91 ${profile.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}` : "Add your name & number for faster checkout"}
              </p>
            </div>
          )}

          {/* stats */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <StatCard Icon={ReceiptText} label="Orders" value={`${profile.orderCodes.length}`} />
            <StatCard Icon={Heart} label="Favorites" value={`${profile.favorites.length}`} />
            <StatCard Icon={Wallet} label="Spent" value={spent === null ? "—" : formatINR(spent)} />
          </div>
        </div>
      </section>

      {/* favorites */}
      <section className="mt-9">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <Heart className="size-4.5 text-chili-400" /> Favorites
        </h2>
        {favorites === null ? (
          <div className="flex gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-48 w-[260px] shrink-0 rounded-3xl" />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-5 py-8 text-center text-sm text-cream-500">
            Tap the <Heart className="inline size-3.5 text-chili-400" /> on any restaurant to pin it here.
          </p>
        ) : (
          <Rail ariaLabel="Favorite restaurants">
            {favorites.map((r) => (
              <RestaurantCard key={r.slug} restaurant={r} className="w-[240px] shrink-0 snap-start" />
            ))}
          </Rail>
        )}
      </section>

      {/* addresses */}
      <section className="mt-9">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-cream-50">
          <MapPin className="size-4.5 text-ember-400" /> Addresses
        </h2>
        <div className="space-y-2.5">
          {profile.addresses.map((a) => (
            <div key={a.id} className="glass lift flex items-start gap-3.5 rounded-2xl p-4 hover:shadow-lift">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/8 text-cream-300">
                <House className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-cream-50">{a.label}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-cream-400">{a.text}</p>
              </div>
              {profile.addresses.length > 1 && (
                <button
                  type="button"
                  aria-label={`Delete ${a.label}`}
                  onClick={() => {
                    profile.removeAddress(a.id);
                    toast("Address removed", { kind: "info" });
                  }}
                  className="press rounded-full p-2 text-cream-500 transition-colors hover:bg-chili-500/10 hover:text-chili-400"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
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
                onClick={() => {
                  if (addrText.trim().length > 10) {
                    profile.addAddress(addrLabel || "Other", addrText.trim());
                    setAddrLabel("");
                    setAddrText("");
                    setShowAddressForm(false);
                    toast("Address saved");
                  }
                }}
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
