import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentAdmin, hashPassword, requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const ROLES = ["owner", "operator", "support"];

/** PATCH /api/admin/users/:id — update role, active, name, or password (owner only). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = await getCurrentAdmin();
  if (!me || me.role !== "owner") {
    return Response.json({ error: "Owners only" }, { status: 403 });
  }
  const { id } = await params;
  const adminId = Number(id);
  if (!Number.isInteger(adminId)) {
    return Response.json({ error: "Invalid user id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body.role === "string") {
    if (!ROLES.includes(body.role)) {
      return Response.json({ error: `Role must be one of ${ROLES.join(", ")}` }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 160);
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    patch.passwordHash = hashPassword(body.password);
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Prevent disabling/removing yourself.
  if (adminId === me.id && (body.active === false || body.role === "support")) {
    return Response.json({ error: "You cannot disable or demote your own account." }, { status: 400 });
  }

  const [updated] = await db
    .update(adminUsers)
    .set(patch)
    .where(eq(adminUsers.id, adminId))
    .returning({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name, role: adminUsers.role, active: adminUsers.active });
  if (!updated) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  return Response.json({ user: updated });
}
