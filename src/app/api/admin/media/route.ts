import { db } from "@/db";
import { mediaAssets } from "@/db/schema";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** POST /api/admin/media — multipart upload, returns a durable image URL. */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return Response.json(
        { error: "Only JPEG, PNG, WebP or GIF images are allowed" },
        { status: 415 },
      );
    }
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: "Image must be smaller than 4 MB" },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const [row] = await db
      .insert(mediaAssets)
      .values({
        mimeType: file.type,
        byteSize: buffer.byteLength,
        data: buffer.toString("base64"),
      })
      .returning({ id: mediaAssets.id });

    return Response.json({ url: `/api/media/${row.id}`, id: row.id }, { status: 201 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
