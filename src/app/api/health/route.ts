import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Database unavailable." } },
      { status: 500 },
    );
  }
}
