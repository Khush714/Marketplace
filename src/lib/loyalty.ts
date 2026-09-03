/**
 * PHASE 20 — Tablz loyalty.
 * ₹500 order → 50 points  ⇒  10% of order total, rounded down.
 * 100 points redeem for $1 off.
 */

export const POINTS_PER_DOLLAR = 0.1; // 10% of spend
export const CENTS_PER_POINT = 1; // 100 points = $1.00

export function pointsEarned(orderTotal: number): number {
  return Math.max(0, Math.floor(orderTotal * POINTS_PER_DOLLAR));
}

export function redeemValue(points: number): number {
  return Math.round((Math.max(0, points) * CENTS_PER_POINT) / 100 * 100) / 100;
}

export function maxRedeemable(balance: number, subtotal: number): number {
  const byBalance = redeemValue(balance);
  return Math.min(byBalance, Math.max(0, subtotal));
}

export function pointsToRedeem(dollarAmount: number): number {
  return Math.ceil((dollarAmount * 100) / CENTS_PER_POINT);
}
