import type {
  DishSearchResult,
  RestaurantSearchResult,
  SearchFacets,
  SearchSuggestion,
  SearchSuggestionKind,
} from "@/lib/types";

const KIND_ORDER: Record<SearchSuggestionKind, number> = {
  dish: 0,
  cuisine: 1,
  category: 2,
  restaurant: 3,
};

function termRank(text: string, needle: string): number {
  const lower = text.toLowerCase();
  if (lower === needle) return 0;
  if (lower.startsWith(needle)) return 1;
  return 2;
}

/**
 * Turn one search response into a compact refinement strip.
 *
 * Result cards answer "what matches"; suggestions answer "what can I ask next".
 * Keeping that mapping pure makes it testable without a database and stops the
 * route from growing UI-shaped conditionals.
 */
export function buildSearchSuggestions(
  q: string,
  results: (DishSearchResult | RestaurantSearchResult)[],
  facets: SearchFacets,
): SearchSuggestion[] {
  const needle = q.trim().toLowerCase();
  const seen = new Set<string>();
  const collected: SearchSuggestion[] = [];

  const add = (suggestion: SearchSuggestion) => {
    const key = `${suggestion.kind}:${suggestion.text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(suggestion);
  };

  for (const result of results) {
    if (result.type === "dish") {
      add({ kind: "dish", text: result.name, dishId: result.id, restaurantSlug: result.restaurantSlug });
    } else {
      add({ kind: "restaurant", text: result.name, restaurantSlug: result.slug });
    }
  }
  for (const cuisine of facets.cuisines) add({ kind: "cuisine", text: cuisine });
  for (const category of facets.categories) add({ kind: "category", text: category });

  return collected
    .sort(
      (a, b) =>
        termRank(a.text, needle) - termRank(b.text, needle) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.text.localeCompare(b.text),
    )
    .slice(0, 8);
}
