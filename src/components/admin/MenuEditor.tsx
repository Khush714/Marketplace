"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { PlusIcon, XIcon, TrashIcon } from "../ui/icons";
import { currency } from "@/lib/format";

type Modifier = {
  id: number;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
  sortOrder: number;
};

type ModifierGroup = {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  modifiers: Modifier[];
};

type MenuItem = {
  id: number;
  marketplaceId: string;
  externalId: string | null;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isAvailable: boolean;
  isPopular: boolean;
  isVegetarian: boolean;
  categoryId: number | null;
  modifierGroups: ModifierGroup[];
};

type Category = {
  id: number;
  marketplaceId: string;
  externalId: string | null;
  name: string;
  sortOrder: number;
  items: MenuItem[];
};

type Menu = {
  restaurant: { id: number; slug: string; name: string };
  categories: Category[];
};

type Toast = { kind: "ok" | "err"; text: string } | null;

const inputCls =
  "mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8 [&>option]:bg-ink-900";

export function MenuEditor({ slug, initial }: { slug: string; initial: Menu }) {
  const base = `/api/admin/marketplace/${encodeURIComponent(slug)}/menu`;

  const [menu, setMenu] = useState<Menu | null>(initial);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // Modal state
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryRename, setCategoryRename] = useState("");

  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [addingItemFor, setAddingItemFor] = useState<Category | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const itemFileRef = useRef<HTMLInputElement>(null);

  // Modifier editor modal
  const [editingItemMods, setEditingItemMods] = useState<MenuItem | null>(null);

  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load menu");
      const next = data as Menu;
      setMenu(next);
      return next;
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message });
      return null;
    }
  }, [base]);

  function flash(t: Toast) {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 3000);
  }

  async function run(method: string, payload: unknown) {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(base, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      const next = await load();
      if (next && editingItemMods) {
        const found = next.categories
          .flatMap((c) => c.items)
          .find((i) => i.id === editingItemMods.id);
        if (found) setEditingItemMods(found);
      }
      flash({ kind: "ok", text: "Saved." });
      return true;
    } catch (e) {
      flash({ kind: "err", text: (e as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ---- Category actions ----
  async function createCategory() {
    const ok = await run("POST", { action: "addCategory", name: newCategoryName });
    if (ok) {
      setAddingCategory(false);
      setNewCategoryName("");
    }
  }
  async function renameCategory() {
    if (!editingCategory) return;
    const ok = await run("PUT", {
      action: "updateCategory",
      categoryId: editingCategory.id,
      name: categoryRename,
    });
    if (ok) setEditingCategory(null);
  }
  async function removeCategory(cat: Category) {
    if (cat.id === -1) return;
    if (!confirm(`Delete category "${cat.name}" and unlink its items?`)) return;
    await run("DELETE", { action: "deleteCategory", categoryId: cat.id });
  }

  // ---- Item actions ----
  async function saveItem() {
    if (!editingItem) return;
    const ok = await run("PUT", {
      action: "updateItem",
      itemId: editingItem.id,
      name: editingItem.name,
      price: editingItem.price,
      categoryId: editingItem.categoryId,
      description: editingItem.description,
      imageUrl: editingItem.imageUrl,
      isAvailable: editingItem.isAvailable,
      isPopular: editingItem.isPopular,
      isVegetarian: editingItem.isVegetarian,
      externalId: editingItem.externalId,
    });
    if (ok) setEditingItem(null);
  }

  async function createItem() {
    if (!addingItemFor) return;
    const ok = await run("POST", {
      action: "addItem",
      name: "New item",
      price: 0,
      categoryId: addingItemFor.id > 0 ? addingItemFor.id : null,
      isAvailable: true,
    });
    if (ok) setAddingItemFor(null);
  }

  async function removeItem(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"? This also removes its option groups.`)) {
      return;
    }
    await run("DELETE", { action: "deleteItem", itemId: item.id });
  }

  async function uploadItemImage(file: File) {
    if (!editingItem) return;
    setUploadingImage(true);
    setToast(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setEditingItem((it) =>
        it ? { ...it, imageUrl: data.url as string } : it,
      );
    } catch (e) {
      flash({ kind: "err", text: (e as Error).message });
    } finally {
      setUploadingImage(false);
    }
  }

  // ---- Modifier group / modifier actions ----
  async function addGroupToItem(item: MenuItem) {
    const name = "New option group";
    const ok = await run("POST", {
      action: "addGroup",
      menuItemId: item.id,
      name,
      minSelect: 0,
      maxSelect: 1,
    });
    if (ok) {
      setEditingItemMods(
        (prev) => prev && { ...prev, modifierGroups: [...prev.modifierGroups] },
      );
      await load();
    }
  }
  async function addModifierToGroup(groupId: number) {
    await run("POST", {
      action: "addModifier",
      groupId,
      name: "New option",
      priceDelta: 0,
    });
  }
  async function renameGroup(groupId: number, name: string) {
    await run("PUT", { action: "updateGroup", groupId, name });
  }
  async function removeGroup(groupId: number) {
    if (!confirm("Delete this option group and all its options?")) return;
    await run("DELETE", { action: "deleteGroup", groupId });
  }
  async function renameModifier(modifierId: number, name: string) {
    await run("PUT", { action: "updateModifier", modifierId, name });
  }
  async function setModifierDelta(modifierId: number, priceDelta: number) {
    await run("PUT", { action: "updateModifier", modifierId, priceDelta });
  }
  async function toggleModifier(modifierId: number, isAvailable: boolean) {
    await run("PUT", { action: "updateModifier", modifierId, isAvailable });
  }
  async function removeModifier(modifierId: number) {
    await run("DELETE", { action: "deleteModifier", modifierId });
  }

  if (!menu) {
    return (
      <div className="rounded-3xl border border-white/8 bg-ink-850 p-8 text-center text-sm text-white/35 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        Could not load menu.
      </div>
    );
  }

  const categoryOptions = menu.categories
    .filter((c) => c.id !== -1)
    .map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ));

  return (
    <div>
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
            Menu editor
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
            {menu.restaurant.name}
          </h1>
          <p className="mt-1 text-sm text-white/45">
            Add and manage categories and menu items. Changes appear on your
            storefront immediately.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
          >
            {preview ? "Hide preview" : "Preview"}
          </button>
          <Link
            href={`/restaurants/${menu.restaurant.slug}/menu`}
            className="rounded-2xl bg-ember-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
          >
            View storefront ↗
          </Link>
        </div>
      </div>

      {toast && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            toast.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-rose-500/10 text-rose-400"
          }`}
        >
          {toast.text}
        </p>
      )}

      {/* Add category */}
      <div className="mt-6 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAddingCategory(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border-2 border-dashed border-white/15 px-4 py-2 text-sm font-semibold text-white/60 transition-colors hover:border-ember-500/40 hover:text-ember-400"
        >
          <PlusIcon className="text-base" /> Add category
        </button>
        <span className="text-xs text-white/35">
          {menu.categories.length} categories
        </span>
      </div>

      {/* Categories */}
      {menu.categories.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-ink-850 p-10 text-center">
          <p className="text-sm font-semibold text-white/45">
            Your menu is empty
          </p>
          <p className="mt-1 text-sm text-white/35">
            Add a category (like &quot;Starters&quot; or &quot;Pizza&quot;) to begin listing items —
            just like Zomato.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {menu.categories.map((cat) => (
            <section
              key={cat.id}
              className="card-lift rounded-3xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-white">
                    {cat.name}
                  </h2>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs font-semibold text-white/45">
                    {cat.items.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {cat.id !== -1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(cat);
                        setCategoryRename(cat.name);
                      }}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-white/45 transition-colors hover:bg-white/10"
                    >
                      Rename
                    </button>
                  )}
                  {cat.id !== -1 && (
                    <button
                      type="button"
                      onClick={() => removeCategory(cat)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-white/35 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      title="Delete category"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>

              {cat.items.length === 0 ? (
                <p className="mt-3 rounded-2xl bg-white/5 px-4 py-6 text-center text-sm text-white/35">
                  No items in this category yet.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-white/6">
                  {cat.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 py-3"
                    >
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
                        {item.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-white">
                            {item.name}
                          </p>
                          {!item.isAvailable && (
                            <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-400">
                              Unavailable
                            </span>
                          )}
                          {item.isPopular && (
                            <span className="shrink-0 rounded-full bg-ember-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-ember-400">
                              Popular
                            </span>
                          )}
                          {item.isVegetarian && (
                            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">
                              Veg
                            </span>
                          )}
                        </div>
                        <p className="truncate text-sm text-white/35">
                          {currency(item.price)}
                          {item.modifierGroups.length > 0 &&
                            ` · ${item.modifierGroups.length} option group${
                              item.modifierGroups.length === 1 ? "" : "s"
                            }`}
                        </p>
                        {item.marketplaceId && (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-white/30">
                            {item.marketplaceId}
                            {item.externalId && (
                              <span className="text-ember-400/70">
                                {" "}↔ {item.externalId}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingItem(item);
                            setEditingItemMods(null);
                          }}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-ember-400 transition-colors hover:bg-ember-500/10"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItemMods(item)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10"
                        >
                          Options
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(item)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-white/35 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                          title="Delete item"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => setAddingItemFor(cat)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm font-semibold text-white/60 transition-colors hover:border-ember-500/40 hover:text-ember-400"
              >
                <PlusIcon className="text-base" /> Add item
              </button>
            </section>
          ))}
        </div>
      )}

      {/* ── Add category modal ── */}
      {addingCategory && (
        <Modal onClose={() => setAddingCategory(false)} title="Add category">
          <label className="text-xs font-medium text-white/45">Name</label>
          <input
            autoFocus
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createCategory()}
            placeholder="e.g. Starters, Pizza, Desserts"
            className={inputCls}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddingCategory(false)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createCategory}
              disabled={saving || !newCategoryName.trim()}
              className="rounded-xl bg-ember-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </Modal>
      )}

      {/* ── Rename category modal ── */}
      {editingCategory && (
        <Modal onClose={() => setEditingCategory(null)} title="Rename category">
          <label className="text-xs font-medium text-white/45">Name</label>
          <input
            autoFocus
            value={categoryRename}
            onChange={(e) => setCategoryRename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void renameCategory()}
            className={inputCls}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingCategory(null)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={renameCategory}
              disabled={saving || !categoryRename.trim()}
              className="rounded-xl bg-ember-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* ── Item editor modal ── */}
      {(editingItem || addingItemFor) && (
        <Modal
          onClose={() => {
            setEditingItem(null);
            setAddingItemFor(null);
          }}
          title={editingItem ? "Edit item" : "Add item"}
        >
          {editingItem ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    value={editingItem.name}
                    onChange={(e) =>
                      setEditingItem((it) =>
                        it ? { ...it, name: e.target.value } : it,
                      )
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Price ($)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editingItem.price}
                    onChange={(e) =>
                      setEditingItem((it) =>
                        it ? { ...it, price: Number(e.target.value) } : it,
                      )
                    }
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={editingItem.description}
                  onChange={(e) =>
                    setEditingItem((it) =>
                      it ? { ...it, description: e.target.value } : it,
                    )
                  }
                  rows={2}
                  maxLength={2000}
                  className={`${inputCls} resize-none`}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category">
                  <select
                    value={editingItem.categoryId ?? ""}
                    onChange={(e) =>
                      setEditingItem((it) =>
                        it
                          ? {
                              ...it,
                              categoryId: e.target.value
                                ? Number(e.target.value)
                                : null,
                            }
                          : it,
                      )
                    }
                    className={inputCls}
                  >
                    <option value="">Uncategorised</option>
                    {categoryOptions}
                  </select>
                </Field>
                <Field label="Photo">
                  <div className="mt-1 flex items-center gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white/5">
                      {editingItem.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={editingItem.imageUrl}
                          alt="Item"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <input
                      ref={itemFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadItemImage(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => itemFileRef.current?.click()}
                      disabled={uploadingImage}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 disabled:opacity-60"
                    >
                      {uploadingImage ? "Uploading…" : "Upload"}
                    </button>
                  </div>
                </Field>
              </div>

              <Field label="External item id (RestaurantAI)">
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={editingItem.externalId ?? ""}
                    onChange={(e) =>
                      setEditingItem((it) =>
                        it ? { ...it, externalId: e.target.value || null } : it,
                      )
                    }
                    placeholder="e.g. pos_item_829"
                    className={inputCls}
                  />
                  {editingItem.marketplaceId && (
                    <span className="shrink-0 font-mono text-[10px] text-white/30">
                      = {editingItem.marketplaceId}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-white/30">
                  The id RestaurantAI uses for this dish. Unique per restaurant —
                  used to map{" "}
                  <span className="font-mono text-white/45">
                    item_…
                  </span>{" "}
                  ↔{" "}
                  <span className="font-mono text-white/45">pos_…</span>.
                </p>
              </Field>

              <div className="grid gap-2 sm:grid-cols-3">
                <Toggle
                  label="Available"
                  checked={editingItem.isAvailable}
                  onChange={(v) =>
                    setEditingItem((it) =>
                      it ? { ...it, isAvailable: v } : it,
                    )
                  }
                />
                <Toggle
                  label="Popular"
                  checked={editingItem.isPopular}
                  onChange={(v) =>
                    setEditingItem((it) => (it ? { ...it, isPopular: v } : it))
                  }
                />
                <Toggle
                  label="Vegetarian"
                  checked={editingItem.isVegetarian}
                  onChange={(v) =>
                    setEditingItem((it) =>
                      it ? { ...it, isVegetarian: v } : it,
                    )
                  }
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveItem}
                  disabled={saving || !editingItem.name.trim()}
                  className="rounded-xl bg-ember-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-50"
                >
                  Save item
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-white/45">
                Add a new item to {addingItemFor!.name}.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingItemFor(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createItem}
                  disabled={saving}
                  className="rounded-xl bg-ember-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-50"
                >
                  Add item
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Option groups / modifiers modal ── */}
      {editingItemMods && (
        <Modal
          onClose={() => setEditingItemMods(null)}
          title={`Options — ${editingItemMods.name}`}
        >
          <p className="text-sm text-white/45">
            Option groups let customers customise an item (e.g. size, toppings).
            Each group has a min/max number of options to pick.
          </p>

          <button
            type="button"
            onClick={() => addGroupToItem(editingItemMods)}
            disabled={saving}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border-2 border-dashed border-white/15 px-3 py-2 text-sm font-semibold text-white/60 transition-colors hover:border-ember-500/40 hover:text-ember-400 disabled:opacity-50"
          >
            <PlusIcon className="text-base" /> Add option group
          </button>

          <div className="mt-4 space-y-4">
            {editingItemMods.modifierGroups.length === 0 && (
              <p className="text-sm text-white/35">
                No option groups yet.
              </p>
            )}
            {editingItemMods.modifierGroups.map((group) => (
              <div
                key={group.id}
                className="rounded-2xl border border-white/8 bg-white/5 p-4"
              >
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={group.name}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== group.name &&
                      void renameGroup(group.id, e.target.value)
                    }
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white outline-none transition-colors focus:border-ember-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => removeGroup(group.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-white/35 hover:bg-rose-500/10 hover:text-rose-400"
                    title="Delete group"
                  >
                    <TrashIcon />
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-3 text-xs text-white/45">
                  <label className="flex items-center gap-1">
                    Min
                    <input
                      type="number"
                      min={0}
                      defaultValue={group.minSelect}
                      onBlur={(e) =>
                        Number(e.target.value) >= 0 &&
                        Number(e.target.value) !== group.minSelect &&
                        void run("PUT", {
                          action: "updateGroup",
                          groupId: group.id,
                          minSelect: Number(e.target.value),
                        })
                      }
                      className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Max
                    <input
                      type="number"
                      min={0}
                      defaultValue={group.maxSelect}
                      onBlur={(e) =>
                        Number(e.target.value) >= 0 &&
                        Number(e.target.value) !== group.maxSelect &&
                        void run("PUT", {
                          action: "updateGroup",
                          groupId: group.id,
                          maxSelect: Number(e.target.value),
                        })
                      }
                      className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white outline-none"
                    />
                  </label>
                </div>

                <ul className="mt-3 space-y-2">
                  {group.modifiers.map((mod) => (
                    <li
                      key={mod.id}
                      className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2"
                    >
                      <input
                        defaultValue={mod.name}
                        onBlur={(e) =>
                          e.target.value.trim() &&
                          e.target.value !== mod.name &&
                          void renameModifier(mod.id, e.target.value)
                        }
                        className="min-w-0 flex-1 rounded-md border border-transparent px-1 py-1 text-sm text-white outline-none transition-colors focus:border-ember-500/40"
                      />
                      <div className="flex items-center gap-1 text-xs text-white/35">
                        <span>+$</span>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={mod.priceDelta}
                          onBlur={(e) =>
                            e.target.value !== "" &&
                            Number(e.target.value) !== mod.priceDelta &&
                            void setModifierDelta(
                              mod.id,
                              Number(e.target.value),
                            )
                          }
                          className="w-16 rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-right text-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleModifier(mod.id, !mod.isAvailable)}
                        className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase transition ${
                          mod.isAvailable
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {mod.isAvailable ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeModifier(mod.id)}
                        className="grid h-7 w-7 place-items-center rounded-md text-white/35 hover:bg-rose-500/10 hover:text-rose-400"
                        title="Delete option"
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => addModifierToGroup(group.id)}
                  disabled={saving}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ember-400 hover:underline disabled:opacity-50"
                >
                  <PlusIcon className="text-xs" /> Add option
                </button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setEditingItemMods(null)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10"
            >
              Done
            </button>
          </div>
        </Modal>
      )}

      {/* ── Preview ── */}
      {preview && (
        <div className="mt-6 card-lift rounded-3xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-white/40">
            Storefront preview
          </h3>
          <p className="mt-2 text-sm text-white/35">
            This is roughly how customers will see your menu.
          </p>
          <div className="mt-4 space-y-5">
            {menu.categories.map((cat) => (
              <div key={cat.id}>
                <h4 className="text-base font-bold text-white">{cat.name}</h4>
                <ul className="mt-2 divide-y divide-white/6 border-t border-white/6">
                  {cat.items.map((item) => (
                    <li key={item.id} className="flex py-2">
                      <div className="flex-1">
                        <p className="font-semibold text-white">
                          {item.name}
                          {!item.isAvailable && (
                            <span className="ml-2 text-xs font-normal text-rose-400">
                              unavailable
                            </span>
                          )}
                        </p>
                        {item.description && (
                          <p className="text-sm text-white/35">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <p className="ml-3 text-sm font-semibold text-white/70">
                        {currency(item.price)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div className="w-full max-w-lg rounded-t-3xl border border-white/8 bg-ink-850 p-6 shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-bold tracking-tight text-white">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-white/45 transition-colors hover:bg-white/10"
          >
            <XIcon className="text-base" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-white/45">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/8 bg-white/5 px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-ember-500"
      />
      <span className="text-sm text-white/70">{label}</span>
    </label>
  );
}
