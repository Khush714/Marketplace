import { checkAdminPassword, setAdminCookie } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** POST /api/admin/login  { password } */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password ?? "");

  if (!password) {
    return Response.json({ error: "Password is required." }, { status: 400 });
  }
  if (!checkAdminPassword(password)) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  await setAdminCookie("admin");
  return Response.json({ ok: true });
}
