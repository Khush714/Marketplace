import { NextRequest, NextResponse } from "next/server";

const COOKIE = "tablz_admin";
const MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "dev-admin-secret";
}

async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, issued, sig] = parts;
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`${role}.${issued}`));
  const mac = btoa(String.fromCharCode(...new Uint8Array(macBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (mac.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** Guards /admin page routes (except the login page). */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname === "/admin/login") return NextResponse.next();

  const authed = await verifyAdminToken(req.cookies.get(COOKIE)?.value);
  if (authed) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*"],
};
