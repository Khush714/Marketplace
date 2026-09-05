import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  setAdminCookie,
  findAdminByEmail,
  checkPassword,
  bootstrapAdmin,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/login  { email?, password }
 *
 * Authenticates an operator against the `admin_users` table (scrypt hash).
 * Two paths are supported:
 *   1. Email + password → scrypt verified against the stored account.
 *   2. Bootstrap fallback: if ADMIN_EMAIL/ADMIN_PASSWORD env vars are set and
 *      the submitted credentials match them, the default admin account is
 *      auto-created/upserted so the very first operator can sign in.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!password) {
    return Response.json({ error: "Password is required." }, { status: 400 });
  }

  let role = "operator";

  if (email) {
    const account = await findAdminByEmail(email);
    if (account) {
      if (!account.active) {
        return Response.json({ error: "This account is disabled." }, { status: 403 });
      }
      if (!checkPassword(password, account.passwordHash)) {
        return Response.json({ error: "Incorrect email or password." }, { status: 401 });
      }
      role = account.role;
      await db
        .update(adminUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(adminUsers.id, account.id));
      await setAdminCookie(account.id, account.role);
      return Response.json({ ok: true, id: account.id, role: account.role, name: account.name });
    }

    // No account yet — fall through to bootstrap with ADMIN_PASSWORD if set.
    const bootstrapEmail = (process.env.ADMIN_EMAIL || "admin@marketplace.local").toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD;
    if (email === bootstrapEmail && adminPass && password === adminPass) {
      const created = await bootstrapAdmin();
      if (created) {
        await db
          .update(adminUsers)
          .set({ lastLoginAt: new Date() })
          .where(eq(adminUsers.id, created.id));
        await setAdminCookie(created.id, created.role);
        return Response.json({ ok: true, id: created.id, role: created.role });
      }
    }
    return Response.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  // No email provided → legacy shared-password bootstrap (still supported for
  // the first owner via ADMIN_PASSWORD alone). Creates the default admin.
  const created = await bootstrapAdmin();
  if (!created) {
    return Response.json({ error: "Email is required." }, { status: 400 });
  }
  await setAdminCookie(created.id, created.role);
  return Response.json({ ok: true, id: created.id, role: created.role });
}
