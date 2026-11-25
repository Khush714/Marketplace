"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  House,
  LoaderCircle,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  ADDRESS_LABELS,
  addressForOrder,
  addressSummary,
  blankAddress,
  DEFAULT_MAP_POINT,
  type Address,
  type AddressLabel,
  type MapPoint,
} from "@/lib/delivery-address";
import { cn, localityNear } from "@/lib/domain";

type Place = { id: string; name: string; latitude: number; longitude: number };
type View = "list" | "location" | "details";

type Props = {
  addresses: Address[];
  selectedId: string | null;
  signedIn?: boolean;
  /** Account-backed addresses are selectable but managed from the account page. */
  deletableIds?: Set<string>;
  /** Checkout can open straight into the add-address flow. */
  initialView?: "list" | "location";
  onClose: () => void;
  onSelect: (id: string) => void;
  onSave: (address: Address, saveToAccount: boolean) => void;
  onDelete: (id: string) => void;
  onPinChange?: (point: MapPoint) => void;
};

const LABEL_ICONS = { Home: House, Work: Briefcase, Other: MapPin } as const;
const MAP_ZOOM = 15;
const TILE_SIZE = 256;
const FIELD_CLASS =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-cream-50 placeholder:text-cream-600 focus:border-ember-400/60 focus:outline-none";

function worldAt(point: MapPoint, zoom = MAP_ZOOM) {
  const scale = 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.latitude));
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y: ((1 - Math.asin(Math.tanh((latitude * Math.PI) / 180)) / Math.PI) / 2) * scale,
  };
}

function latLngAt(x: number, y: number, zoom = MAP_ZOOM): MapPoint {
  const scale = 2 ** zoom;
  return {
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI,
    longitude: (x / scale) * 360 - 180,
  };
}

