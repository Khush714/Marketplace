import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "tablz_admin";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "dev-admin-secret";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Signed admin token: `<role>.<issuedAt>.<signature>`. */
export function makeAdminToken(role = "admin"): string {
  const payload = `${role}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, issued, sig] = parts;
  const expected = sign(`${role}.${issued}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return false;
  return true;
}

export async function setAdminCookie(role = "admin"): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, makeAdminToken(role), {
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

export async function isAdminAuthed(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(COOKIE)?.value);
}

/**
 * Guards a server context (API route handler or server component).
 * Returns true when allowed; false when the caller is not an admin.
 * API routes should respond 401 when this returns false; page routes
 * should redirect to /admin/login.
 */
export async function requireAdmin(): Promise<boolean> {
  return isAdminAuthed();
}

/** Constant-time comparison for the admin password. */
export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "admin";
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
