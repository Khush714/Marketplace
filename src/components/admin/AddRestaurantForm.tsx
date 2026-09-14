"use client";

import { useRef, useState } from "react";
import type { AdminRestaurant } from "./RestaurantList";

const CUISINES = [
  "American",
  "Chinese",
  "Dessert",
  "Indian",
  "Italian",
  "Japanese",
  "Korean",
  "Lebanese",
  "Mediterranean",
  "Mexican",
  "Thai",
  "Vietnamese",
  "General",
];

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

type HoursState = Record<string, { open: string; close: string; active: boolean }>;

const DEFAULT_HOURS: HoursState = {
  mon: { open: "09:00", close: "22:00", active: true },
  tue: { open: "09:00", close: "22:00", active: true },
  wed: { open: "09:00", close: "22:00", active: true },
  thu: { open: "09:00", close: "22:00", active: true },
  fri: { open: "09:00", close: "22:00", active: true },
  sat: { open: "10:00", close: "23:00", active: true },
  sun: { open: "10:00", close: "21:00", active: true },
};

export function AddRestaurantForm({
  onAdded,
  onClose,
}: {
  onAdded: (r: AdminRestaurant) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [cuisine, setCuisine] = useState("Indian");
  const [deliveryRadius, setDeliveryRadius] = useState(8);
  const [hours, setHours] = useState<HoursState>(DEFAULT_HOURS);
  const [logoUrl, setLogoUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  function setDay(day: string, field: "open" | "close" | "active", value: string | boolean) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  }

  async function uploadImage(file: File, type: "logo" | "cover") {
    const setUploading = type === "logo" ? setUploadingLogo : setUploadingCover;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
      } else {
        if (type === "logo") setLogoUrl(data.url as string);
        else setImageUrl(data.url as string);
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function buildOpeningHours(): string {
    const result: Record<string, { open: string; close: string }[]> = {};
    for (const [day, val] of Object.entries(hours)) {
      if (val.active && val.open && val.close) {
        result[day] = [{ open: val.open, close: val.close }];
      }
    }
    return JSON.stringify(result);
  }

  async function submit() {
    if (!name.trim()) {
      setError("Restaurant name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          phone: phone.trim(),
          cuisine,
          deliveryRadiusKm: deliveryRadius,
          openingHours: buildOpeningHours(),
          logoUrl,
          imageUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create restaurant");
        return;
      }

      // Build the new restaurant object for immediate display
      const newRestaurant: AdminRestaurant = {
        id: data.restaurantId,
        name: name.trim(),
        slug: data.slug,
        marketplaceId: "",
        cuisine,
        address: address.trim(),
        phone: phone.trim(),
        openingHours: buildOpeningHours(),
        imageUrl,
        logoUrl,
        deliveryRadiusKm: deliveryRadius,
        isOpen: true,
        isListed: false,
        marketplaceStatus: "draft",
        integrationProvider: "restaurantai",
        integrationStatus: "disconnected",
        createdAt: new Date().toISOString(),
      };
      onAdded(newRestaurant);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
          <h2 className="text-lg font-bold text-white">Add Restaurant</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/40 transition hover:bg-white/5 hover:text-white/70"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <Field label="Restaurant name *">
            <Input
              value={name}
              onChange={setName}
              placeholder="e.g. Spice Garden"
            />
          </Field>

          {/* Address */}
          <Field label="Address">
            <Input
              value={address}
              onChange={setAddress}
              placeholder="e.g. 12 Main Street, City"
            />
          </Field>

          {/* Phone */}
          <Field label="Phone">
            <Input
              value={phone}
              onChange={setPhone}
              placeholder="e.g. +91 98765 43210"
            />
          </Field>

          {/* Cuisine + Delivery radius */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cuisine">
              <select
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8 [&>option]:bg-ink-900"
              >
                {CUISINES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Delivery radius: ${deliveryRadius} km`}>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={deliveryRadius}
                onChange={(e) => setDeliveryRadius(Number(e.target.value))}
                className="mt-2 w-full accent-ember-500"
              />
            </Field>
          </div>

          {/* Logo */}
          <Field label="Logo">
            <div className="mt-1 flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/5">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/20">
                    Logo
                  </div>
                )}
              </div>
              <div>
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadImage(f, "logo");
                  }}
                />
                <button
                  type="button"
                  onClick={() => logoRef.current?.click()}
                  disabled={uploadingLogo}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {uploadingLogo ? "Uploading..." : "Upload logo"}
                </button>
              </div>
            </div>
          </Field>

          {/* Cover image */}
          <Field label="Cover image">
            <div className="mt-1 flex items-center gap-3">
              <div className="h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-white/5">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="Cover" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/20">
                    Cover
                  </div>
                )}
              </div>
              <div>
                <input
                  ref={coverRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadImage(f, "cover");
                  }}
                />
                <button
                  type="button"
                  onClick={() => coverRef.current?.click()}
                  disabled={uploadingCover}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {uploadingCover ? "Uploading..." : "Upload cover"}
                </button>
                <p className="mt-1 text-[11px] text-white/25">
                  Recommended: 1200x600px
                </p>
              </div>
            </div>
          </Field>

          {/* Opening hours */}
          <div>
            <label className="text-xs font-medium text-white/45">
              Opening hours
            </label>
            <div className="mt-2 space-y-1.5">
              {DAYS.map(({ key, label }) => {
                const day = hours[key];
                return (
                  <div key={key} className="flex items-center gap-2">
                    <label className="flex w-10 shrink-0 items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={day.active}
                        onChange={(e) => setDay(key, "active", e.target.checked)}
                        className="h-3.5 w-3.5 accent-ember-500"
                      />
                      <span className="text-xs text-white/50">{label}</span>
                    </label>
                    {day.active ? (
                      <>
                        <input
                          type="time"
                          value={day.open}
                          onChange={(e) => setDay(key, "open", e.target.value)}
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-ember-500/50"
                        />
                        <span className="text-xs text-white/30">to</span>
                        <input
                          type="time"
                          value={day.close}
                          onChange={(e) => setDay(key, "close", e.target.value)}
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-ember-500/50"
                        />
                      </>
                    ) : (
                      <span className="text-xs text-white/25">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-white/8 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/60 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="rounded-xl bg-ember-500 px-5 py-2 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create Restaurant"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-white/45">{label}</label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
    />
  );
}
