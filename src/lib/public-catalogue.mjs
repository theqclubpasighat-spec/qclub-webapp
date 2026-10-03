// Shared read-only public catalogue contract. Never use legacy menu state as orderable stock.
export function parseCatalogue(payload) {
  if (payload?.ok !== true || payload.source !== "qclub_fnb_master" ||
      !payload.menuCatalog || typeof payload.menuCatalog !== "object" ||
      Array.isArray(payload.menuCatalog)) throw new Error("The menu is unavailable. Please retry.");
  return Object.entries(payload.menuCatalog).map(([id, category]) => {
    if (!category || typeof category.title !== "string" || !Array.isArray(category.items)) {
      throw new Error("The menu is unavailable. Please retry.");
    }
    const items = category.items.map(item => {
      if (!item || typeof item.id !== "string" || typeof item.name !== "string" ||
          !Number.isFinite(item.price) || item.price <= 0) {
        throw new Error("The menu is unavailable. Please retry.");
      }
      return { ...item, image: safeImageUrl(item.image) };
    });
    return { id, title: category.title, items };
  });
}

export function safeImageUrl(value) {
  if (typeof value !== "string" || !value) return "";
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export async function readCatalogue(signal) {
  const response = await fetch("/api/snooker/v1/public-catalogue", {
    method: "GET", cache: "no-store", credentials: "same-origin", signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("The menu could not load. Please retry.");
  return parseCatalogue(await response.json());
}
