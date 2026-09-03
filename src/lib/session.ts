import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOKIE = "tablz_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return process.env.SESSION_SECRET || "dev-secret-not-for-production";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Signed session token: `<customerId>.<issuedAt>.<signature>`. */
export function makeToken(customerId: number): string {
  const payload = `${customerId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, issued, sig] = parts;
  const expected = sign(`${id}.${issued}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  const issuedAt = Number(issued);
  if (Date.now() - issuedAt > MAX_AGE * 1000) return null;
  return customerId;
}

export async function setSessionCookie(customerId: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, makeToken(customerId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function readSessionCookie(): Promise<number | null> {
  const store = await cookies();
  return verifyToken(store.get(COOKIE)?.value);
}

export type CurrentCustomer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
};

export async function getCurrentCustomer(): Promise<CurrentCustomer | null> {
  const id = await readSessionCookie();
  if (!id) return null;
  const [c] = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      loyaltyPoints: customers.loyaltyPoints,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return c ?? null;
}

/** Random 6-digit OTP. Deterministic length; leading zeros preserved. */
export function generateOtp(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function hashOtp(code: string, phone: string): string {
  return createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
}
