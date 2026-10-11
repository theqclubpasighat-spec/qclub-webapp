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


// A register row selects a game, then delegates charge creation to the existing
// authoritative session/timer/game flow. No manual independent charge is posted.
export const REGISTER_GAME_TYPES = [
  { id: "NORMAL_SNOOKER", label: "Normal Snooker" },
  { id: "QCHASE_RUMMY", label: "QChase / Rummy" },
  { id: "SIX_BALL_SNOOKER", label: "6-Ball Snooker" },
  { id: "TEN_BALL_SNOOKER", label: "10-Ball Snooker" },
  { id: "KITTY", label: "Kitty" },
  { id: "NORMAL_POOL", label: "American Pool" },
];

export function registerBillingModes(gameType) {
  switch (gameType) {
    case "NORMAL_SNOOKER":
      return [
        { id: "HOURLY", label: "By table time · hourly" },
        { id: "LOSER_PAYS", label: "Loser pays actual frame time" },
      ];
    case "QCHASE_RUMMY":
      return [
        { id: "PER_PLAYER", label: "Per game · ₹100 per active player" },
        { id: "HOURLY_SHARED", label: "By table time · split among active players" },
      ];
    case "SIX_BALL_SNOOKER":
    case "TEN_BALL_SNOOKER":
      return [{ id: "PER_PLAYER", label: "Per player / per game · existing game rules" }];
    case "KITTY":
      return [{ id: "PER_PLAYER", label: "Winner pays timed Kitty charge" }];
    case "NORMAL_POOL":
      return [{ id: "HOURLY", label: "By table time · hourly" }];
    default:
      return [];
  }
}

export function registerMatchFormats(gameType, billingMode) {
  if (["QCHASE_RUMMY", "KITTY", "NORMAL_POOL"].includes(gameType)) {
    return [{ id: "FLEX", label: "Flexible players" }];
  }
  if (gameType === "NORMAL_SNOOKER" && billingMode === "HOURLY") {
    return [
      { id: "FLEX", label: "Flexible players" },
      { id: "SINGLES", label: "Singles · 2 players" },
      { id: "DOUBLES", label: "Doubles · 2 teams" },
      { id: "CHAMPIONSHIP", label: "Championship · 3–6 players" },
    ];
  }
  return [
    { id: "SINGLES", label: "Singles · 2 players" },
    { id: "DOUBLES", label: "Doubles · 2 teams" },
    { id: "CHAMPIONSHIP", label: "Championship · 3–6 players" },
  ];
}

export function registerTableAllowsGame(table, gameType) {
  if (!table || !gameType) return false;
  if (table.table_type === "POOL") return gameType === "NORMAL_POOL";
  if (table.table_type === "MINI_SNOOKER") return [
    "NORMAL_SNOOKER", "QCHASE_RUMMY", "SIX_BALL_SNOOKER",
    "TEN_BALL_SNOOKER", "KITTY",
  ].includes(gameType);
  if (table.table_type === "FULL_SIZE_SNOOKER") return [
    "NORMAL_SNOOKER", "QCHASE_RUMMY", "SIX_BALL_SNOOKER",
    "TEN_BALL_SNOOKER", "KITTY",
  ].includes(gameType);
  return false;
}
