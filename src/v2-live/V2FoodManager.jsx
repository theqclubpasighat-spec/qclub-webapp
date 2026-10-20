import React, { useEffect, useState } from "react";

const API_ROOT = "/api/snooker/v1";
const ADMIN_TOKEN_KEY = "qclub_admin_access_token_v2";
const ADMIN_ROLE_KEY = "qclub_admin_role";

async function request(path, token, options = {}) {
  const response = await fetch(`${API_ROOT}/${path}`, {
    method: options.method || "GET",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function emptyItem(categories) {
  return {
    id: "",
    name: "",
    price: "",
    costPrice: "",
    unit: "unit",
    description: "",
    image: "",
    category: categories[0]?.category_key || "",
    ledgerCategory: "FOOD",
    online: true,
    showOnQlounge: true,
    trackInventory: false,
    openingStock: "0",
    lowStockThreshold: "5",
  };
}

function itemDraft(item, categories) {
  return {
    id: item.id,
    name: item.name || "",
    price: item.selling_price_inr == null ? "" : String(item.selling_price_inr),
    costPrice: item.cost_price_inr == null ? "" : String(item.cost_price_inr),
    unit: item.unit || "unit",
    description: item.description || "",
    image: item.image_url || "",
    category: item.qlounge_category_key || categories[0]?.category_key || "",
    ledgerCategory: item.category || "OTHER",
    online: Boolean(item.online_order_enabled),
    showOnQlounge: Boolean(item.show_on_qlounge),
    trackInventory: Boolean(item.track_inventory),
    openingStock: item.current_stock == null ? "0" : String(item.current_stock),
    lowStockThreshold: item.low_stock_threshold == null ? "5" : String(item.low_stock_threshold),
  };
}

export default function V2FoodManager({ onUpdated }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [categoryDraft, setCategoryDraft] = useState(null);
  const [itemDraftState, setItemDraftState] = useState(null);

  async function loadManagerData(accessToken) {
    setLoading(true);
    setError("");
    try {
      const [categoryPayload, cataloguePayload] = await Promise.all([
        request("catalogue/categories", accessToken),
        request("catalogue", accessToken),
      ]);
      setCategories(categoryPayload.categories || []);
      setItems(cataloguePayload.items || cataloguePayload.catalogue || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load menu management data.");
      if (loadError.status === 401 || loadError.status === 403) setToken("");
    } finally {
      setLoading(false);
    }
  }

  async function openManager() {
    setOpen(true);
    setNotice("");
    setError("");
    setLoginError("");
    const currentToken = sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
    if (!currentToken) {
      setToken("");
      return;
    }
    try {
      const session = await request("cms/session", currentToken);
      if (session.role !== "ADMIN") {
        setToken("");
        setLoginError("Menu changes require a Main Admin PIN.");
        return;
      }
      setToken(currentToken);
      await loadManagerData(currentToken);
    } catch {
      setToken("");
      setLoginError("Your secure session has ended. Enter the Main Admin PIN to continue.");
    }
  }

  async function signIn(event) {
    event.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      const result = await request("auth/login", "", {
        method: "POST",
        body: { pin, device_id: "qclub-website", client_version: "qclub-web-security-v2" },
      });
      setPin("");
      if (!result.access_token || result.role !== "ADMIN") {
        setLoginError("Menu changes require a Main Admin PIN.");
        return;
      }
      sessionStorage.setItem(ADMIN_TOKEN_KEY, result.access_token);
      sessionStorage.setItem(ADMIN_ROLE_KEY, "main");
      window.dispatchEvent(new Event("qclub-secure-session-changed"));
      setToken(result.access_token);
      await loadManagerData(result.access_token);
    } catch (loginFailure) {
      setLoginError(loginFailure.status === 429
        ? "Too many attempts. Please wait and try again."
        : loginFailure.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAfterSave(message) {
    await loadManagerData(token);
    if (typeof onUpdated === "function") onUpdated();
    setCategoryDraft(null);
    setItemDraftState(null);
    setNotice(message);
    setError("");
  }

  async function saveCategory(event) {
    event.preventDefault();
    if (!categoryDraft || !categoryDraft.title.trim()) {
      setError("Enter a category name.");
      return;
    }
    const body = {
      title: categoryDraft.title.trim(),
      image_url: categoryDraft.image_url.trim(),
      sort_order: Number(categoryDraft.sort_order || 0),
    };
    setSaving(true);
    setError("");
    try {
      if (categoryDraft.category_key) {
        await request(`catalogue/categories/${encodeURIComponent(categoryDraft.category_key)}`, token, { method: "PATCH", body });
        await refreshAfterSave("Category updated.");
      } else {
        await request("catalogue/categories", token, { method: "POST", body });
        await refreshAfterSave("Category added.");
      }
    } catch (saveError) {
      setError(saveError.message || "Unable to save category.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(category) {
    if (!window.confirm(`Remove “${category.title}” from Q Lounge? Move or deactivate its active items first.`)) return;
    setSaving(true);
    setError("");
    try {
      await request(`catalogue/categories/${encodeURIComponent(category.category_key)}`, token, { method: "DELETE" });
      await refreshAfterSave("Category removed.");
    } catch (removeError) {
      setError(removeError.status === 409
        ? "This category still has active menu items. Move or deactivate those items first."
        : removeError.message || "Unable to remove category.");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(event) {
    event.preventDefault();
    if (!itemDraftState?.name.trim()) return setError("Enter an item name.");
    const price = Number(itemDraftState.price);
    if (!Number.isFinite(price) || price <= 0) return setError("Enter a valid selling price.");
    if (itemDraftState.showOnQlounge && !itemDraftState.category) return setError("Add a Q Lounge category first.");
    const body = {
      name: itemDraftState.name.trim(),
      category: itemDraftState.ledgerCategory,
      unit: itemDraftState.unit || "unit",
      selling_price_inr: price,
      cost_price_inr: itemDraftState.costPrice.trim() === "" ? null : Number(itemDraftState.costPrice),
      description: itemDraftState.description.trim(),
      image_url: itemDraftState.image.trim(),
      qlounge_category_key: itemDraftState.showOnQlounge ? itemDraftState.category : null,
      show_on_qlounge: Boolean(itemDraftState.showOnQlounge),
      online_order_enabled: Boolean(itemDraftState.showOnQlounge && itemDraftState.online),
      sell_in_ledger: true,
    };
    if (!itemDraftState.id) {
      body.track_inventory = Boolean(itemDraftState.trackInventory);
      body.opening_stock = Number(itemDraftState.openingStock || 0);
      body.low_stock_threshold = Number(itemDraftState.lowStockThreshold || 0);
    }
    setSaving(true);
    setError("");
    try {
      if (itemDraftState.id) {
        await request(`catalogue/items/${encodeURIComponent(itemDraftState.id)}`, token, { method: "PATCH", body });
        await refreshAfterSave("Item updated in the shared catalogue.");
      } else {
        await request("catalogue/items", token, { method: "POST", body });
        await refreshAfterSave("Item added to the shared catalogue.");
      }
    } catch (saveError) {
      setError(saveError.message || "Unable to save item.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item) {
    if (!window.confirm(`Deactivate “${item.name}” from Q Lounge and Ledger? Historical bills will remain unchanged.`)) return;
    setSaving(true);
    setError("");
    try {
      await request(`catalogue/items/${encodeURIComponent(item.id)}`, token, { method: "DELETE" });
      await refreshAfterSave("Item deactivated. Historical bills remain unchanged.");
    } catch (removeError) {
      setError(removeError.message || "Unable to deactivate item.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button className="v2-live-button v2-live-manager-trigger" type="button" onClick={openManager}>
        Manage menu
      </button>
      {open ? (
        <div className="v2-live-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="v2-live-manager" role="dialog" aria-modal="true" aria-labelledby="v2-live-manager-title">
            <div className="v2-live-manager-heading">
              <div><p className="v2-live-eyebrow">Admin tools</p><h2 id="v2-live-manager-title">Manage Q Lounge menu</h2><p className="v2-live-muted">Changes are shared with QclubLedger.</p></div>
              <button className="v2-live-button" type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
            {!token ? (
              <form className="v2-live-manager-login" onSubmit={signIn}>
                <p>Sign in with the Main Admin PIN to add, edit, or remove menu content.</p>
                <label htmlFor="v2-live-admin-pin">Main Admin PIN</label>
                <input id="v2-live-admin-pin" type="password" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} required />
                {loginError ? <p className="v2-live-manager-error" role="alert">{loginError}</p> : null}
                <button className="v2-live-button v2-live-primary" type="submit" disabled={loading}>{loading ? "Checking…" : "Sign in"}</button>
              </form>
            ) : (
              <>
                {error ? <p className="v2-live-manager-error" role="alert">{error}</p> : null}
                {notice ? <p className="v2-live-manager-notice" role="status">{notice}</p> : null}
                {loading ? <p role="status">Loading catalogue…</p> : (
                  <>
                    <div className="v2-live-manager-section">
                      <div className="v2-live-manager-section-heading"><h3>Categories</h3><button className="v2-live-button v2-live-primary" type="button" disabled={saving} onClick={() => { setCategoryDraft({ category_key: "", title: "", image_url: "", sort_order: String(categories.length) }); setError(""); }}>+ Add category</button></div>
                      {categoryDraft ? (
                        <form className="v2-live-manager-form" onSubmit={saveCategory}>
                          <label>Category name<input value={categoryDraft.title} onChange={(event) => setCategoryDraft({ ...categoryDraft, title: event.target.value })} required /></label>
                          <label>Image URL (optional)<input type="url" value={categoryDraft.image_url} onChange={(event) => setCategoryDraft({ ...categoryDraft, image_url: event.target.value })} /></label>
                          <label>Display order<input type="number" step="1" value={categoryDraft.sort_order} onChange={(event) => setCategoryDraft({ ...categoryDraft, sort_order: event.target.value })} /></label>
                          <div className="v2-live-manager-actions"><button className="v2-live-button" type="button" onClick={() => setCategoryDraft(null)}>Cancel</button><button className="v2-live-button v2-live-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save category"}</button></div>
                        </form>
                      ) : null}
                      <div className="v2-live-manager-list">
                        {categories.map((category) => <div className="v2-live-manager-row" key={category.category_key}><div><strong>{category.title}</strong><small>{category.category_key}</small></div><div className="v2-live-manager-actions"><button className="v2-live-button" type="button" disabled={saving} onClick={() => { setCategoryDraft({ ...category, sort_order: String(category.sort_order || 0) }); setError(""); }}>Edit</button><button className="v2-live-button v2-live-danger" type="button" disabled={saving} onClick={() => removeCategory(category)}>Remove</button></div></div>)}
                        {!categories.length ? <p className="v2-live-muted">No categories yet.</p> : null}
                      </div>
                    </div>

                    <div className="v2-live-manager-section">
                      <div className="v2-live-manager-section-heading"><h3>Items</h3><button className="v2-live-button v2-live-primary" type="button" disabled={saving} onClick={() => { setItemDraftState(emptyItem(categories)); setError(""); }}>+ Add item</button></div>
                      {itemDraftState ? (
                        <form className="v2-live-manager-form" onSubmit={saveItem}>
                          <label>Item name<input value={itemDraftState.name} onChange={(event) => setItemDraftState({ ...itemDraftState, name: event.target.value })} required /></label>
                          <label>Price (₹)<input type="number" min="0.01" step="0.01" value={itemDraftState.price} onChange={(event) => setItemDraftState({ ...itemDraftState, price: event.target.value })} required /></label>
                          <label>Purchase / cost price (₹)<input type="number" min="0" step="0.01" value={itemDraftState.costPrice} onChange={(event) => setItemDraftState({ ...itemDraftState, costPrice: event.target.value })} placeholder="Optional" /></label>
                          <label>Unit<input value={itemDraftState.unit} onChange={(event) => setItemDraftState({ ...itemDraftState, unit: event.target.value })} placeholder="unit / bottle / plate" /></label>
                          <label>Ledger category<select value={itemDraftState.ledgerCategory} onChange={(event) => setItemDraftState({ ...itemDraftState, ledgerCategory: event.target.value })}><option value="FOOD">Food</option><option value="BEVERAGES">Beverages</option><option value="OTHER">Other</option></select></label>
                          <label>Q Lounge category<select value={itemDraftState.category} disabled={!itemDraftState.showOnQlounge} onChange={(event) => setItemDraftState({ ...itemDraftState, category: event.target.value })}><option value="">Choose a category</option>{categories.map((category) => <option key={category.category_key} value={category.category_key}>{category.title}</option>)}</select></label>
                          <label className="wide">Description<input value={itemDraftState.description} onChange={(event) => setItemDraftState({ ...itemDraftState, description: event.target.value })} /></label>
                          <label className="wide">Image URL (optional)<input type="url" value={itemDraftState.image} onChange={(event) => setItemDraftState({ ...itemDraftState, image: event.target.value })} /></label>
                          <label className="v2-live-manager-check"><input type="checkbox" checked={itemDraftState.showOnQlounge} onChange={(event) => setItemDraftState({ ...itemDraftState, showOnQlounge: event.target.checked, online: event.target.checked && itemDraftState.online })} /> Show on Q Lounge</label>
                          <label className="v2-live-manager-check"><input type="checkbox" disabled={!itemDraftState.showOnQlounge} checked={itemDraftState.online} onChange={(event) => setItemDraftState({ ...itemDraftState, online: event.target.checked })} /> Allow online ordering</label>
                          {!itemDraftState.id ? <label className="v2-live-manager-check"><input type="checkbox" checked={itemDraftState.trackInventory} onChange={(event) => setItemDraftState({ ...itemDraftState, trackInventory: event.target.checked })} /> Track stock in Ledger</label> : null}
                          {!itemDraftState.id && itemDraftState.trackInventory ? <>
                            <label>Opening stock<input type="number" min="0" step="1" value={itemDraftState.openingStock} onChange={(event) => setItemDraftState({ ...itemDraftState, openingStock: event.target.value })} /></label>
                            <label>Low-stock warning at<input type="number" min="0" step="1" value={itemDraftState.lowStockThreshold} onChange={(event) => setItemDraftState({ ...itemDraftState, lowStockThreshold: event.target.value })} /></label>
                          </> : null}
                          <div className="v2-live-manager-actions wide"><button className="v2-live-button" type="button" onClick={() => setItemDraftState(null)}>Cancel</button><button className="v2-live-button v2-live-primary" type="submit" disabled={saving}>{saving ? "Saving…" : itemDraftState.id ? "Save changes" : "Save item"}</button></div>
                        </form>
                      ) : null}
                      <div className="v2-live-manager-list">
                        {items.map((item) => <div className="v2-live-manager-row" key={item.id}><div><strong>{item.name}</strong><small>₹{Number(item.selling_price_inr || 0).toFixed(2)} · {categories.find((category) => category.category_key === item.qlounge_category_key)?.title || "Not on Q Lounge"} · {item.online_order_enabled ? "Online" : "Not orderable"}</small></div><div className="v2-live-manager-actions"><button className="v2-live-button" type="button" disabled={saving} onClick={() => { setItemDraftState(itemDraft(item, categories)); setError(""); }}>Edit</button><button className="v2-live-button v2-live-danger" type="button" disabled={saving} onClick={() => removeItem(item)}>Remove</button></div></div>)}
                        {!items.length ? <p className="v2-live-muted">No catalogue items yet.</p> : null}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
