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
