import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOKIE = "tablz_admin";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "dev-admin-secret";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Signed admin token: `<userId>.<role>.<issuedAt>.<signature>`. */
export function makeAdminToken(adminId: number, role: string): string {
  const payload = `${adminId}.${role}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export type AdminToken = { id: number; role: string } | null;

export function verifyAdminToken(token: string | undefined): AdminToken {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, role, issued, sig] = parts;
  const expected = sign(`${id}.${role}.${issued}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return null;
  const adminId = Number(id);
  if (!Number.isInteger(adminId) || adminId <= 0) return null;
  return { id: adminId, role };
}

export async function setAdminCookie(adminId: number, role: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, makeAdminToken(adminId, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearAdminCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getCurrentAdmin(): Promise<AdminToken> {
  const store = await cookies();
  return verifyAdminToken(store.get(COOKIE)?.value);
}

/** Guards a server context (API route handler or server component). */
export async function requireAdmin(): Promise<boolean> {
  return (await getCurrentAdmin()) !== null;
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt) & per-user account helpers
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const derived = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(derived);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function findAdminByEmail(email: string) {
  const [u] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.toLowerCase()))
    .limit(1);
  return u ?? null;
}

/**
 * Bootstraps the first admin from ADMIN_PASSWORD/ADMIN_EMAIL when no account
 * exists yet. Returns the admin user, or null if there's nothing to bootstrap.
 */
export async function bootstrapAdmin(): Promise<{ id: number; role: string } | null> {
  const email = (process.env.ADMIN_EMAIL || "admin@marketplace.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;

  const existing = await findAdminByEmail(email);
  if (existing) return { id: existing.id, role: existing.role };

  const [created] = await db
    .insert(adminUsers)
    .values({
      email,
      name: "Administrator",
      passwordHash: hashPassword(password),
      role: "owner",
    })
    .returning({ id: adminUsers.id, role: adminUsers.role });
  return { id: created.id, role: created.role };
}

/** @deprecated — retained only for the pre-accounts shared-password fallback. */
export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "admin";
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
