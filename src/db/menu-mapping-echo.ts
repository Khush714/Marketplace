/**
 * The `mappings` echo the Marketplace sends back on a menu webhook.
 *
 * Every entry must carry the minted id under BOTH `id` and the entity-scoped
 * `marketplace_*_id` key. This is not redundancy for its own sake — the two
 * sides read different keys from the same object:
 *
 *  · the POS reads `marketplace_category_id` / `marketplace_group_id` /
 *    `marketplace_modifier_id` / `marketplace_item_id`
 *    (Backend/integrations/marketplace/menu.js, persistAssignmentsFromResponse)
 *  · our own single-entity responses and the replayed-event ledger read `id`
 *
 * Emitting only `id` made the POS persist the literal string "undefined" as the
 * marketplace id, and because each mapping table is unique on
 * (restaurant_id, marketplace_*_id) the FIRST entity to arrive consumed that key
 * for the whole tenant. A real 6-category / 3-modifier sync round-tripped 1
 * category and 1 modifier; the rest failed their inserts inside a `catch` that
 * only logs. Building the entries here keeps the two keys from drifting apart
 * again.
 *
 * Pure and dependency-free so the contract can be asserted in tests without a
 * database connection.
 */

export interface CategoryMappingEcho {
  pos_category_id: number;
  id: number;
  marketplace_category_id: string;
  name?: string | null;
}

export interface ItemMappingEcho {
  pos_item_id: number;
  id: number;
  marketplace_item_id: string;
  name?: string | null;
}

export interface ModifierGroupMappingEcho {
  pos_group_id: number;
  id: number;
  marketplace_group_id: string;
  name?: string | null;
}

export interface ModifierMappingEcho {
  pos_group_id: number;
  pos_modifier_id: number;
  id: number;
  marketplace_modifier_id: string;
  name?: string | null;
}

export function categoryMapping(
  posCategoryId: number,
  id: number,
  name?: string | null,
): CategoryMappingEcho {
  return { pos_category_id: posCategoryId, id, marketplace_category_id: String(id), name };
}

export function itemMapping(
  posItemId: number,
  id: number,
  name?: string | null,
): ItemMappingEcho {
  return { pos_item_id: posItemId, id, marketplace_item_id: String(id), name };
}

export function modifierGroupMapping(
  posGroupId: number,
  id: number,
  name?: string | null,
): ModifierGroupMappingEcho {
  return { pos_group_id: posGroupId, id, marketplace_group_id: String(id), name };
}

export function modifierMapping(
  posGroupId: number,
  posOptionId: number,
  id: number,
  name?: string | null,
): ModifierMappingEcho {
  return {
    pos_group_id: posGroupId,
    pos_modifier_id: posOptionId,
    id,
    marketplace_modifier_id: String(id),
    name,
  };
}