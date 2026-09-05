import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { getCurrentAdmin, hashPassword, requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["owner", "operator", "support"];

/** GET /api/admin/users — list operators (owner only). */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = await getCurrentAdmin();
  if (!me || me.role !== "owner") {
    return Response.json({ error: "Owners only" }, { status: 403 });
  }
  const rows = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      active: adminUsers.active,
      lastLoginAt: adminUsers.lastLoginAt,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .orderBy(asc(adminUsers.email));
  return Response.json({ users: rows });
}

/** POST /api/admin/users — create an operator (owner only). */
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = await getCurrentAdmin();
  if (!me || me.role !== "owner") {
    return Response.json({ error: "Owners only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim() || email.split("@")[0];
  const role = String(body.role ?? "operator");

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return Response.json({ error: `Role must be one of ${ROLES.join(", ")}` }, { status: 400 });
  }

  const existing = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = ${email}`)
    .limit(1);
  if (existing.length > 0) {
    return Response.json({ error: "An admin with that email already exists." }, { status: 409 });
  }

  const [created] = await db
    .insert(adminUsers)
    .values({ email, name, passwordHash: hashPassword(password), role })
    .returning({ id: adminUsers.id, email: adminUsers.email, role: adminUsers.role, name: adminUsers.name });
  return Response.json({ user: created }, { status: 201 });
}
