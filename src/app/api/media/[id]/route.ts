import { getServableMedia } from "@/db/media";
import { guardRead } from "@/lib/abuse";

export const dynamic = "force-dynamic";

/** Same-origin media bytes. IDs are opaque; review photos stay private until reviewed. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guardRead(req, "mediaRead");
  if (blocked) return blocked;

  const raw = Number((await ctx.params).id);
  if (!Number.isInteger(raw) || raw <= 0) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const asset = await getServableMedia(raw);
  if (!asset) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
