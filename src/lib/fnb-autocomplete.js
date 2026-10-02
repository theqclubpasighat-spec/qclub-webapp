function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAutocompleteItemAvailable(item) {
  if (!item || item.active === false || item.sell_in_ledger === false) return false;
  if (item.requires_price_configuration || item.is_unpriced) return false;
  if (!(Number(item.selling_price_inr) > 0)) return false;
  if (item.track_inventory && Number(item.current_stock || 0) <= 0) return false;
  return true;
}

function matchRank(item, query) {
  const name = normalize(item && item.name);
  const category = normalize(item && item.category);
  if (!name || !query) return null;
  if (name.startsWith(query)) return 0;

  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some(function(word) { return word.startsWith(query); })) return 1;
  if (name.includes(query)) return 2;
  if (category.startsWith(query) || category.includes(query)) return 3;
  return null;
}

export function rankFnbAutocomplete(items, query, limit) {
  const q = normalize(query);
  const max = Number(limit || 10);
  if (!q) return [];

  return (items || [])
    .filter(isAutocompleteItemAvailable)
    .map(function(item) {
      return { item, rank: matchRank(item, q) };
    })
    .filter(function(row) { return row.rank != null; })
    .sort(function(a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aName = normalize(a.item.name);
      const bName = normalize(b.item.name);
      if (aName.length !== bName.length) return aName.length - bName.length;
      return aName.localeCompare(bName);
    })
    .slice(0, Math.max(1, max))
    .map(function(row) { return row.item; });
}

export function incrementItemQuantity(quantities, itemId) {
  const current = Number((quantities || {})[itemId] || 0);
  return { ...(quantities || {}), [itemId]: current + 1 };
}

export function autocompleteKeyAction(key, currentIndex, resultCount) {
  const count = Math.max(0, Number(resultCount || 0));
  const index = Number.isInteger(currentIndex) ? currentIndex : -1;

  if (key === "Escape") return { type: "CLOSE", index: -1 };
  if (!count) return null;

  if (key === "ArrowDown") {
    return { type: "MOVE", index: Math.min(index < 0 ? 0 : index + 1, count - 1) };
  }
  if (key === "ArrowUp") {
    return { type: "MOVE", index: Math.max(index < 0 ? 0 : index - 1, 0) };
  }
  if (key === "Enter") {
    return { type: "SELECT", index: index >= 0 && index < count ? index : 0 };
  }
  return null;
}