/** Dependency-free OpenStreetMap canvas: drag the tiles to move the centre pin. */
function LocationMap({ point, onPick }: { point: MapPoint | null; onPick: (point: MapPoint) => void }) {
  const drag = useRef<{ x: number; y: number; world: { x: number; y: number } } | null>(null);
  const center = point ?? DEFAULT_MAP_POINT;
  const world = worldAt(center);
  const tiles: { key: string; url: string; left: number; top: number }[] = [];
  const maxTile = 2 ** MAP_ZOOM - 1;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const tileX = Math.floor(world.x) + dx;
      const tileY = Math.floor(world.y) + dy;
      if (tileY < 0 || tileY > maxTile) continue;
      const wrappedX = ((tileX % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
      tiles.push({
        key: `${tileX}:${tileY}`,
        url: `https://tile.openstreetmap.org/${MAP_ZOOM}/${wrappedX}/${tileY}.png`,
        left: (tileX - world.x) * TILE_SIZE,
        top: (tileY - world.y) * TILE_SIZE,
      });
    }
  }

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, world };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const startDrag = drag.current;
    if (!startDrag) return;
    const nextWorld = {
      x: startDrag.world.x - (event.clientX - startDrag.x) / TILE_SIZE,
      y: startDrag.world.y - (event.clientY - startDrag.y) / TILE_SIZE,
    };
    const next = latLngAt(nextWorld.x, Math.min(maxTile, Math.max(0, nextWorld.y)));
    onPick({
      latitude: Math.max(-85, Math.min(85, next.latitude)),
      longitude: ((next.longitude + 540) % 360) - 180,
    });
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      role="application"
      aria-label="Drag the map to place your delivery pin"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className="relative h-64 cursor-grab touch-none overflow-hidden rounded-2xl border border-white/10 bg-[#dfe8e2] active:cursor-grabbing sm:h-72"
    >
      <div className="absolute inset-0">
        {tiles.map((tile) => (
          // OSM tiles are third-party raster images; they must not go through
          // the image optimizer's server-side SSRF allowlist.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      <MapPin className="pointer-events-none absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-full text-chili-600 drop-shadow-md" fill="currentColor" strokeWidth={1.6} />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-1 text-[10px] font-bold text-coal">
        Drag the map to move the pin
      </span>
      <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[9px] text-coal">
        © OpenStreetMap contributors
      </span>
    </div>
  );
}

export function AddressPicker({
  addresses,
  selectedId,
  signedIn = false,
  deletableIds,
  initialView = "list",
  onClose,
  onSelect,
  onSave,
  onDelete,
  onPinChange,
}: Props) {
  const [view, setView] = useState<View>(initialView);
  const [editing, setEditing] = useState<Address | null>(null);
  const [form, setForm] = useState<Address>(() => blankAddress());
  const [point, setPoint] = useState<MapPoint | null>(
    initialView === "location" ? DEFAULT_MAP_POINT : null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [error, setError] = useState("");
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, []);

  function update<K extends keyof Address>(key: K, value: Address[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function setPin(next: MapPoint) {
    setPoint(next);
    setError("");
    onPinChange?.(next);
  }

  function addNew() {
    setEditing(null);
    setForm(blankAddress());
    setPoint(DEFAULT_MAP_POINT);
    setQuery("");
    setResults([]);
    setSaveToAccount(false);
    setError("");
    setView("location");
  }

  function edit(address: Address) {
    setEditing(address);
    setForm({ ...address });
    setPoint(
      typeof address.latitude === "number" && typeof address.longitude === "number"
        ? { latitude: address.latitude, longitude: address.longitude }
        : DEFAULT_MAP_POINT,
    );
    setQuery("");
    setResults([]);
    setSaveToAccount(false);
    setError("");
    setView("details");
  }

  async function searchPlaces(value: string) {
    const term = value.trim();
    if (term.length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&addressdetails=1&limit=5&q=${encodeURIComponent(term)}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Search unavailable");
      const rows: { place_id: number; display_name: string; lat: string; lon: string }[] =
        await response.json();
      setResults(
        rows
          .filter((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)))
          .map((row) => ({
            id: String(row.place_id),
            name: row.display_name,
            latitude: Number(row.lat),
            longitude: Number(row.lon),
          })),
      );
    } catch {
      setResults([]);
      setError(
        "Location search is unavailable right now. You can still drop a pin or type the address manually.",
      );
    } finally {
      setSearching(false);
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (value.trim().length < 3) {
      setResults([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void searchPlaces(value);
    }, 350);
  }

  function choosePlace(place: Place) {
    setPin({ latitude: place.latitude, longitude: place.longitude });
    setForm((current) => ({
      ...current,
      area: current.area || place.name.split(",").slice(0, 2).join(",").trim().slice(0, 120),
      placeName: place.name.slice(0, 200),
    }));
    setResults([]);
    setQuery(place.name.split(",")[0] ?? "");
    setView("location");
  }

  async function reverseGeocode(target: MapPoint) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${target.latitude}&lon=${target.longitude}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const data: { display_name?: string; address?: Record<string, string> } = await response.json();
      const parts = data.address ?? {};
      const area = parts.suburb || parts.neighbourhood || parts.area || parts.town || parts.village || "";
      const city = parts.city || parts.state_district || parts.state || "";
      setForm((current) => ({
        ...current,
        street: current.street || parts.road || "",
        area: current.area || area,
        city: current.city || city,
        pincode: current.pincode || String(parts.postcode || "").slice(0, 10),
        placeName:
          current.placeName ||
          [parts.road, area, city].filter(Boolean).join(", ").slice(0, 200) ||
          String(data.display_name || "").slice(0, 200),
      }));
    } catch {
      /* Manual entry still works when reverse geocoding is offline. */
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("This browser can’t share your location. Search or type your address instead.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const target = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setPin(target);
        setLocating(false);
        void reverseGeocode(target);
      },
      () => {
        setLocating(false);
        setError("We couldn’t access your location. Check browser permissions, or search for your area.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function confirmLocation() {
    if (!point) {
      setError("Move the map or search for an area to place your pin.");
      return;
    }
    setError("");
    void reverseGeocode(point);
    setView("details");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!point) {
      setError("Select a location on the map first.");
      return;
    }
    if (!form.house?.trim()) {
      setError("Add your flat, house or building number.");
      return;
    }
    if (!form.street?.trim() && !form.area?.trim()) {
      setError("Add a street or area name.");
      return;
    }
    if (!form.city?.trim()) {
      setError("Add your city.");
      return;
    }
    if (!/^\d{6}$/.test(form.pincode?.trim() ?? "")) {
      setError("Enter a valid 6-digit pincode.");
      return;
    }
    if (form.phone?.trim() && !/^\d{10}$/.test(form.phone.replace(/\D/g, ""))) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }
    const details: Address = {
      ...form,
      id: editing?.id || globalThis.crypto?.randomUUID?.() || `addr-${Date.now()}`,
      house: form.house.trim(),
      street: form.street?.trim() ?? "",
      area: form.area?.trim() ?? "",
      landmark: form.landmark?.trim() ?? "",
      city: form.city.trim(),
      pincode: (form.pincode ?? "").trim(),
      phone: (form.phone ?? "").replace(/\D/g, ""),
      instructions: form.instructions?.trim() ?? "",
      latitude: point.latitude,
      longitude: point.longitude,
    };
    onSave({ ...details, text: addressForOrder(details) }, saveToAccount && signedIn);
  }

  const selected = addresses.find((address) => address.id === selectedId) ?? null;
  const nearby = point ? localityNear(point.latitude, point.longitude) : null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Delivery address">
      <button
        type="button"
        aria-label="Close address picker"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end sm:inset-0 sm:items-center sm:justify-center sm:p-4">
        <section className="glass-strong animate-sheet-up pointer-events-auto flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] sm:animate-pop-in sm:rounded-3xl">
          <header className="flex items-start justify-between gap-4 border-b border-white/8 px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ember-400">
                {view === "list" ? "Delivery address" : view === "location" ? "Step 1 of 2" : "Step 2 of 2"}
              </p>
              <h2 className="mt-1 font-display text-xl font-bold text-cream-50 sm:text-2xl">
                {view === "list"
                  ? "Where should we deliver?"
                  : view === "location"
                    ? "Select your location"
                    : "Add address details"}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-cream-500">
                {view === "list"
                  ? "Saved addresses stay on this device for next time."
                  : view === "location"
                    ? "Search for your area, or drop the pin at your door."
                    : "A few more details help the rider find you."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close address picker"
              className="press rounded-full p-1.5 text-cream-400 transition-colors hover:bg-white/8 hover:text-cream-50"
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
            {view === "list" && (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchPlaces(query);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 focus-within:border-ember-400/60"
                >
                  <Search className="size-4 shrink-0 text-cream-500" />
                  <input
                    aria-label="Search area or street"
                    placeholder="Search for area, street or landmark"
                    value={query}
                    onChange={(event) => changeQuery(event.target.value)}
                    maxLength={120}
                    className="min-w-0 flex-1 bg-transparent text-sm text-cream-50 placeholder:text-cream-600 focus:outline-none"
                  />
                  {searching && <LoaderCircle className="size-4 animate-spin text-ember-400" />}
                </form>
                {error && (
                  <p role="alert" className="rounded-xl border border-chili-500/25 bg-chili-500/10 px-3 py-2 text-xs text-chili-300">
                    {error}
                  </p>
                )}
                {results.length > 0 && (
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1.5">
                    {results.map((place) => (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => choosePlace(place)}
                        className="press flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs leading-relaxed text-cream-300 transition-colors hover:bg-white/8"
                      >
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-chili-400" />
                        <span className="min-w-0">{place.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  disabled={locating}
                  onClick={useCurrentLocation}
                  className={cn(
                    "press flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                    "border-mint-400/25 bg-mint-500/8 hover:bg-mint-500/14",
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint-500/15 text-mint-400">
                    {locating ? <LoaderCircle className="size-4.5 animate-spin" /> : <Navigation className="size-4.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-cream-50">
                      {locating ? "Finding your location…" : "Use my current location"}
                    </span>
                    <span className="block text-xs text-cream-500">GPS accuracy depends on your device</span>
                  </span>
                  <ArrowRight className="size-4 rotate-180 text-cream-500" />
                </button>

                <div className="flex items-center gap-2 pt-1">
                  <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-cream-400">Saved addresses</h3>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-cream-500">
                    {addresses.length}
                  </span>
                </div>
                {addresses.length ? (
                  <div className="space-y-2">
                    {addresses.map((address) => {
                      const Icon = address.label === "Work" ? Briefcase : address.label === "Home" ? House : MapPin;
                      const active = address.id === selectedId;
                      return (
                        <div
                          key={address.id}
                          className={cn(
                            "flex items-center gap-2 rounded-2xl border p-2 transition-colors",
                            active ? "border-ember-400/50 bg-ember-400/8" : "border-white/10 bg-white/[0.03]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect(address.id)}
                            className="press flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left"
                          >
                            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", active ? "bg-chili-500/20 text-chili-400" : "bg-white/8 text-cream-400")}>
                              <Icon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-cream-50">{address.label}</span>
                              <span className="mt-0.5 block truncate text-xs text-cream-500">
                                {addressSummary(address)}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "grid size-5 shrink-0 place-items-center rounded-full border-2",
                                active ? "border-ember-400 bg-ember-400 text-void" : "border-white/25",
                              )}
                            >
                              {active && <Check className="size-3" strokeWidth={3} />}
                            </span>
                          </button>
                          {(!deletableIds || deletableIds.has(address.id)) && (
                            <>
                              <button
                                type="button"
                                aria-label={`Edit ${address.label} address`}
                                onClick={() => edit(address)}
                                className="press rounded-lg p-2 text-cream-500 transition-colors hover:bg-white/8 hover:text-cream-200"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${address.label} address`}
                                onClick={() => onDelete(address.id)}
                                className="press rounded-lg p-2 text-cream-500 transition-colors hover:bg-chili-500/10 hover:text-chili-400"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
                    <MapPin className="mx-auto size-6 text-cream-500" />
                    <p className="mt-2 text-sm font-semibold text-cream-200">No saved addresses yet</p>
                    <p className="mt-1 text-xs text-cream-500">Add one now to make checkout faster.</p>
                  </div>
                )}
              </>
            )}

            {view === "location" && (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchPlaces(query);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 focus-within:border-ember-400/60"
                >
                  <Search className="size-4 shrink-0 text-cream-500" />
                  <input
                    aria-label="Search area or street"
                    placeholder="Search for area, street or landmark"
                    value={query}
                    onChange={(event) => changeQuery(event.target.value)}
                    maxLength={120}
                    className="min-w-0 flex-1 bg-transparent text-sm text-cream-50 placeholder:text-cream-600 focus:outline-none"
                  />
                  {searching && <LoaderCircle className="size-4 animate-spin text-ember-400" />}
                </form>
                {error && (
                  <p role="alert" className="rounded-xl border border-chili-500/25 bg-chili-500/10 px-3 py-2 text-xs text-chili-300">
                    {error}
                  </p>
                )}
                {results.length > 0 && (
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1.5">
                    {results.map((place) => (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => choosePlace(place)}
                        className="press flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs leading-relaxed text-cream-300 transition-colors hover:bg-white/8"
                      >
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-chili-400" />
                        <span className="min-w-0">{place.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <LocationMap point={point} onPick={setPin} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-cream-500">
                    {point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : "No pin placed"}
                  </span>
                  <button
                    type="button"
                    disabled={locating}
                    onClick={useCurrentLocation}
                    className="press inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/6 px-3 py-1.5 font-semibold text-cream-200 transition-colors hover:bg-white/12"
                  >
                    {locating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Navigation className="size-3.5" />}
                    Use current location
                  </button>
                </div>
                {nearby && !nearby.served && (
                  <p className="rounded-xl border border-gold-400/25 bg-gold-400/10 px-3 py-2 text-xs text-gold-300">
                    This pin is outside the areas we currently serve. Pick a nearby area or choose another pin.
                  </p>
                )}
                <div className="flex justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
                  >
                    <ArrowLeft className="size-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={confirmLocation}
                    className="press inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white shadow-glow"
                  >
                    Confirm location <ArrowRight className="size-4" />
                  </button>
                </div>
              </>
            )}

            {view === "details" && (
              <form onSubmit={save} className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {ADDRESS_LABELS.map((value: AddressLabel) => {
                    const Icon = LABEL_ICONS[value];
                    const active = form.label === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update("label", value)}
                        className={cn(
                          "press inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors",
                          active
                            ? "border-ember-400/50 bg-ember-400/12 text-ember-300"
                            : "border-white/12 bg-white/[0.03] text-cream-400 hover:bg-white/8",
                        )}
                      >
                        <Icon className="size-3.5" /> {value}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Flat, house no., building</span>
                    <input required maxLength={80} value={form.house ?? ""} onChange={(e) => update("house", e.target.value)} placeholder="e.g. 42, Sunrise Apartments" autoComplete="address-line1" className={FIELD_CLASS} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Street, area or locality</span>
                    <input maxLength={120} value={form.street ?? ""} onChange={(e) => update("street", e.target.value)} placeholder="e.g. 12th Main, Indiranagar" autoComplete="address-line2" className={FIELD_CLASS} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Area / neighbourhood</span>
                    <input maxLength={120} value={form.area ?? ""} onChange={(e) => update("area", e.target.value)} placeholder="e.g. Old City" className={FIELD_CLASS} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Landmark <span className="font-normal text-cream-600">(optional)</span></span>
                    <input maxLength={120} value={form.landmark ?? ""} onChange={(e) => update("landmark", e.target.value)} placeholder="e.g. Near the metro station" className={FIELD_CLASS} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">City</span>
                    <input required maxLength={80} value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} placeholder="e.g. Bharuch" autoComplete="address-level2" className={FIELD_CLASS} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Pincode</span>
                    <input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.pincode ?? ""} onChange={(e) => update("pincode", e.target.value.replace(/\D/g, ""))} placeholder="392001" autoComplete="postal-code" className={FIELD_CLASS} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Phone number <span className="font-normal text-cream-600">(for delivery updates)</span></span>
                    <input inputMode="numeric" maxLength={10} value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value.replace(/\D/g, ""))} placeholder="10-digit mobile" autoComplete="tel-national" className={FIELD_CLASS} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-cream-300">Delivery instructions <span className="font-normal text-cream-600">(optional)</span></span>
                    <textarea rows={2} maxLength={200} value={form.instructions ?? ""} onChange={(e) => update("instructions", e.target.value)} placeholder="e.g. Ring the bell, leave at the door" className={cn(FIELD_CLASS, "resize-none")} />
                  </label>
                </div>
                {signedIn && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-cream-300">
                    <input
                      type="checkbox"
                      checked={saveToAccount}
                      onChange={(e) => setSaveToAccount(e.target.checked)}
                      className="size-4 rounded border-white/20 bg-black/30 accent-ember-400"
                    />
                    Also save a text copy to my account
                  </label>
                )}
                {error && (
                  <p role="alert" className="rounded-xl border border-chili-500/25 bg-chili-500/10 px-3 py-2 text-xs text-chili-300">
                    {error}
                  </p>
                )}
                <div className="flex justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setView("location")}
                    className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
                  >
                    <ArrowLeft className="size-4" /> Change pin
                  </button>
                  <button
                    type="submit"
                    className="press inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2.5 text-sm font-bold text-white shadow-glow"
                  >
                    {editing ? "Save changes" : "Save address"} <Check className="size-4" />
                  </button>
                </div>
              </form>
            )}
          </div>

          {view === "list" && (
            <footer className="border-t border-white/8 bg-black/20 px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={addNew}
                className="press flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-3 text-sm font-bold text-white shadow-glow"
              >
                <Plus className="size-4" /> Add a new address
              </button>
              {selected && (
                <p className="mt-2 truncate text-center text-[11px] text-cream-500">
                  Current: {selected.label} · {addressSummary(selected)}
                </p>
              )}
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}
