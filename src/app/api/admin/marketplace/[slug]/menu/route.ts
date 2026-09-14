import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getEditorMenu,
  addCategory,
  addItem,
  addGroup,
  addModifier,
  updateCategory,
  updateItem,
  updateGroup,
  updateModifier,
  deleteCategory,
  deleteItem,
  deleteGroup,
  deleteModifier,
} from "@/lib/menu-admin";

export const dynamic = "force-dynamic";

async function guard(slug: string): Promise<Response | null> {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [r] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return Response.json({ error: "Restaurant not found" }, { status: 404 });
  return null;
}

/** GET /api/admin/marketplace/:slug/menu — full menu for the owner editor. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const denied = await guard(slug);
  if (denied) return denied;
  const menu = await getEditorMenu(slug);
  if (!menu) return Response.json({ error: "Restaurant not found" }, { status: 404 });
  return Response.json(menu);
}

/**
 * POST /api/admin/marketplace/:slug/menu
 * Create commands: addCategory | addItem | addGroup | addModifier
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const denied = await guard(slug);
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action ?? "");
    const result =
      action === "addCategory"
        ? await addCategory(slug, body.name)
        : action === "addItem"
          ? await addItem(slug, {
              name: body.name,
              price: Number(body.price),
              categoryId: body.categoryId,
              description: body.description,
              imageUrl: body.imageUrl,
              isAvailable: body.isAvailable,
              isPopular: body.isPopular,
              isVegetarian: body.isVegetarian,
            })
          : action === "addGroup"
            ? await addGroup(
                slug,
                Number(body.menuItemId),
                body.name,
                Number(body.minSelect ?? 0),
                Number(body.maxSelect ?? 1),
              )
            : action === "addModifier"
              ? await addModifier(
                  slug,
                  Number(body.groupId),
                  body.name,
                  Number(body.priceDelta ?? 0),
                )
              : { ok: false as const, error: "Unknown action" };

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ saved: true, message: result.message }, { status: 201 });
  } catch {
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/marketplace/:slug/menu
 * Update commands: updateCategory | updateItem | updateGroup | updateModifier
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const denied = await guard(slug);
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action ?? "");
    const result =
      action === "updateCategory"
        ? await updateCategory(slug, Number(body.categoryId), {
            name: body.name,
            sortOrder: body.sortOrder,
            externalId: body.externalId,
          })
        : action === "updateItem"
          ? await updateItem(slug, Number(body.itemId), {
              name: body.name,
              price: body.price !== undefined ? Number(body.price) : undefined,
              categoryId: body.categoryId,
              description: body.description,
              imageUrl: body.imageUrl,
              isAvailable: body.isAvailable,
              isPopular: body.isPopular,
              isVegetarian: body.isVegetarian,
              externalId: body.externalId,
            })
          : action === "updateGroup"
            ? await updateGroup(slug, Number(body.groupId), {
                name: body.name,
                minSelect:
                  body.minSelect !== undefined ? Number(body.minSelect) : undefined,
                maxSelect:
                  body.maxSelect !== undefined ? Number(body.maxSelect) : undefined,
                sortOrder: body.sortOrder,
              })
            : action === "updateModifier"
              ? await updateModifier(slug, Number(body.modifierId), {
                  name: body.name,
                  priceDelta:
                    body.priceDelta !== undefined ? Number(body.priceDelta) : undefined,
                  isAvailable: body.isAvailable,
                  sortOrder: body.sortOrder,
                })
              : { ok: false as const, error: "Unknown action" };

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ saved: true, message: result.message });
  } catch {
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/marketplace/:slug/menu
 * Delete commands: deleteCategory | deleteItem | deleteGroup | deleteModifier
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const denied = await guard(slug);
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action ?? "");
    const result =
      action === "deleteCategory"
        ? await deleteCategory(slug, Number(body.categoryId))
        : action === "deleteItem"
          ? await deleteItem(slug, Number(body.itemId))
          : action === "deleteGroup"
            ? await deleteGroup(slug, Number(body.groupId))
            : action === "deleteModifier"
              ? await deleteModifier(slug, Number(body.modifierId))
              : { ok: false as const, error: "Unknown action" };

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ deleted: true, message: result.message });
  } catch {
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}
