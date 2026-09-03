import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/media/:id — serves an uploaded image from Postgres. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, numeric))
    .limit(1);

  if (!row) return new Response("Not found", { status: 404 });

  const bytes = Uint8Array.from(Buffer.from(row.data, "base64"));
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
