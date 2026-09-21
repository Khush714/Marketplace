/* ------------------------------- formatting ------------------------------ */

export function formatINR(cents: number): string {
  const rupees = cents / 100;
  const hasFraction = cents % 100 !== 0;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function priceSymbol(level: number): string {
  return "₹".repeat(Math.max(1, Math.min(4, level)));
}

export function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Late night cravings";
}

export function formatK(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${count}`;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${date} · ${formatClock(d)}`;
}

/* ----------------------------- order tracking ---------------------------- */

export interface OrderStage {
  key: string;
  label: string;
  sub: string;
  at: number; // seconds after order creation
}

/** Accelerated demo timeline — full journey in ~3.5 minutes. */
export const ORDER_STAGES: OrderStage[] = [
  { key: "placed", label: "Order placed", sub: "We got your order", at: 0 },
  { key: "confirmed", label: "Order confirmed", sub: "Restaurant confirmed your order", at: 8 },
  { key: "preparing", label: "Being prepared", sub: "Chefs are on it", at: 30 },
  { key: "ready", label: "Order ready", sub: "Packed & sealed for pickup", at: 95 },
  { key: "rider", label: "Rider assigned", sub: "Your rider is heading to the restaurant", at: 112 },
  { key: "on_the_way", label: "On the way", sub: "Cruising through the city to you", at: 130 },
  { key: "delivered", label: "Delivered", sub: "Enjoy your meal", at: 200 },
];

export const DELIVERY_TOTAL_SECONDS = ORDER_STAGES[ORDER_STAGES.length - 1].at;

export function orderProgress(createdAt: Date, now = new Date()) {
  const elapsed = Math.max(0, (now.getTime() - createdAt.getTime()) / 1000);
  let stageIndex = 0;
  for (let i = 0; i < ORDER_STAGES.length; i++) {
    if (elapsed >= ORDER_STAGES[i].at) stageIndex = i;
  }
  const stage = ORDER_STAGES[stageIndex];
  const delivered = stage.key === "delivered";
  // Rider movement: restaurant → home between "ready" and "delivered"
  const rideStart = ORDER_STAGES[3].at;
  const rideEnd = DELIVERY_TOTAL_SECONDS;
  const riderProgress = delivered ? 1 : Math.min(1, Math.max(0, (elapsed - rideStart) / (rideEnd - rideStart)));
  const eta = new Date(createdAt.getTime() + rideEnd * 1000);
  const etaSeconds = Math.max(0, Math.round((eta.getTime() - now.getTime()) / 1000));
  return { elapsed, stageIndex, stage, delivered, riderProgress, eta, etaSeconds };
}

/* ---------------------------------- misc --------------------------------- */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function makeOrderCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `CRV-${s}`;
}

/** Single-use invite that lets a restaurant connect itself to the marketplace. */
export function makeConnectionCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `CNX-${s}`;
}

/** Lifetime of an integration session token issued after code+passkey login. */
export const INTEGRATION_SESSION_TTL_MS = 60 * 60 * 1000;

/** Fallback imagery for restaurants onboarded via a connection code. */
export const DEFAULT_RESTAURANT_IMAGE =
  "https://images.pexels.com/photos/28674660/pexels-photo-28674660.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";
export const DEFAULT_RESTAURANT_HERO =
  "https://images.pexels.com/photos/24554391/pexels-photo-24554391.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";

export const DELIVERY_FREE_ABOVE_CENTS = 49900;
export const DELIVERY_FEE_CENTS = 3900;
export const PLATFORM_FEE_CENTS = 600;

/** Client-side bill preview — the server recomputes authoritative totals at order time. */
export function estimateBill(subtotalCents: number) {
  const deliveryFee = subtotalCents >= DELIVERY_FREE_ABOVE_CENTS ? 0 : DELIVERY_FEE_CENTS;
  const platformFee = PLATFORM_FEE_CENTS;
  return {
    deliveryFee,
    platformFee,
    total: subtotalCents + deliveryFee + platformFee,
    freeDelivery: deliveryFee === 0,
  };
}

/* The exact bill a restaurant contract produces. The server applies this at
   order time — the payment & receipt must use the same numbers, so this single
   function is shared by the bill endpoint, createOrder and the client confirm. */
export interface BillBreakdown {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  platformFeeCents: number;
  totalCents: number;
}

/**
 * Authoritative order bill for a restaurant offer + cart.
 * Mirrors what createOrder records so the amount paid always matches the order.
 */
export function billFor(
  subtotalCents: number,
  offerPercent: number,
  offerMaxCents: number,
): BillBreakdown {
  let discountCents = 0;
  if (offerPercent > 0) {
    discountCents = Math.min(Math.round((subtotalCents * offerPercent) / 100), offerMaxCents);
  } else if (offerMaxCents > 0 && subtotalCents >= offerMaxCents * 3) {
    discountCents = offerMaxCents;
  }
  const deliveryFeeCents =
    subtotalCents >= DELIVERY_FREE_ABOVE_CENTS ? 0 : DELIVERY_FEE_CENTS;
  const platformFeeCents = PLATFORM_FEE_CENTS;
  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    platformFeeCents,
    totalCents: subtotalCents - discountCents + deliveryFeeCents + platformFeeCents,
  };
}

export const CUISINES = [
  "Burgers",
  "Pizza",
  "Sushi",
  "North Indian",
  "Biryani",
  "Ramen",
  "Mexican",
  "Italian",
  "Healthy",
  "Desserts",
  "Fried Chicken",
  "Cafe",
] as const;

/* -------------------------------- locations ------------------------------ */

export interface Locality {
  key: string;
  name: string; // must match restaurants.locality values in the DB
  city: string;
  pincode: string;
  lat: number;
  lng: number;
}

export const LOCALITIES: Locality[] = [
  { key: "old-city", name: "Old City", city: "Bharuch", pincode: "392001", lat: 21.6947, lng: 72.9974 },
  { key: "zadeshwar", name: "Zadeshwar", city: "Bharuch", pincode: "392011", lat: 21.7275, lng: 73.031 },
  { key: "maktampur", name: "Maktampur", city: "Bharuch", pincode: "392012", lat: 21.7388, lng: 73.0382 },
];

export const DEFAULT_LOCALITY = LOCALITIES[0];

export function localityByKey(key?: string | null): Locality {
  return LOCALITIES.find((l) => l.key === key) ?? DEFAULT_LOCALITY;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in km (Haversine). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Max distance from a served locality before we auto-assign it.
 * Beyond this we treat the user as "not served" instead of guessing.
 */
export const DELIVERY_RADIUS_KM = 25;

export interface LocalityMatch {
  locality: Locality;
  distanceKm: number;
  served: boolean;
}

/** Snap raw GPS coordinates to the nearest known locality within delivery range. */
export function localityNear(lat: number, lng: number): LocalityMatch {
  let best = DEFAULT_LOCALITY;
  let bestD = Infinity;
  for (const l of LOCALITIES) {
    const d = distanceKm(lat, lng, l.lat, l.lng);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return { locality: best, distanceKm: bestD, served: bestD <= DELIVERY_RADIUS_KM };
}

/** Append (or override) the ?loc= param on a relative href, preserving other params. */
export function withLoc(href: string, key?: string | null): string {
  if (!key) return href;
  const [path, qs = ""] = href.split("?");
  const params = new URLSearchParams(qs);
  params.set("loc", key);
  const enc = params.toString();
  return enc ? `${path}?${enc}` : path;
}
