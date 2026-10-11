// Pure, UI-independent helpers for the Pasighat customer-first day sheet.
export function pasighatBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = name => parts.find(row => row.type === name)?.value || "";
  return [part("year"), part("month"), part("day")].join("-");
}

export function normalizeRegisterSearch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function mergeRegisterRows(dayRows, playerTabs, selectedDate, todayDate, search = "") {
  const openById = new Map((playerTabs || []).map(row => [row.customer_id, row]));
  const rows = new Map();
  for (const item of dayRows || []) {
    if (!item || !item.customer_id) continue;
    rows.set(item.customer_id, { ...item, open_tab: openById.get(item.customer_id) || null, carried_forward: false });
  }
  if (selectedDate === todayDate) {
    for (const tab of playerTabs || []) {
      if (!tab?.customer_id || rows.has(tab.customer_id)) continue;
      rows.set(tab.customer_id, {
        customer_id: tab.customer_id, name: tab.name, phone: tab.phone,
        first_activity_at: null, last_activity_at: null, activity_count: 0,
        open_tab: tab, carried_forward: true,
      });
    }
  }
  const query = normalizeRegisterSearch(search);
  return [...rows.values()].filter(item => {
    if (!query) return true;
    return normalizeRegisterSearch([item.name, item.phone].join(" ")).includes(query);
  }).sort((a, b) => {
    if (a.carried_forward !== b.carried_forward) return a.carried_forward ? 1 : -1;
    const da = Date.parse(a.first_activity_at || 0);
    const db = Date.parse(b.first_activity_at || 0);
    return da - db || String(a.name || "").localeCompare(String(b.name || ""));
  });
}

export function validateRegisterAllocation(item, allocations, availableCustomerIds) {
  if (!item || !item.id || !(Number(item.selling_price_inr) > 0) || item.is_unpriced || item.requires_price_configuration) {
    throw new Error("Choose a priced catalogue item.");
  }
  const allowed = new Set(availableCustomerIds || []);
  const recipients = Object.entries(allocations || {}).map(([customer_id, raw]) => ({
    customer_id, quantity: Number(raw),
  })).filter(row => row.quantity > 0);
  if (!recipients.length) throw new Error("Assign at least one item to a customer.");
  for (const row of recipients) {
    if (!allowed.has(row.customer_id) || !Number.isSafeInteger(row.quantity) || row.quantity <= 0 || row.quantity > 100) {
      throw new Error("Each allocation must identify a registered customer and a whole quantity between 1 and 100.");
    }
  }
  const totalQuantity = recipients.reduce((sum, row) => sum + row.quantity, 0);
  if (item.track_inventory && totalQuantity > Number(item.current_stock || 0)) {
    throw new Error("Insufficient stock for this entire allocation.");
  }
  return { recipients, totalQuantity, totalInr: Number(item.selling_price_inr) * totalQuantity };
}
