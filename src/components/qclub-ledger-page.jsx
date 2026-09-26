import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_ROOT = "/api/snooker/v1";
const AUTH_KEY = "qclub_ledger_auth_v1";
const DEVICE_KEY = "qclub_ledger_device_v1";

function money(value) {
  return "₹" + Number(value || 0).toFixed(2);
}

function makeFnbCostDraft(payload) {
  const rows = payload && payload.fnb_stock_wallet && Array.isArray(payload.fnb_stock_wallet.items)
    ? payload.fnb_stock_wallet.items
    : [];
  const result = {};
  rows.forEach(function(item) {
    result[item.item_id] = item.cost_price_inr == null ? "" : String(item.cost_price_inr);
  });
  return result;
}

function countdownLabel(expiresAt, nowMs) {
  if (!expiresAt) return "Cashfree order expiry applies";
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return "Cashfree order expiry applies";
  const seconds = Math.max(0, Math.ceil((expiry - Number(nowMs || Date.now())) / 1000));
  if (seconds <= 0) return "Expired";
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return "Expires in " + mins + ":" + secs;
}

function paymentStatusLabel(status) {
  const value = String(status || "PENDING").toUpperCase();
  if (["VERIFIED", "SUCCESS", "PAID", "RECEIVED"].includes(value)) return "PAYMENT VERIFIED";
  if (value === "FAILED") return "PAYMENT FAILED";
  if (value === "EXPIRED") return "PAYMENT EXPIRED";
  if (value === "CANCELLED") return "PAYMENT CANCELLED";
  return "WAITING FOR PAYMENT";
}

function dateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function makeKey(prefix) {
  const safePrefix = prefix || "web";
  if (globalThis.crypto && globalThis.crypto.randomUUID) {
    return safePrefix + "_" + globalThis.crypto.randomUUID();
  }
  return safePrefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}

function getDeviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = makeKey("qclub_web");
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

function readAuth() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.token || !parsed.role) return null;
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(AUTH_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function apiRequest(path, options) {
  const opts = options || {};
  const response = await fetch(API_ROOT + "/" + path, {
    method: opts.method || "GET",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: "Bearer " + opts.token } : {}),
    },
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error((payload && (payload.message || payload.error)) || "Request failed (" + response.status + ")");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function allowedGames(table, rules) {
  const map = {
    POOL: ["NORMAL_POOL"],
    MINI_SNOOKER: ["NORMAL_SNOOKER"],
    FULL_SIZE_SNOOKER: ["NORMAL_SNOOKER", "SIX_BALL_SNOOKER", "TEN_BALL_SNOOKER", "QCHASE_RUMMY"],
  };
  const keys = map[(table && table.table_type) || ""] || [];
  return (rules || []).filter(function(rule) { return keys.includes(rule.game_type); });
}

function elapsedLabel(session) {
  if (!session || !session.started_at) return "—";
  const start = Date.parse(session.started_at);
  const end = session.ended_at ? Date.parse(session.ended_at) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return hours ? hours + "h " + rest + "m" : rest + "m";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function receiptHtml(bill, session) {
  const customerName = (session && session.customer_name) || (bill && bill.customer_name) || "Customer";
  const customerPhone = (session && session.customer_phone) || (bill && bill.customer_phone) || "";
  const rows = (bill.items || []).map(function(item) {
    return "<tr><td>" + escapeHtml(item.description || item.item_type || "Item") + "</td><td style='text-align:right'>" +
      escapeHtml(item.quantity) + "</td><td style='text-align:right'>" + money(item.line_total_inr) + "</td></tr>";
  }).join("");
  return "<!doctype html><html><head><meta charset='utf-8'><title>" + escapeHtml(bill.bill_no || "Q Club Bill") +
    "</title><style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;color:#111}h1{margin-bottom:2px}.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{padding:8px;border-bottom:1px solid #ddd}th{text-align:left}.totals{margin-top:18px;text-align:right}.totals div{margin:5px 0}.grand{font-size:20px;font-weight:800}@media print{button{display:none}}</style></head><body>" +
    "<h1>The Q Club Pasighat</h1><div class='muted'>Private Ledger Receipt</div><h2>" + escapeHtml(bill.bill_no || "Final Bill") + "</h2>" +
    "<div>" + escapeHtml(customerName) + "</div><div class='muted'>" +
    escapeHtml(customerPhone) + "</div><table><thead><tr><th>Item</th><th style='text-align:right'>Qty</th><th style='text-align:right'>Amount</th></tr></thead><tbody>" +
    rows + "</tbody></table><div class='totals'><div>Game/Table: " + money(bill.game_total_inr) + "</div><div>F&B: " + money(bill.fnb_total_inr) +
    "</div><div>Discount: " + money(bill.discount_inr) + "</div><div class='grand'>Total: " + money(bill.total_inr) +
    "</div><div>Paid: " + money(bill.paid_inr) + "</div><div>Due: " + money(bill.due_inr) + "</div></div><script>window.onload=function(){window.print();}</script></body></html>";
}

function csvCell(value) {
  return '"' + String(value == null ? "" : value).replaceAll('"', '""') + '"';
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

const CSS = [
  ".qledger{min-height:100vh;background:radial-gradient(circle at top,#133426 0,#09140f 38%,#050908 100%);color:#f7fbf8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
  ".qledger *{box-sizing:border-box}.ql-wrap{max-width:1320px;margin:0 auto;padding:20px 16px 80px}.ql-top{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:16px;position:sticky;top:0;z-index:20;background:rgba(5,9,8,.93);backdrop-filter:blur(14px);padding:12px 0}",
  ".ql-brand{display:flex;gap:12px;align-items:center}.ql-logo{width:46px;height:46px;border-radius:14px;background:linear-gradient(145deg,#e9c766,#84631c);display:grid;place-items:center;color:#0b110d;font-size:23px;font-weight:900}.ql-title{font-size:20px;font-weight:900}.ql-sub{color:#9fb3a6;font-size:12px}.ql-server{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}",
  ".ql-pill{border:1px solid #2a4939;background:#0d2017;border-radius:999px;padding:7px 10px;font-size:12px;color:#c8d8ce}.ql-pill.good{border-color:#287653;color:#8ff0b7;background:#0c2a1b}.ql-pill.warn{border-color:#725c22;color:#f2d981;background:#2a210c}",
  ".ql-btn{border:1px solid #335344;background:#13241b;color:#f7fbf8;border-radius:11px;padding:10px 13px;font-weight:750;cursor:pointer}.ql-btn:disabled{opacity:.42;cursor:not-allowed}.ql-btn.primary{background:linear-gradient(135deg,#35d07f,#18a761);color:#031209;border-color:#46e596}.ql-btn.gold{background:linear-gradient(135deg,#e5c45c,#a47a1c);color:#161004;border-color:#ead06f}.ql-btn.danger{border-color:#773c3c;background:#2c1313;color:#ffb0b0}.ql-btn.ghost{background:transparent}",
  ".ql-tabs{display:flex;gap:8px;overflow:auto;padding-bottom:8px;margin-bottom:16px}.ql-tab{white-space:nowrap;border:1px solid #203a2d;background:#0a1711;color:#a9b9af;border-radius:11px;padding:10px 14px;font-weight:800;cursor:pointer}.ql-tab.active{color:#07130c;background:#79e7aa;border-color:#79e7aa}",
  ".ql-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px}.ql-card{grid-column:span 4;border:1px solid #1d392b;background:linear-gradient(160deg,rgba(18,39,28,.96),rgba(8,20,14,.96));border-radius:18px;padding:16px}.ql-card.wide{grid-column:span 8}.ql-card.full{grid-column:1/-1}.ql-card h3{margin:0 0 5px;font-size:17px}.ql-muted{color:#93a89b;font-size:12px;line-height:1.5}.ql-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.ql-space{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}",
  ".ql-table-status{font-size:11px;font-weight:900;padding:5px 8px;border-radius:999px}.ql-table-status.free{background:#0f3c26;color:#90f1b9}.ql-table-status.busy{background:#553e0d;color:#ffe08a}.ql-table-status.pause{background:#402b59;color:#ddbaff}.ql-section{margin:17px 0 9px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#e3c968;font-weight:900}",
  ".ql-input,.ql-select{width:100%;border:1px solid #294638;background:#08150f;color:#f7fbf8;border-radius:11px;padding:11px 12px;outline:none}.ql-label{display:block;font-size:12px;color:#abc0b3;margin:0 0 5px;font-weight:700}.ql-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ql-form-grid .full{grid-column:1/-1}",
  ".ql-list{display:flex;flex-direction:column;gap:9px}.ql-line{border:1px solid #1c382a;background:#08150f;border-radius:12px;padding:11px}.ql-line.selected{border-color:#69dca0;background:#0c2217}.ql-price{font-weight:900;color:#f0d06f}.ql-badge{font-size:11px;padding:4px 7px;border-radius:999px;background:#173025;color:#a8dabc}.ql-badge.bad{background:#3a1717;color:#ffb7b7}.ql-badge.gold{background:#3b2d0d;color:#f4da87}",
  ".ql-fnb-tools{display:grid;grid-template-columns:minmax(0,2fr) minmax(180px,1fr);gap:10px;margin-bottom:12px}.ql-fnb-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ql-fnb{border:1px solid #1c382a;background:#08150f;border-radius:14px;padding:12px;min-height:148px;display:flex;flex-direction:column;justify-content:space-between}.ql-fnb.disabled{opacity:.5}.ql-qty{display:flex;align-items:center;gap:8px}.ql-qty button{width:31px;height:31px;border-radius:9px;border:1px solid #315242;background:#11261b;color:white;font-weight:900;cursor:pointer}.ql-fnb-actionbar{position:sticky;bottom:12px;z-index:70;margin-top:14px;border:1px solid #3b6b50;background:rgba(7,20,13,.96);backdrop-filter:blur(16px);box-shadow:0 18px 46px rgba(0,0,0,.4);border-radius:16px;padding:12px 14px}.ql-fnb-actionbar .ql-btn{min-width:190px}.ql-fnb-spacer{display:none}",
  ".ql-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}.ql-modal{width:min(680px,100%);max-height:90vh;overflow:auto;border:1px solid #2c513e;background:#09150f;border-radius:20px;padding:18px}",
  ".ql-login{min-height:100vh;display:grid;place-items:center;padding:20px}.ql-login-card{width:min(440px,100%);border:1px solid #31513f;background:linear-gradient(155deg,#10261a,#07110c);border-radius:24px;padding:24px}.ql-login-logo{font-size:34px}.ql-login h1{margin:8px 0 3px}.ql-login p{color:#9fb3a6;margin:0 0 20px}",
  ".ql-toast{position:fixed;right:18px;bottom:20px;z-index:140;max-width:min(420px,calc(100vw - 36px));padding:12px 14px;border-radius:12px;background:#183425;border:1px solid #3f7355;color:#d8f7e5}.ql-error{background:#3d1616;border-color:#7d3434;color:#ffd1d1}.ql-empty{border:1px dashed #2d493a;border-radius:14px;padding:24px;text-align:center;color:#809488}",
  ".ql-paybox{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.ql-qr{background:white;border-radius:14px;padding:12px;display:inline-flex}.ql-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ql-stat{border:1px solid #1e3a2c;border-radius:14px;padding:13px;background:#09170f}.ql-stat strong{display:block;font-size:21px;margin-top:4px}",
  ".ql-pay-modal-bg{background:rgba(0,0,0,.9);z-index:160}.ql-pay-modal{width:min(650px,100%);max-height:96vh;overflow:auto;border:2px solid #d8b64e;background:radial-gradient(circle at top,#173524 0,#09150f 48%,#040806 100%);border-radius:26px;padding:26px;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.55)}.ql-pay-modal h2{margin:2px 0 0;font-size:28px;letter-spacing:.08em}.ql-pay-modal .ql-pay-kicker{font-size:12px;letter-spacing:.18em;color:#d8b64e;font-weight:900}.ql-big-qr{display:inline-flex;background:white;border-radius:22px;padding:18px;margin:18px auto 12px}.ql-pay-amount{font-size:clamp(38px,7vw,66px);font-weight:950;line-height:1;color:#7df0ad;margin:12px 0 4px}.ql-pay-status{margin:16px auto 8px;border-radius:12px;padding:12px 14px;font-weight:950;letter-spacing:.08em}.ql-pay-status.waiting{background:#122b59;color:#9cc6ff}.ql-pay-status.good{background:#0d4529;color:#8df0b7}.ql-pay-status.bad{background:#501c1c;color:#ffb0b0}.ql-pay-expiry{font-size:14px;color:#c6d5cb;font-variant-numeric:tabular-nums}.ql-pay-note{color:#91a69a;font-size:12px;margin-top:8px}",
  "@media(max-width:900px){.ql-card,.ql-card.wide{grid-column:span 6}.ql-fnb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ql-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
  "@media(max-width:620px){.ql-wrap{padding:12px 10px 72px}.ql-top{align-items:flex-start}.ql-title{font-size:17px}.ql-server{max-width:52%}.ql-card,.ql-card.wide{grid-column:1/-1!important}.ql-form-grid{grid-template-columns:1fr}.ql-fnb-tools{grid-template-columns:1fr}.ql-fnb-grid{grid-template-columns:1fr}.ql-paybox{grid-template-columns:1fr}.ql-stat-grid{grid-template-columns:1fr 1fr}.ql-modal{padding:14px}.ql-fnb-actionbar{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));margin:0;padding:11px;z-index:120}.ql-fnb-actionbar .ql-space{align-items:center}.ql-fnb-actionbar .ql-btn{min-width:0;flex:1}.ql-fnb-actionbar .ql-muted{display:none}.ql-fnb-spacer{display:block;height:108px}}"
].join("");

export default function QclubLedgerPage() {
  const [auth, setAuth] = useState(readAuth);
  const [pin, setPin] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);
  const [finance, setFinance] = useState(null);
  const [financeDraft, setFinanceDraft] = useState(null);
  const [fnbCostDraft, setFnbCostDraft] = useState({});
  const [showFnbCostSetup, setShowFnbCostSetup] = useState(false);
  const [bootstrap, setBootstrap] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [sessionDetails, setSessionDetails] = useState({});
  const [bills, setBills] = useState([]);
  const [operations, setOperations] = useState({ counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
  const [tab, setTab] = useState("desk");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [startTable, setStartTable] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [billDetail, setBillDetail] = useState(null);
  const [upiOrder, setUpiOrder] = useState(null);
  const [showUpiQrModal, setShowUpiQrModal] = useState(false);
  const [qrClock, setQrClock] = useState(Date.now());
  const [cashfreeQrError, setCashfreeQrError] = useState("");
  const cashfreeQrComponentRef = useRef(null);
  const cashfreeQrStartedRef = useRef("");
  const [quantities, setQuantities] = useState({});
  const [fnbSearch, setFnbSearch] = useState("");
  const [fnbCategory, setFnbCategory] = useState("ALL");
  const [fnbDestination, setFnbDestination] = useState("TABLE");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [showCatalogueAdd, setShowCatalogueAdd] = useState(false);
  const [catalogueDraft, setCatalogueDraft] = useState({
    name: "",
    category: "FOOD",
    unit: "unit",
    sellingPrice: "",
    costPrice: "",
    trackInventory: false,
    openingStock: "0",
    lowStockThreshold: "5",
  });
  const [cashAmount, setCashAmount] = useState("");
  const [cashTendered, setCashTendered] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [memberCheck, setMemberCheck] = useState(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerStatus, setLedgerStatus] = useState("ALL");
  const [ledgerDate, setLedgerDate] = useState("");
  const [startForm, setStartForm] = useState({
    gameType: "NORMAL_SNOOKER",
    customerName: "",
    customerPhone: "",
    isMember: false,
    participants: "",
  });

  const token = (auth && auth.token) || "";
  const role = (auth && auth.role) || "";
  const isAdmin = role === "ADMIN";

  const flash = useCallback(function(message, isError) {
    setNotice(message);
    setNoticeError(Boolean(isError));
    window.clearTimeout(window.__qclubLedgerToast);
    window.__qclubLedgerToast = window.setTimeout(function() { setNotice(""); }, 4500);
  }, []);

  const logout = useCallback(function(message) {
    sessionStorage.removeItem(AUTH_KEY);
    setAuth(null);
    setBootstrap(null);
    setSummary(null);
    setFinance(null);
    setFinanceDraft(null);
    setFnbCostDraft({});
    setShowFnbCostSetup(false);
    setSessions([]);
    setAllSessions([]);
    setSessionDetails({});
    setBills([]);
    setOperations({ counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
    setBillDetail(null);
    setUpiOrder(null);
    setShowUpiQrModal(false);
    if (message) flash(message, true);
  }, [flash]);

  const handleLogout = useCallback(async function() {
    try {
      if (token) await apiRequest("auth/logout", { method: "POST", token: token });
    } catch {
      // Local logout still proceeds if the network is unavailable.
    }
    logout();
  }, [logout, token]);

  const protectedCall = useCallback(async function(path, options) {
    try {
      return await apiRequest(path, { ...(options || {}), token: token });
    } catch (error) {
      if (error && error.status === 401) logout("Session expired. Please enter the PIN again.");
      throw error;
    }
  }, [logout, token]);

  const loadSessionDetails = useCallback(async function(rows) {
    const result = {};
    await Promise.all((rows || []).map(async function(session) {
      try {
        result[session.session_id] = await protectedCall("sessions/" + session.session_id);
      } catch {
        result[session.session_id] = session;
      }
    }));
    setSessionDetails(result);
  }, [protectedCall]);

  const refreshAll = useCallback(async function() {
    if (!token) return;
    setBusy(true);
    try {
      const values = await Promise.all([
        apiRequest("health"),
        protectedCall("bootstrap"),
        protectedCall("catalogue"),
        protectedCall("inventory"),
        protectedCall("sessions?scope=active&limit=200"),
        protectedCall("bills?limit=500"),
        protectedCall("sessions?limit=500"),
        protectedCall("dashboard/summary"),
        protectedCall("operations/inbox"),
      ]);
      const h = values[0];
      const boot = values[1];
      const cat = values[2];
      const inv = values[3];
      const sessionPayload = values[4];
      const billPayload = values[5];
      const allPayload = values[6];
      const summaryPayload = values[7];
      const operationsPayload = values[8];
      setHealth(h);
      setSummary(summaryPayload);
      setBootstrap(boot);
      setCatalogue((cat && (cat.items || cat.catalogue)) || []);
      setInventory((inv && (inv.items || inv.inventory)) || []);
      const openRows = (sessionPayload && sessionPayload.sessions) || [];
      setSessions(openRows);
      setAllSessions((allPayload && allPayload.sessions) || []);
      setBills((billPayload && billPayload.bills) || []);
      setOperations(operationsPayload || { counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
      if (isAdmin) {
        try {
          const financePayload = await protectedCall("finance/reserve");
          setFinance(financePayload);
          setFnbCostDraft(makeFnbCostDraft(financePayload));
          setFinanceDraft(financePayload && financePayload.plan ? {
            monthly_collection_target_inr: financePayload.plan.monthly_collection_target_inr,
            loan_service_inr: financePayload.plan.categories.loan_service_inr,
            electricity_inr: financePayload.plan.categories.electricity_inr,
            staff_salary_inr: financePayload.plan.categories.staff_salary_inr,
            supabase_inr: financePayload.plan.categories.supabase_inr,
            msg91_inr: financePayload.plan.categories.msg91_inr,
            misc_inr: financePayload.plan.categories.misc_inr,
            personal_inr: financePayload.plan.categories.personal_inr,
            legacy_liability_inr: financePayload.plan.legacy_liability_inr,
            legacy_liability_paid_inr: financePayload.plan.legacy_liability_paid_inr,
            due_day: financePayload.plan.due_day,
          } : null);
        } catch (financeError) {
          setFinance(null);
          setFinanceDraft(null);
          setFnbCostDraft({});
          flash(financeError.message || "Unable to load Admin finance reserve.", true);
        }
      } else {
        setFinance(null);
        setFinanceDraft(null);
        setFnbCostDraft({});
      }
      await loadSessionDetails(openRows);
    } catch (error) {
      flash(error.message || "Unable to load Q Club Ledger.", true);
    } finally {
      setBusy(false);
    }
  }, [flash, isAdmin, loadSessionDetails, protectedCall, token]);

  const refreshLiveState = useCallback(async function() {
    if (!token) return;
    try {
      const values = await Promise.all([
        protectedCall("sessions?scope=active&limit=200"),
        protectedCall("operations/inbox"),
      ]);
      const openRows = (values[0] && values[0].sessions) || [];
      setSessions(openRows);
      setOperations(values[1] || { counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
      await loadSessionDetails(openRows);
    } catch {
      // Keep the last known live state visible; manual refresh surfaces detailed errors.
    }
  }, [loadSessionDetails, protectedCall, token]);

  useEffect(function() {
    apiRequest("health").then(setHealth).catch(function() { setHealth(null); });
  }, []);

  useEffect(function() {
    if (token) refreshAll();
  }, [token, refreshAll]);

  useEffect(function() {
    if (!token) return undefined;
    const timer = window.setInterval(refreshLiveState, 5000);
    return function() { window.clearInterval(timer); };
  }, [token, refreshLiveState]);

  useEffect(function() {
    if (!showUpiQrModal || !upiOrder || !upiOrder.payment_id) return undefined;
    setQrClock(Date.now());
    const clockTimer = window.setInterval(function() {
      setQrClock(Date.now());
    }, 1000);
    return function() {
      window.clearInterval(clockTimer);
    };
  }, [showUpiQrModal, upiOrder && upiOrder.payment_id]);

  useEffect(function() {
    if (!showUpiQrModal || !upiOrder || !upiOrder.payment_id || !upiOrder.payment_session_id) return undefined;
    const status = String(upiOrder.status || "PENDING").toUpperCase();
    if (status !== "PENDING") return undefined;

    let disposed = false;
    let component = null;
    const paymentKey = String(upiOrder.payment_id);

    async function startCashfreeQr() {
      try {
        setCashfreeQrError("");
        if (!window.Cashfree) {
          throw new Error("Cashfree Element SDK is unavailable. Refresh the page and try again.");
        }

        const mountNode = document.getElementById("qclub-cashfree-upi-qr");
        if (!mountNode) return;
        mountNode.innerHTML = "";

        // Cashfree's upiQr size is an explicit pixel size. Keep the element
        // smaller than the mobile modal so the QR is never clipped/squeezed.
        const qrSize = Math.max(220, Math.min(300, window.innerWidth - 110));
        mountNode.style.width = qrSize + "px";
        mountNode.style.height = qrSize + "px";
        mountNode.style.minWidth = qrSize + "px";
        mountNode.style.minHeight = qrSize + "px";

        const cashfree = window.Cashfree({ mode: "production" });
        component = cashfree.create("upiQr", {
          values: { size: qrSize + "px" },
        });
        cashfreeQrComponentRef.current = component;

        component.on("loaderror", function(data) {
          if (disposed) return;
          const message = data && data.error && data.error.message
            ? data.error.message
            : "Cashfree could not load the UPI QR.";
          setCashfreeQrError(message);
        });

        component.on("ready", function() {
          if (disposed || cashfreeQrStartedRef.current === paymentKey) return;
          cashfreeQrStartedRef.current = paymentKey;
          Promise.resolve(cashfree.pay({
            paymentMethod: component,
            paymentSessionId: upiOrder.payment_session_id,
            redirect: "if_required",
          })).then(function(result) {
            if (disposed || !result) return;
            if (result.error) {
              setCashfreeQrError(result.error.message || "Cashfree UPI QR payment could not be started.");
              return;
            }
            if (result.paymentDetails) {
              verifyPayment(upiOrder.payment_id);
            }
          }).catch(function(error) {
            if (!disposed) setCashfreeQrError(error && error.message ? error.message : "Cashfree UPI QR payment failed to start.");
          });
        });

        component.mount("#qclub-cashfree-upi-qr");
      } catch (error) {
        if (!disposed) setCashfreeQrError(error && error.message ? error.message : "Cashfree UPI QR is unavailable.");
      }
    }

    startCashfreeQr();

    return function() {
      disposed = true;
      if (component && typeof component.unmount === "function") {
        try { component.unmount(); } catch {}
      }
      if (cashfreeQrComponentRef.current === component) cashfreeQrComponentRef.current = null;
    };
  }, [showUpiQrModal, upiOrder && upiOrder.payment_id, upiOrder && upiOrder.payment_session_id, upiOrder && upiOrder.status]);

  useEffect(function() {
    if (!showUpiQrModal || !upiOrder || !upiOrder.payment_id || String(upiOrder.status || "").toUpperCase() !== "PENDING") return undefined;
    let stopped = false;

    async function pollPayment() {
      try {
        const result = await protectedCall("payments/" + upiOrder.payment_id);
        if (stopped) return;
        setUpiOrder(function(current) {
          if (!current || current.payment_id !== upiOrder.payment_id) return current;
          return { ...current, ...result };
        });
        const nextStatus = String(result.status || "PENDING").toUpperCase();
        if (nextStatus !== "PENDING") {
          flash(paymentStatusLabel(nextStatus) + ".", !["VERIFIED", "SUCCESS", "PAID", "RECEIVED"].includes(nextStatus));
          if (billDetail && billDetail.bill_id) {
            try {
              const detail = await protectedCall("bills/" + billDetail.bill_id);
              if (!stopped) setBillDetail(detail);
            } catch {
              // Keep the terminal payment state visible even if bill refresh is temporarily unavailable.
            }
          }
          refreshAll();
        }
      } catch {
        // A transient status-check failure must not close the QR or mark payment failed.
      }
    }

    pollPayment();
    const pollTimer = window.setInterval(pollPayment, 3000);
    return function() {
      stopped = true;
      window.clearInterval(pollTimer);
    };
  }, [showUpiQrModal, upiOrder && upiOrder.payment_id, upiOrder && upiOrder.status, billDetail && billDetail.bill_id, protectedCall, refreshAll, flash]);

  async function login(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!pin.trim()) return;
    setLoginBusy(true);
    try {
      const result = await apiRequest("auth/login", {
        method: "POST",
        body: {
          pin: pin.trim(),
          device_id: getDeviceId(),
          client_version: "qclub-ledger-web-1.0",
        },
      });
      const next = {
        token: result.access_token,
        expiresAt: result.expires_at,
        role: result.role,
        staffId: result.staff_id,
        displayName: result.display_name,
      };
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(next));
      setAuth(next);
      setPin("");
      flash("Welcome " + (next.displayName || next.role) + ".");
    } catch (error) {
      flash(error && error.status === 429 ? "Too many failed attempts. Try again later." : "Invalid or unavailable PIN.", true);
    } finally {
      setLoginBusy(false);
    }
  }

  const rules = (bootstrap && bootstrap.game_rules) || [];
  const tables = (bootstrap && bootstrap.tables) || [];

  const sessionByTable = useMemo(function() {
    const map = {};
    sessions.forEach(function(session) {
      if (["ACTIVE", "PAUSED", "ENDED"].includes(session.status)) map[session.table_id] = session;
    });
    return map;
  }, [sessions]);

  const sessionLookup = useMemo(function() {
    const map = {};
    allSessions.concat(sessions).forEach(function(row) {
      if (row && row.session_id) map[row.session_id] = row;
    });
    return map;
  }, [allSessions, sessions]);

  const todayBills = useMemo(function() {
    const today = new Date().toDateString();
    return bills.filter(function(bill) {
      const value = bill.finalized_at || bill.created_at;
      return value && new Date(value).toDateString() === today;
    });
  }, [bills]);

  const todaySales = summary ? Number(summary.today_realized_sales_inr || 0) : todayBills.reduce(function(sum, bill) { return sum + Number(bill.paid_inr || 0); }, 0);
  const outstanding = summary ? Number(summary.outstanding_all_inr || 0) : bills.reduce(function(sum, bill) { return sum + Number(bill.due_inr || 0); }, 0);
  const todayFinalizedCount = summary ? Number(summary.today_finalized_bills || 0) : todayBills.length;
  const selectedSession = sessions.find(function(row) { return row.session_id === selectedSessionId; }) || null;

  const fnbCategories = useMemo(function() {
    return ["ALL"].concat(Array.from(new Set(catalogue.map(function(item) {
      return String(item.category || "Other").trim() || "Other";
    }))).sort(function(a, b) { return a.localeCompare(b); }));
  }, [catalogue]);

  const filteredCatalogue = useMemo(function() {
    const query = fnbSearch.trim().toLowerCase();
    return catalogue.filter(function(item) {
      const category = String(item.category || "Other").trim() || "Other";
      if (fnbCategory !== "ALL" && category !== fnbCategory) return false;
      if (!query) return true;
      return [item.name, category].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [catalogue, fnbCategory, fnbSearch]);

  const selectedFnbCount = Object.values(quantities).reduce(function(sum, q) { return sum + Number(q || 0); }, 0);
  const selectedFnbTotal = catalogue.reduce(function(sum, item) {
    const qty = Number(quantities[item.id] || 0);
    return sum + (qty * Number(item.selling_price_inr || 0));
  }, 0);

  const filteredBills = useMemo(function() {
    const query = ledgerSearch.trim().toLowerCase();
    return bills.filter(function(bill) {
      const session = sessionLookup[bill.session_id];
      const haystack = [
        bill.bill_no,
        bill.bill_id,
        bill.customer_name,
        bill.customer_phone,
        session && session.customer_name,
        session && session.customer_phone,
      ].filter(Boolean).join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (ledgerStatus !== "ALL" && bill.status !== ledgerStatus) return false;
      if (ledgerDate) {
        const value = bill.finalized_at || bill.created_at;
        if (!value) return false;
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(value));
        if (date !== ledgerDate) return false;
      }
      return true;
    });
  }, [bills, ledgerDate, ledgerSearch, ledgerStatus, sessionLookup]);

  function openStart(table) {
    const options = allowedGames(table, rules);
    setStartTable(table);
    setMemberCheck(null);
    setStartForm({
      gameType: (options[0] && options[0].game_type) || "NORMAL_SNOOKER",
      customerName: "",
      customerPhone: "",
      isMember: false,
      participants: "",
    });
  }

  async function verifyStartMember() {
    if (!startForm.customerName.trim() && !startForm.customerPhone.trim()) {
      flash("Enter the customer name or mobile number first.", true);
      return;
    }
    setBusy(true);
    try {
      const result = await protectedCall(
        "members/verify?phone=" + encodeURIComponent(startForm.customerPhone.trim()) +
        "&name=" + encodeURIComponent(startForm.customerName.trim())
      );
      setMemberCheck(result);
      setStartForm({ ...startForm, isMember: Boolean(result && result.verified) });
      if (result && result.verified) {
        flash("Membership verified" + (result.member && result.member.tier ? ": " + result.member.tier : "") + ".");
      } else {
        flash("No active membership found. Walk-in rate will be used.", true);
      }
    } catch (error) {
      setMemberCheck(null);
      setStartForm({ ...startForm, isMember: false });
      flash(error.message || "Unable to verify membership.", true);
    } finally {
      setBusy(false);
    }
  }

  async function editSession(session) {
    const name = window.prompt("Customer / Host name:", session.customer_name || "");
    if (name == null || !name.trim()) return;
    const phone = window.prompt("WhatsApp mobile (10 digits):", session.customer_phone || "");
    if (phone == null) return;
    const normalizedPhone = String(phone).replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(normalizedPhone)) {
      flash("Enter a valid 10-digit mobile number.", true);
      return;
    }

    setBusy(true);
    try {
      const membership = await protectedCall(
        "members/verify?phone=" + encodeURIComponent(normalizedPhone) +
        "&name=" + encodeURIComponent(name.trim())
      );
      await protectedCall("sessions/" + session.session_id, {
        method: "PATCH",
        body: {
          customer_name: name.trim(),
          customer_phone: normalizedPhone,
          is_member: Boolean(membership && membership.verified),
        },
      });
      flash(membership && membership.verified ? "Customer updated and membership verified." : "Customer updated. Walk-in rate applies.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to update customer.", true);
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    if (!startTable) return;
    if (!startForm.customerName.trim() || !/^\d{10}$/.test(startForm.customerPhone.trim())) {
      flash("Enter customer name and a valid 10-digit mobile number.", true);
      return;
    }
    setBusy(true);
    try {
      const players = startForm.participants.split(",").map(function(v) { return v.trim(); }).filter(Boolean);
      if (!players.includes(startForm.customerName.trim())) players.unshift(startForm.customerName.trim());
      await protectedCall("sessions", {
        method: "POST",
        body: {
          table_id: startTable.table_id,
          game_type: startForm.gameType,
          customer_name: startForm.customerName.trim(),
          customer_phone: startForm.customerPhone.trim(),
          is_member: Boolean(startForm.isMember),
          participant_names: players,
          idempotency_key: makeKey("session"),
        },
      });
      setStartTable(null);
      flash("Session started on the server.");
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function patchSession(sessionId, action) {
    setBusy(true);
    try {
      await protectedCall("sessions/" + sessionId, { method: "PATCH", body: { action: action } });
      flash(action === "PAUSE" ? "Game timer paused." : "Game timer resumed.");
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function recordGame(session) {
    const defaultPlayers = (session.participant_names || []).join(", ");
    const entered = window.prompt("Players in this completed game (comma separated):", defaultPlayers);
    if (entered == null) return;
    const players = entered.split(",").map(function(v) { return v.trim(); }).filter(Boolean);
    if (!players.length) {
      flash("At least one player is required.", true);
      return;
    }
    setBusy(true);
    try {
      await protectedCall("sessions/" + session.session_id + "/games", {
        method: "POST",
        body: {
          player_names: players,
          player_count: players.length,
          idempotency_key: makeKey("game"),
        },
      });
      flash("Completed game recorded.");
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function voidGame(game) {
    if (!isAdmin) {
      flash("Admin PIN is required to void a completed game.", true);
      return;
    }
    const reason = window.prompt("Reason for voiding this completed game:");
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await protectedCall("games/" + game.id + "/void-admin", { method: "POST", body: { reason: reason.trim() } });
      flash("Game voided with audit reason.");
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function voidFnbLine(line) {
    if (!isAdmin) {
      flash("Admin PIN is required to void an F&B line.", true);
      return;
    }
    const reason = window.prompt("Reason for voiding " + (line.item_name_snapshot || "this F&B item") + ":");
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await protectedCall("fnb-lines/" + line.id + "/void-admin", {
        method: "POST",
        body: { reason: reason.trim(), return_stock: true },
      });
      flash("F&B line voided and tracked stock returned.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to void F&B item.", true);
    } finally {
      setBusy(false);
    }
  }

  async function finalizeBill(session) {
    let discount = 0;
    if (isAdmin) {
      const answer = window.prompt("Discount amount in ₹ (leave 0 for none):", "0");
      if (answer == null) return;
      discount = Math.max(0, Number(answer || 0));
      if (!Number.isFinite(discount)) {
        flash("Invalid discount.", true);
        return;
      }
    }
    setBusy(true);
    try {
      const bill = await protectedCall("bills/finalize", {
        method: "POST",
        body: {
          session_id: session.session_id,
          discount_inr: discount,
          idempotency_key: makeKey("bill"),
        },
      });
      setBillDetail(bill);
      setCashAmount(Number(bill.due_inr || 0).toFixed(2));
      setCashTendered(Number(bill.due_inr || 0).toFixed(2));
      setUpiAmount(Number(bill.due_inr || 0).toFixed(2));
      setTab("ledger");
      flash("Bill " + (bill.bill_no || "") + " finalized.");
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function addFnb() {
    if (fnbDestination === "TABLE" && !selectedSession) {
      flash("Select an active table/session first.", true);
      return;
    }
    const lines = catalogue.map(function(item) {
      return { item: item, qty: Number(quantities[item.id] || 0) };
    }).filter(function(row) {
      return row.qty > 0 && !row.item.requires_price_configuration && !row.item.is_unpriced;
    }).map(function(row) {
      return { item_id: row.item.id, quantity: row.qty };
    });
    if (!lines.length) {
      flash("Select at least one priced item.", true);
      return;
    }
    setBusy(true);
    try {
      if (fnbDestination === "WALK_IN") {
        const bill = await protectedCall("bills/walk-in-fnb", {
          method: "POST",
          body: {
            lines: lines,
            customer_name: walkInName.trim() || null,
            customer_phone: walkInPhone.trim() || null,
            idempotency_key: makeKey("walkin-fnb"),
          },
        });
        setBillDetail(bill);
        setCashAmount(Number(bill.due_inr || 0).toFixed(2));
        setCashTendered(Number(bill.due_inr || 0).toFixed(2));
        setUpiAmount(Number(bill.due_inr || 0).toFixed(2));
        setWalkInName("");
        setWalkInPhone("");
        setTab("ledger");
        flash("Walk-in F&B bill " + (bill.bill_no || "") + " created.");
      } else {
        await protectedCall("sessions/" + selectedSession.session_id + "/fnb", {
          method: "POST",
          body: { lines: lines, idempotency_key: makeKey("fnb") },
        });
        flash("F&B added to the live table bill.");
      }
      setQuantities({});
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function loadBill(billId, options) {
    const opts = options || {};
    setBusy(true);
    try {
      const detail = await protectedCall("bills/" + billId);
      setBillDetail(detail);
      setCashAmount(Number(detail.due_inr || 0).toFixed(2));
      setCashTendered(Number(detail.due_inr || 0).toFixed(2));
      setUpiAmount(Number(detail.due_inr || 0).toFixed(2));
      if (!opts.preserveUpi) {
        setUpiOrder(null);
        setShowUpiQrModal(false);
      }
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshBillDetail(options) {
    if (!billDetail || !billDetail.bill_id) return;
    await loadBill(billDetail.bill_id, options);
    await refreshAll();
  }

  async function recordCash() {
    if (!billDetail) return;
    const amount = Number(cashAmount || 0);
    const tendered = Number(cashTendered || amount);
    if (!(amount > 0) || tendered < amount) {
      flash("Check cash amount/tendered.", true);
      return;
    }
    setBusy(true);
    try {
      const result = await protectedCall("payments/cash", {
        method: "POST",
        body: {
          bill_id: billDetail.bill_id,
          amount_applied_inr: amount,
          cash_tendered_inr: tendered,
          idempotency_key: makeKey("cash"),
          staff_notes: "QClubLedger web terminal",
        },
      });
      flash(Number(result.change_inr) > 0 ? "Cash recorded. Return change " + money(result.change_inr) + "." : "Cash payment recorded.");
      await refreshBillDetail();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function createUpi() {
    if (!billDetail) return;
    const amount = Number(upiAmount || 0);
    if (!(amount > 0)) {
      flash("Enter a valid UPI amount.", true);
      return;
    }
    const session = sessionLookup[billDetail.session_id];
    setBusy(true);
    try {
      const result = await protectedCall("payments/upi", {
        method: "POST",
        body: {
          bill_id: billDetail.bill_id,
          amount_inr: amount,
          customer_phone: (session && session.customer_phone) || billDetail.customer_phone || "",
          customer_name: (session && session.customer_name) || billDetail.customer_name || "",
          idempotency_key: makeKey("upi"),
        },
      });
      setUpiOrder(result);
      setCashfreeQrError("");
      cashfreeQrStartedRef.current = "";
      setQrClock(Date.now());
      setShowUpiQrModal(true);
      flash("Cashfree UPI order created. The secure QR is loading.");
      await refreshBillDetail({ preserveUpi: true });
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment(paymentId) {
    setBusy(true);
    try {
      const result = await protectedCall("payments/" + paymentId);
      flash("Payment status: " + result.status + ".");
      if (upiOrder && upiOrder.payment_id === paymentId) setUpiOrder({ ...upiOrder, ...result });
      await refreshBillDetail({ preserveUpi: true });
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function sendReceipt() {
    if (!billDetail) return;
    const session = sessionLookup[billDetail.session_id];
    setBusy(true);
    try {
      const payment = upiOrder && upiOrder.payment_id ? upiOrder : null;
      await protectedCall("notifications/receipt", {
        method: "POST",
        body: {
          bill_id: billDetail.bill_id,
          phone: (session && session.customer_phone) || billDetail.customer_phone || "",
          payment_id: payment ? payment.payment_id : undefined,
          idempotency_key: makeKey("receipt"),
        },
      });
      flash(payment && payment.payment_url ? "Receipt and Cashfree payment link submitted to MSG91." : "Receipt submitted to MSG91.");
      await refreshBillDetail({ preserveUpi: true });
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function printReceipt() {
    if (!billDetail) return;
    const session = sessionLookup[billDetail.session_id];
    const popup = window.open("", "_blank");
    if (!popup) {
      flash("Pop-up blocked. Allow pop-ups to print the receipt.", true);
      return;
    }
    popup.document.open();
    popup.document.write(receiptHtml(billDetail, session));
    popup.document.close();
  }

  function downloadReceipt() {
    if (!billDetail) return;
    const session = sessionLookup[billDetail.session_id];
    const filename = (billDetail.bill_no || "qclub-receipt").replace(/[^a-z0-9_-]+/gi, "_") + ".html";
    downloadBlob(filename, receiptHtml(billDetail, session), "text/html;charset=utf-8");
  }

  function exportLedgerCsv(rows) {
    const selected = rows || filteredBills;
    const header = ["Bill No", "Customer", "Mobile", "Finalized", "Status", "Game/Table", "F&B", "Discount", "Total", "Paid", "Due"];
    const lines = [header.map(csvCell).join(",")];
    selected.forEach(function(bill) {
      const session = sessionLookup[bill.session_id];
      lines.push([
        bill.bill_no || bill.bill_id,
        (session && session.customer_name) || bill.customer_name || "",
        (session && session.customer_phone) || bill.customer_phone || "",
        bill.finalized_at || bill.created_at || "",
        bill.status,
        bill.game_total_inr,
        bill.fnb_total_inr,
        bill.discount_inr,
        bill.total_inr,
        bill.paid_inr,
        bill.due_inr,
      ].map(csvCell).join(","));
    });
    downloadBlob("qclub-ledger-" + (ledgerDate || "export") + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  function printDailyClosing() {
    const businessDate = (summary && summary.business_date) || new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    const rows = bills.filter(function(bill) {
      const value = bill.finalized_at || bill.created_at;
      if (!value) return false;
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
      }).format(new Date(value)) === businessDate;
    });
    const body = rows.map(function(bill) {
      const session = sessionLookup[bill.session_id];
      return "<tr><td>" + escapeHtml(bill.bill_no || bill.bill_id) + "</td><td>" +
        escapeHtml((session && session.customer_name) || bill.customer_name || "") + "</td><td style='text-align:right'>" + money(bill.total_inr) +
        "</td><td style='text-align:right'>" + money(bill.paid_inr) + "</td><td style='text-align:right'>" + money(bill.due_inr) + "</td></tr>";
    }).join("");
    const html = "<!doctype html><html><head><meta charset='utf-8'><title>Q Club Daily Closing " + escapeHtml(businessDate) +
      "</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:24px auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd}th{text-align:left}.stats{display:flex;gap:18px;flex-wrap:wrap;margin:18px 0}.stats div{border:1px solid #ddd;padding:10px 14px;border-radius:8px}</style></head><body><h1>The Q Club Pasighat</h1><h2>Daily Closing — " +
      escapeHtml(businessDate) + "</h2><div class='stats'><div>Finalized bills: <b>" + escapeHtml(summary && summary.today_finalized_bills) +
      "</b></div><div>Cash: <b>" + money(summary && summary.today_cash_inr) + "</b></div><div>UPI: <b>" + money(summary && summary.today_upi_inr) +
      "</b></div><div>Realized: <b>" + money(summary && summary.today_realized_sales_inr) + "</b></div><div>Total outstanding: <b>" +
      money(summary && summary.outstanding_all_inr) + "</b></div></div><table><thead><tr><th>Bill</th><th>Customer</th><th style='text-align:right'>Total</th><th style='text-align:right'>Paid</th><th style='text-align:right'>Due</th></tr></thead><tbody>" +
      body + "</tbody></table><script>window.onload=function(){window.print();}</script></body></html>";
    const popup = window.open("", "_blank");
    if (!popup) {
      flash("Pop-up blocked. Allow pop-ups to print the daily closing.", true);
      return;
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  }

  async function saveFinancePlan() {
    if (!isAdmin || !financeDraft) return;
    setBusy(true);
    try {
      const payload = {};
      Object.keys(financeDraft).forEach(function(key) {
        if (key === "due_day") payload[key] = Number(financeDraft[key]);
        else payload[key] = Number(financeDraft[key] || 0);
      });
      const result = await protectedCall("finance/reserve", {
        method: "PATCH",
        body: payload,
      });
      setFinance(result);
      setFnbCostDraft(makeFnbCostDraft(result));
      setFinanceDraft(result && result.plan ? {
        monthly_collection_target_inr: result.plan.monthly_collection_target_inr,
        loan_service_inr: result.plan.categories.loan_service_inr,
        electricity_inr: result.plan.categories.electricity_inr,
        staff_salary_inr: result.plan.categories.staff_salary_inr,
        supabase_inr: result.plan.categories.supabase_inr,
        msg91_inr: result.plan.categories.msg91_inr,
        misc_inr: result.plan.categories.misc_inr,
        personal_inr: result.plan.categories.personal_inr,
        legacy_liability_inr: result.plan.legacy_liability_inr,
        legacy_liability_paid_inr: result.plan.legacy_liability_paid_inr,
        due_day: result.plan.due_day,
      } : null);
      flash("Finance reserve plan updated.");
    } catch (error) {
      flash(error.message || "Unable to update finance reserve.", true);
    } finally {
      setBusy(false);
    }
  }

  function updateFinanceDraft(field, value) {
    setFinanceDraft(function(current) {
      return { ...(current || {}), [field]: value };
    });
  }

  function updateFnbCostDraft(itemId, value) {
    setFnbCostDraft(function(current) {
      return { ...(current || {}), [itemId]: value };
    });
  }

  async function saveFnbCosts() {
    if (!isAdmin || !finance || !finance.fnb_stock_wallet) return;
    const rows = (finance.fnb_stock_wallet.items || []).map(function(item) {
      const raw = fnbCostDraft[item.item_id];
      if (raw == null || String(raw).trim() === "") return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return { invalid: true, item: item.name };
      return { item_id: item.item_id, cost_price_inr: value };
    });

    const invalid = rows.find(function(row) { return row && row.invalid; });
    if (invalid) {
      flash("Check the cost entered for " + invalid.item + ".", true);
      return;
    }

    const payloadRows = rows.filter(Boolean);
    if (!payloadRows.length) {
      flash("Enter at least one cost price first.", true);
      return;
    }

    setBusy(true);
    try {
      const result = await protectedCall("finance/fnb-costs", {
        method: "PATCH",
        body: { items: payloadRows },
      });
      setFinance(result);
      setFnbCostDraft(makeFnbCostDraft(result));
      setShowFnbCostSetup(false);
      flash("F&B cost prices saved. Stock Wallet updated.");
    } catch (error) {
      flash(error.message || "Unable to save F&B cost prices.", true);
    } finally {
      setBusy(false);
    }
  }

  function updateCatalogueDraft(field, value) {
    setCatalogueDraft(function(current) {
      return { ...current, [field]: value };
    });
  }

  async function addCatalogueItem() {
    if (!isAdmin) {
      flash("Admin PIN is required to add catalogue items.", true);
      return;
    }
    const name = catalogueDraft.name.trim();
    const sellingPrice = Number(catalogueDraft.sellingPrice);
    const costPrice = String(catalogueDraft.costPrice).trim() === "" ? null : Number(catalogueDraft.costPrice);
    const openingStock = catalogueDraft.trackInventory ? Number(catalogueDraft.openingStock || 0) : null;
    const lowStockThreshold = catalogueDraft.trackInventory ? Number(catalogueDraft.lowStockThreshold || 0) : null;

    if (!name) {
      flash("Enter an item name.", true);
      return;
    }
    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      flash("Enter a valid selling price.", true);
      return;
    }
    if (costPrice != null && (!Number.isFinite(costPrice) || costPrice < 0)) {
      flash("Check the cost price.", true);
      return;
    }
    if (catalogueDraft.trackInventory && (!Number.isFinite(openingStock) || openingStock < 0 || !Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
      flash("Check opening stock and low-stock threshold.", true);
      return;
    }

    setBusy(true);
    try {
      await protectedCall("catalogue/items", {
        method: "POST",
        body: {
          name: name,
          category: catalogueDraft.category,
          unit: catalogueDraft.unit || "unit",
          selling_price_inr: sellingPrice,
          cost_price_inr: costPrice,
          track_inventory: Boolean(catalogueDraft.trackInventory),
          opening_stock: openingStock,
          low_stock_threshold: lowStockThreshold,
        },
      });
      setCatalogueDraft({
        name: "",
        category: "FOOD",
        unit: "unit",
        sellingPrice: "",
        costPrice: "",
        trackInventory: false,
        openingStock: "0",
        lowStockThreshold: "5",
      });
      setShowCatalogueAdd(false);
      flash("Item added to the Ledger catalogue.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to add item.", true);
    } finally {
      setBusy(false);
    }
  }

  async function removeCatalogueItem(item) {
    if (!isAdmin) {
      flash("Admin PIN is required to remove catalogue items.", true);
      return;
    }
    const ok = window.confirm(
      "Delete " + item.name + " from the active Q Club Ledger catalogue?\n\nHistorical bills will remain unchanged."
    );
    if (!ok) return;
    setBusy(true);
    try {
      await protectedCall("catalogue/items/" + encodeURIComponent(item.id), { method: "DELETE" });
      flash(item.name + " removed from the active Ledger catalogue.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to remove item.", true);
    } finally {
      setBusy(false);
    }
  }

  async function adminInventory(item, mode) {
    if (!isAdmin) {
      flash("Admin PIN is required for inventory changes.", true);
      return;
    }
    const answer = window.prompt(
      mode === "restock" ? "Restock " + item.name + ": quantity to add" : "Adjust " + item.name + ": quantity delta (+/-)",
      mode === "restock" ? "1" : "-1"
    );
    if (answer == null) return;
    const quantity = Number(answer);
    if (!Number.isFinite(quantity) || quantity === 0) {
      flash("Invalid quantity.", true);
      return;
    }
    const reason = window.prompt("Reason:", mode === "restock" ? "Restock" : "Stock correction") || "";
    setBusy(true);
    try {
      await protectedCall("inventory/" + (mode === "restock" ? "restock" : "adjust"), {
        method: "POST",
        body: mode === "restock"
          ? { item_id: item.item_id || item.id, quantity: Math.abs(quantity), reason: reason, idempotency_key: makeKey("restock") }
          : { item_id: item.item_id || item.id, quantity_delta: quantity, reason: reason, idempotency_key: makeKey("adjust") },
      });
      flash("Inventory updated on server.");
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  if (!auth) {
    return (
      <div className="qledger">
        <style>{CSS}</style>
        <div className="ql-login">
          <form className="ql-login-card" onSubmit={login}>
            <div className="ql-login-logo">🎱</div>
            <h1>The Q Club Ledger</h1>
            <p>Private staff terminal • Pasighat</p>
            <label className="ql-label">Staff / Admin PIN</label>
            <input
              className="ql-input"
              value={pin}
              onChange={function(event) { setPin(event.target.value.replace(/\D/g, "").slice(0, 12)); }}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="Enter PIN"
              autoFocus
            />
            <button className="ql-btn primary" style={{ width: "100%", marginTop: 14 }} disabled={loginBusy || !pin}>
              {loginBusy ? "CONNECTING…" : "LOGIN TO LEDGER"}
            </button>
            <div className="ql-muted" style={{ marginTop: 14 }}>
              PIN is sent only to the protected Q Club backend. It is not stored in this browser.
            </div>
            <div className="ql-row" style={{ marginTop: 12 }}>
              <span className={"ql-pill " + (health && health.ok ? "good" : "warn")}>
                {health && health.ok ? "SERVER ONLINE" : "SERVER CHECKING / OFFLINE"}
              </span>
            </div>
          </form>
        </div>
        {notice ? <div className={"ql-toast " + (noticeError ? "ql-error" : "")}>{notice}</div> : null}
      </div>
    );
  }

  return (
    <div className="qledger">
      <style>{CSS}</style>
      <div className="ql-wrap">
        <div className="ql-top">
          <div className="ql-brand">
            <div className="ql-logo">Q</div>
            <div>
              <div className="ql-title">THE Q CLUB LEDGER</div>
              <div className="ql-sub">Private Staff & Admin Terminal • Live Server</div>
            </div>
          </div>
          <div className="ql-server">
            <span className={"ql-pill " + (health && health.database_ready ? "good" : "warn")}>DB {health && health.database_ready ? "LIVE" : "OFF"}</span>
            <span className={"ql-pill " + (health && health.cashfree_ready ? "good" : "warn")}>Cashfree {health && health.cashfree_ready ? "READY" : "CHECK"}</span>
            <span className={"ql-pill " + (health && health.msg91_ready ? "good" : "warn")}>MSG91 {health && health.msg91_ready ? "READY" : "CHECK"}</span>
            <span className="ql-pill">{auth.displayName || role}</span>
            <button className="ql-btn ghost" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="ql-tabs">
          {[
            ["desk", "🎱 Desk Ledger"],
            ["fnb", "🍽 Add F&B"],
            ["activity", "🌐 Website Activity"],
            ["ledger", "🧾 Ledger History"],
            ...(isAdmin ? [["finance", "💰 Finance Reserve"]] : []),
            ["admin", isAdmin ? "⚙ Admin & Inventory" : "📦 Inventory"],
          ].map(function(entry) {
            return <button key={entry[0]} className={"ql-tab " + (tab === entry[0] ? "active" : "")} onClick={function() { setTab(entry[0]); }}>{entry[1]}</button>;
          })}
          <button className="ql-tab" onClick={refreshAll}>{busy ? "Refreshing…" : "↻ Refresh"}</button>
        </div>

        {tab === "desk" ? (
          <>
            <div className="ql-stat-grid">
              <div className="ql-stat"><span className="ql-muted">Active tables</span><strong>{sessions.filter(function(s) { return ["ACTIVE", "PAUSED"].includes(s.status); }).length}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Today&apos;s finalized bills</span><strong>{todayFinalizedCount}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Today&apos;s realized sales</span><strong>{money(todaySales)}</strong><div className="ql-muted">Cash {money(summary && summary.today_cash_inr)} • UPI {money(summary && summary.today_upi_inr)}</div></div>
              <div className="ql-stat"><span className="ql-muted">Outstanding all ledger</span><strong>{money(outstanding)}</strong></div>
            </div>
            <div className="ql-section">Live tables</div>
            <div className="ql-grid">
              {tables.map(function(table) {
                const session = sessionByTable[table.table_id];
                const detail = session ? sessionDetails[session.session_id] || session : null;
                const rule = rules.find(function(r) { return r.game_type === (session && session.game_type); });
                const games = (detail && detail.games) || [];
                const fnb = (detail && detail.fnb_lines) || [];
                const liveFnb = fnb.filter(function(line) { return line.status !== "VOIDED"; }).reduce(function(sum, line) { return sum + Number(line.line_total_inr || 0); }, 0);
                const gameTotal = games.filter(function(game) { return game.status !== "VOIDED"; }).reduce(function(sum, game) { return sum + Number(game.calculated_charge_inr || 0); }, 0);
                return (
                  <div className="ql-card" key={table.table_id}>
                    <div className="ql-space">
                      <div>
                        <h3>Table {table.table_no} — {table.display_name}</h3>
                        <div className="ql-muted">{String(table.table_type || "").replaceAll("_", " ")}</div>
                      </div>
                      <span className={"ql-table-status " + (!session ? "free" : session.status === "PAUSED" ? "pause" : "busy")}>{!session ? "AVAILABLE" : session.status}</span>
                    </div>
                    <div className="ql-row" style={{ marginTop: 10 }}>
                      <span className="ql-badge">Walk-in {table.price_per_hour_inr != null ? money(table.price_per_hour_inr) + "/h" : "—"}</span>
                      <span className="ql-badge gold">Member {table.member_price_per_hour_inr != null ? money(table.member_price_per_hour_inr) + "/h" : "—"}</span>
                    </div>
                    {!session ? (
                      <>
                        <div className="ql-muted" style={{ margin: "16px 0" }}>Ready for a new server-authoritative session.</div>
                        <button className="ql-btn primary" onClick={function() { openStart(table); }}>+ Enter Customer in Ledger</button>
                      </>
                    ) : (
                      <>
                        <div className="ql-section">Current session</div>
                        <div><strong>{session.customer_name || "Guest"}</strong> {session.is_member ? <span className="ql-badge gold">MEMBER</span> : <span className="ql-badge">NON-MEMBER</span>}</div>
                        <div className="ql-muted">{session.customer_phone || "No phone"} • {elapsedLabel(session)}</div>
                        <div className="ql-row" style={{ marginTop: 8 }}>
                          <span className="ql-badge">{(rule && rule.display_name) || session.game_type}</span>
                          <span className="ql-badge">Games {games.filter(function(g) { return g.status !== "VOIDED"; }).length}</span>
                          <span className="ql-badge">F&B {money(liveFnb)}</span>
                          {rule && rule.billing_mode !== "HOURLY" ? <span className="ql-badge gold">Game total {money(gameTotal)}</span> : null}
                        </div>
                        {games.length ? (
                          <div className="ql-list" style={{ marginTop: 9 }}>
                            {games.slice(-3).map(function(game) {
                              return (
                                <div className="ql-line ql-space" key={game.id}>
                                  <div className="ql-muted">Game #{game.game_number} • {game.player_count_snapshot} player(s) • {money(game.calculated_charge_inr)}</div>
                                  {game.status !== "VOIDED" ? (isAdmin ? <button className="ql-btn danger" onClick={function() { voidGame(game); }}>Void</button> : <span className="ql-badge">ADMIN VOID</span>) : <span className="ql-badge bad">VOIDED</span>}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {fnb.length ? (
                          <div className="ql-list" style={{ marginTop: 9 }}>
                            {fnb.slice(-3).map(function(line) {
                              return (
                                <div className="ql-line ql-space" key={line.id}>
                                  <div className="ql-muted">{line.item_name_snapshot || "F&B"} × {line.quantity} • {money(line.line_total_inr)}</div>
                                  {line.status !== "VOIDED" ? (isAdmin ? <button className="ql-btn danger" onClick={function() { voidFnbLine(line); }}>Void F&B</button> : <span className="ql-badge">ADMIN VOID</span>) : <span className="ql-badge bad">VOIDED</span>}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        <div className="ql-row" style={{ marginTop: 12 }}>
                          {rule && rule.billing_mode === "PER_PLAYER_PER_GAME" && session.status !== "ENDED" ? <button className="ql-btn gold" onClick={function() { recordGame(session); }}>✓ Game Complete</button> : null}
                          {session.status === "ACTIVE" && rule && rule.timer_required ? <button className="ql-btn" onClick={function() { patchSession(session.session_id, "PAUSE"); }}>Pause</button> : null}
                          {session.status === "PAUSED" ? <button className="ql-btn" onClick={function() { patchSession(session.session_id, "RESUME"); }}>Resume</button> : null}
                          <button className="ql-btn" onClick={function() { editSession(session); }}>Edit Customer</button>
                          <button className="ql-btn" onClick={function() { setSelectedSessionId(session.session_id); setTab("fnb"); }}>+ F&B</button>
                          <button className="ql-btn primary" onClick={function() { finalizeBill(session); }}>Settle & Pay</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {tab === "fnb" ? (
          <>
            <div className="ql-card full">
              <div className="ql-space">
                <div>
                  <h3>Add F&B</h3>
                  <div className="ql-muted">Choose a playing table or create a separate walk-in bill. Prices and stock are verified by the server.</div>
                  <div className="ql-row" style={{ marginTop: 10 }}>
                    <button className={"ql-btn " + (fnbDestination === "TABLE" ? "primary" : "ghost")} onClick={function() { setFnbDestination("TABLE"); }}>Playing Table</button>
                    <button className={"ql-btn " + (fnbDestination === "WALK_IN" ? "primary" : "ghost")} onClick={function() { setFnbDestination("WALK_IN"); setSelectedSessionId(""); }}>Walk-in / Separate Bill</button>
                  </div>
                </div>
                <div style={{ minWidth: 250 }}>
                  {fnbDestination === "TABLE" ? (
                    <>
                      <label className="ql-label">Session / Table</label>
                      <select className="ql-select" value={selectedSessionId} onChange={function(e) { setSelectedSessionId(e.target.value); }}>
                        <option value="">Select session</option>
                        {sessions.map(function(session) {
                          const table = tables.find(function(t) { return t.table_id === session.table_id; });
                          return <option key={session.session_id} value={session.session_id}>Table {(table && table.table_no) || "?"} — {session.customer_name || "Guest"}</option>;
                        })}
                      </select>
                    </>
                  ) : (
                    <>
                      <label className="ql-label">Visitor name (optional)</label>
                      <input className="ql-input" value={walkInName} onChange={function(e) { setWalkInName(e.target.value); }} placeholder="Leave blank for Walk-in" />
                      <label className="ql-label" style={{ marginTop: 8 }}>Mobile (optional)</label>
                      <input className="ql-input" value={walkInPhone} onChange={function(e) { setWalkInPhone(e.target.value); }} placeholder="For receipt if wanted" />
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="ql-section">Live catalogue</div>
            <div className="ql-fnb-tools">
              <div>
                <label className="ql-label">Search food / drinks</label>
                <input className="ql-input" value={fnbSearch} onChange={function(e) { setFnbSearch(e.target.value); }} placeholder="Type item name..." />
              </div>
              <div>
                <label className="ql-label">Category</label>
                <select className="ql-select" value={fnbCategory} onChange={function(e) { setFnbCategory(e.target.value); }}>
                  {fnbCategories.map(function(category) {
                    return <option key={category} value={category}>{category === "ALL" ? "All categories" : category}</option>;
                  })}
                </select>
              </div>
            </div>
            <div className="ql-fnb-grid">
              {filteredCatalogue.map(function(item) {
                const qty = Number(quantities[item.id] || 0);
                const unpriced = item.requires_price_configuration || item.is_unpriced || !(Number(item.selling_price_inr) > 0);
                const out = item.track_inventory && Number(item.current_stock || 0) <= 0;
                const disabled = unpriced || out;
                return (
                  <div className={"ql-fnb " + (disabled ? "disabled" : "")} key={item.id}>
                    <div>
                      <div className="ql-space"><strong>{item.name}</strong><span className="ql-badge">{item.category}</span></div>
                      <div className="ql-price" style={{ marginTop: 8 }}>{unpriced ? "PRICE NOT CONFIGURED" : money(item.selling_price_inr)}</div>
                      <div className="ql-muted">{item.track_inventory ? "Stock " + (item.current_stock == null ? 0 : item.current_stock) + " " + (item.unit || "") : "Fresh prepared / stock not tracked"}</div>
                    </div>
                    <div className="ql-qty" style={{ marginTop: 12 }}>
                      <button disabled={disabled || qty <= 0} onClick={function() { setQuantities({ ...quantities, [item.id]: Math.max(0, qty - 1) }); }}>−</button>
                      <strong>{qty}</strong>
                      <button disabled={disabled} onClick={function() { setQuantities({ ...quantities, [item.id]: qty + 1 }); }}>+</button>
                    </div>
                  </div>
                );
              })}
              {!filteredCatalogue.length ? <div className="ql-empty" style={{ gridColumn: "1/-1" }}>No catalogue items match this search/category.</div> : null}
            </div>
            <div className="ql-fnb-actionbar">
              <div className="ql-space">
                <div>
                  <strong>{selectedFnbCount} item(s) • {money(selectedFnbTotal)}</strong>
                  <div className="ql-muted">Always visible on mobile. Server verifies price and stock before saving.</div>
                </div>
                <div className="ql-row" style={{ justifyContent: "flex-end" }}>
                  {selectedFnbCount > 0 ? <button className="ql-btn ghost" disabled={busy} onClick={function() { setQuantities({}); }}>Clear</button> : null}
                  <button className="ql-btn primary" disabled={(fnbDestination === "TABLE" && !selectedSessionId) || busy || selectedFnbCount <= 0} onClick={addFnb}>
                    {busy ? "Adding…" : (fnbDestination === "WALK_IN" ? "Create Separate F&B Bill" : "Add to Table Bill")}
                  </button>
                </div>
              </div>
            </div>
            <div className="ql-fnb-spacer" aria-hidden="true" />
          </>
        ) : null}

        {tab === "activity" ? (
          <>
            <div className="ql-stat-grid">
              <div className="ql-stat"><span className="ql-muted">Website bookings</span><strong>{Number(operations && operations.counts && operations.counts.bookings || 0)}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Q Lounge orders</span><strong>{Number(operations && operations.counts && operations.counts.food_orders || 0)}</strong></div>
              <div className="ql-stat"><span className="ql-muted">QShop receipts</span><strong>{Number(operations && operations.counts && operations.counts.shop_receipts || 0)}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Sync</span><strong>5s</strong><div className="ql-muted">Android/PC staff bridge</div></div>
            </div>
            <div className="ql-section">Website operations inbox</div>
            <div className="ql-grid">
              <div className="ql-card wide">
                <div className="ql-space"><div><h3>Book Table</h3><div className="ql-muted">Reservations from the live website. A reservation does not occupy a physical table until staff checks the customer into the Ledger.</div></div><span className="ql-badge">{(operations.bookings || []).length}</span></div>
                <div className="ql-list" style={{ marginTop: 12, maxHeight: "52vh", overflow: "auto" }}>
                  {(operations.bookings || []).length ? (operations.bookings || []).slice(0, 25).map(function(row) {
                    return <div className="ql-line" key={row.id || (row.booking_date + row.time_slot)}>
                      <div className="ql-space"><strong>{row.item_label || "Table booking"}</strong><span className={"ql-badge " + (["REJECTED","FAILED","CANCELLED"].includes(String(row.status || "").toUpperCase()) ? "bad" : "gold")}>{row.status || "PENDING"}</span></div>
                      <div>{row.customer_name || "Customer"} {row.customer_phone ? "• " + row.customer_phone : ""}</div>
                      <div className="ql-muted">{row.booking_date || "Date not set"} • {row.slot_label || row.time_slot || "Time not set"} {Number(row.amount_inr) > 0 ? "• " + money(row.amount_inr) : ""}</div>
                    </div>;
                  }) : <div className="ql-empty">No website bookings.</div>}
                </div>
              </div>
              <div className="ql-card wide">
                <div className="ql-space"><div><h3>Q Lounge</h3><div className="ql-muted">Online food/drink orders from the public website.</div></div><span className="ql-badge">{(operations.food_orders || []).length}</span></div>
                <div className="ql-list" style={{ marginTop: 12, maxHeight: "52vh", overflow: "auto" }}>
                  {(operations.food_orders || []).length ? (operations.food_orders || []).slice(0, 25).map(function(row) {
                    return <div className="ql-line" key={row.id || row.order_no}>
                      <div className="ql-space"><strong>{row.order_no || row.id || "Q Lounge order"}</strong><span className="ql-badge">{row.payment_status || "—"}</span></div>
                      <div>{row.customer_name || "Customer"} {row.table_label ? "• " + row.table_label : ""}</div>
                      <div className="ql-muted">{money(row.total_inr)} • {(row.items || []).map(function(item) { return (item.display_name || item.name || "Item") + " × " + Number(item.quantity || 0); }).join(", ") || "No item detail"}</div>
                    </div>;
                  }) : <div className="ql-empty">No Q Lounge website orders.</div>}
                </div>
              </div>
              <div className="ql-card full">
                <div className="ql-space"><div><h3>QShop</h3><div className="ql-muted">Paid/recorded QShop receipts from the live website.</div></div><span className="ql-badge">{(operations.shop_receipts || []).length}</span></div>
                <div className="ql-list" style={{ marginTop: 12, maxHeight: "42vh", overflow: "auto" }}>
                  {(operations.shop_receipts || []).length ? (operations.shop_receipts || []).slice(0, 25).map(function(row) {
                    return <div className="ql-line" key={row.id || row.order_no}>
                      <div className="ql-space"><strong>{row.order_no || row.id || "QShop order"}</strong><span className="ql-badge">{row.pickup_status || row.payment_status || "—"}</span></div>
                      <div>{row.customer_name || "Customer"} {row.customer_phone ? "• " + row.customer_phone : ""}</div>
                      <div className="ql-muted">{money(row.total_inr)} • {(row.items || []).map(function(item) { return (item.display_name || item.name || "Item") + " × " + Number(item.quantity || 0); }).join(", ") || "No item detail"}</div>
                    </div>;
                  }) : <div className="ql-empty">No QShop receipts.</div>}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === "finance" && isAdmin ? (
          <>
            <div className="ql-section">Admin-only finance reserve</div>
            {finance ? (
              <>
                <div className="ql-stat-grid">
                  <div className="ql-stat">
                    <span className="ql-muted">Realized table revenue</span>
                    <strong>{money(finance.actuals && finance.actuals.month_realized_table_revenue_inr)}</strong>
                    <div className="ql-muted">
                      Cash {money(finance.actuals && finance.actuals.month_table_cash_inr)} • UPI {money(finance.actuals && finance.actuals.month_table_upi_inr)}
                    </div>
                  </div>
                  <div className="ql-stat">
                    <span className="ql-muted">Protected target to date</span>
                    <strong>{money(finance.reserve && finance.reserve.protected_target_to_date_inr)}</strong>
                    <div className="ql-muted">
                      Regular {money(finance.reserve && finance.reserve.regular_target_to_date_inr)} • Liability {money(finance.reserve && finance.reserve.liability_target_to_date_inr)}
                    </div>
                  </div>
                  <div className="ql-stat">
                    <span className="ql-muted">Safe to spend</span>
                    <strong>{money(finance.reserve && finance.reserve.safe_to_spend_inr)}</strong>
                    <div className="ql-muted">
                      Shortfall {money(finance.reserve && finance.reserve.reserve_shortfall_inr)}
                    </div>
                  </div>
                  <div className="ql-stat">
                    <span className="ql-muted">Civil / electrical liability left</span>
                    <strong>{money(finance.plan && finance.plan.legacy_liability_remaining_inr)}</strong>
                    <div className="ql-muted">
                      Planned this month {money(finance.plan && finance.plan.planned_monthly_liability_allocation_inr)}
                    </div>
                  </div>
                  <div className="ql-stat">
                    <span className="ql-muted">F&B kept separate</span>
                    <strong>{money(finance.actuals && finance.actuals.month_fnb_charges_excluded_inr)}</strong>
                    <div className="ql-muted">
                      Not included in Table Finance Reserve
                    </div>
                  </div>
                  <div className="ql-stat">
                    <span className="ql-muted">Outstanding table revenue</span>
                    <strong>{money(finance.actuals && finance.actuals.month_outstanding_table_inr)}</strong>
                    <div className="ql-muted">
                      Finalized table charges not yet realized
                    </div>
                  </div>
                </div>

                <div className="ql-card full" style={{ marginTop: 14 }}>
                  <div className="ql-space">
                    <div>
                      <h3>F&B Stock Wallet</h3>
                      <div className="ql-muted">Simple rule: keep enough money to buy the sold stock again. The rest is F&B profit.</div>
                    </div>
                    <button
                      className="ql-btn gold"
                      onClick={function() { setShowFnbCostSetup(function(value) { return !value; }); }}
                    >
                      {showFnbCostSetup ? "Close Cost Setup" : "Set Cost Prices"}
                    </button>
                  </div>

                  <div className="ql-stat-grid" style={{ marginTop: 12 }}>
                    <div className="ql-stat">
                      <span className="ql-muted">F&B sold this month</span>
                      <strong>{money(finance.fnb_stock_wallet && finance.fnb_stock_wallet.month_sales_inr)}</strong>
                    </div>
                    <div className="ql-stat">
                      <span className="ql-muted">Keep for restock</span>
                      <strong>{money(finance.fnb_stock_wallet && finance.fnb_stock_wallet.keep_for_restock_inr)}</strong>
                      <div className="ql-muted">Do not spend this amount</div>
                    </div>
                    <div className="ql-stat">
                      <span className="ql-muted">F&B profit left</span>
                      <strong>{money(finance.fnb_stock_wallet && finance.fnb_stock_wallet.profit_left_inr)}</strong>
                      <div className="ql-muted">After replacement cost only</div>
                    </div>
                    <div className="ql-stat">
                      <span className="ql-muted">Need cost setup</span>
                      <strong>{Number(finance.fnb_stock_wallet && finance.fnb_stock_wallet.missing_cost_count || 0)}</strong>
                      <div className="ql-muted">Items without a purchase cost</div>
                    </div>
                  </div>

                  {Number(finance.fnb_stock_wallet && finance.fnb_stock_wallet.missing_cost_count || 0) > 0 ? (
                    <div className="ql-line" style={{ marginTop: 12 }}>
                      <strong>Safe mode is ON.</strong>
                      <div className="ql-muted" style={{ marginTop: 4 }}>
                        Until you enter what an item costs us, the system keeps 100% of that item's selling price for restocking. This prevents fake profit.
                      </div>
                    </div>
                  ) : (
                    <div className="ql-line" style={{ marginTop: 12 }}>
                      <strong>Cost setup complete.</strong>
                      <div className="ql-muted" style={{ marginTop: 4 }}>The Stock Wallet is now using the purchase cost entered for every saleable F&B item.</div>
                    </div>
                  )}

                  {showFnbCostSetup ? (
                    <div style={{ marginTop: 14 }}>
                      <div className="ql-muted" style={{ marginBottom: 10 }}>
                        Enter only what we actually pay to buy or prepare one unit. Example: if Coke sells for ₹40 and costs us ₹25, enter 25.
                      </div>
                      <div className="ql-list">
                        {(finance.fnb_stock_wallet && finance.fnb_stock_wallet.items || []).map(function(item) {
                          return (
                            <div className="ql-line" key={item.item_id}>
                              <div className="ql-space" style={{ alignItems: "center", gap: 12 }}>
                                <div style={{ minWidth: 0 }}>
                                  <strong>{item.name}</strong>
                                  <div className="ql-muted">
                                    We sell at {money(item.selling_price_inr)}
                                    {Number(item.month_quantity_sold || 0) > 0 ? " • Sold " + Number(item.month_quantity_sold || 0) + " this month" : ""}
                                  </div>
                                </div>
                                <label style={{ minWidth: 130 }}>
                                  <span className="ql-label">We pay ₹</span>
                                  <input
                                    className="ql-input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    inputMode="decimal"
                                    placeholder="Enter cost"
                                    value={fnbCostDraft[item.item_id] == null ? "" : fnbCostDraft[item.item_id]}
                                    onChange={function(event) { updateFnbCostDraft(item.item_id, event.target.value); }}
                                  />
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button className="ql-btn primary" style={{ width: "100%", marginTop: 12 }} disabled={busy} onClick={saveFnbCosts}>
                        {busy ? "Saving…" : "Save Cost Prices"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="ql-grid" style={{ marginTop: 14 }}>
                  <div className="ql-card wide">
                    <h3>Automatic reserve rule</h3>
                    <div className="ql-muted">Table revenue only. F&B/Q Lounge/QShop are excluded. Accounting reserve only — this does not move money out of the bank automatically.</div>
                    <div className="ql-list" style={{ marginTop: 12 }}>
                      <div className="ql-line ql-space">
                        <span>Daily collection target</span>
                        <strong>{money(finance.plan && finance.plan.daily_collection_target_inr)}</strong>
                      </div>
                      <div className="ql-line ql-space">
                        <span>Daily regular reserve</span>
                        <strong>{money(finance.reserve && finance.reserve.daily_regular_reserve_inr)}</strong>
                      </div>
                      <div className="ql-line ql-space">
                        <span>Daily civil/electrical reserve</span>
                        <strong>{money(finance.reserve && finance.reserve.daily_liability_reserve_inr)}</strong>
                      </div>
                      <div className="ql-line ql-space">
                        <span>Every ₹100 collected</span>
                        <strong>₹{Number(finance.reserve && finance.reserve.per_100_regular_inr || 0).toFixed(2)} regular + ₹{Number(finance.reserve && finance.reserve.per_100_liability_inr || 0).toFixed(2)} liability</strong>
                      </div>
                      <div className="ql-line ql-space">
                        <span>Month target remaining</span>
                        <strong>{money(finance.reserve && finance.reserve.month_target_remaining_inr)}</strong>
                      </div>
                    </div>
                    <div className="ql-muted" style={{ marginTop: 10 }}>{finance.source_note}</div>
                  </div>

                  <div className="ql-card">
                    <h3>Monthly commitments</h3>
                    <div className="ql-list" style={{ marginTop: 12 }}>
                      <div className="ql-line ql-space"><span>Loan service</span><strong>{money(finance.plan.categories.loan_service_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>Electricity</span><strong>{money(finance.plan.categories.electricity_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>Staff salary</span><strong>{money(finance.plan.categories.staff_salary_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>Supabase</span><strong>{money(finance.plan.categories.supabase_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>MSG91</span><strong>{money(finance.plan.categories.msg91_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>Miscellaneous</span><strong>{money(finance.plan.categories.misc_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>Personal</span><strong>{money(finance.plan.categories.personal_inr)}</strong></div>
                      <div className="ql-line ql-space"><span>Total regular</span><strong>{money(finance.plan.regular_commitments_inr)}</strong></div>
                    </div>
                  </div>

                  <div className="ql-card full">
                    <div className="ql-space">
                      <div>
                        <h3>Edit finance plan</h3>
                        <div className="ql-muted">ADMIN only. Changes alter the reserve calculation immediately.</div>
                      </div>
                      <span className="ql-badge gold">Due day {finance.plan.due_day}</span>
                    </div>
                    {financeDraft ? (
                      <>
                        <div className="ql-form-grid" style={{ marginTop: 12 }}>
                          {[
                            ["monthly_collection_target_inr", "Monthly collection target"],
                            ["loan_service_inr", "Loan service"],
                            ["electricity_inr", "Electricity"],
                            ["staff_salary_inr", "Staff salary"],
                            ["supabase_inr", "Supabase"],
                            ["msg91_inr", "MSG91"],
                            ["misc_inr", "Miscellaneous"],
                            ["personal_inr", "Personal"],
                            ["legacy_liability_inr", "Civil/electrical liability"],
                            ["legacy_liability_paid_inr", "Liability already paid"],
                          ].map(function(row) {
                            return (
                              <label key={row[0]}>
                                <span className="ql-label">{row[1]}</span>
                                <input
                                  className="ql-input"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={financeDraft[row[0]]}
                                  onChange={function(event) { updateFinanceDraft(row[0], event.target.value); }}
                                />
                              </label>
                            );
                          })}
                          <label>
                            <span className="ql-label">Monthly due day</span>
                            <input
                              className="ql-input"
                              type="number"
                              min="1"
                              max="31"
                              step="1"
                              value={financeDraft.due_day}
                              onChange={function(event) { updateFinanceDraft("due_day", event.target.value); }}
                            />
                          </label>
                        </div>
                        <div className="ql-row" style={{ marginTop: 12 }}>
                          <button className="ql-btn primary" disabled={busy} onClick={saveFinancePlan}>{busy ? "Saving…" : "Save Finance Plan"}</button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="ql-empty">Admin finance reserve is loading or unavailable.</div>
            )}
          </>
        ) : null}

        {tab === "ledger" ? (
          <div className="ql-grid">
            <div className="ql-card" style={{ gridColumn: "span 5" }}>
              <div className="ql-space"><div><h3>Ledger history</h3><div className="ql-muted">Search customer, mobile or bill number</div></div><span className="ql-badge">{filteredBills.length}/{bills.length}</span></div>
              <div className="ql-form-grid" style={{ marginTop: 12 }}>
                <div className="full">
                  <label className="ql-label">Search</label>
                  <input className="ql-input" value={ledgerSearch} onChange={function(e) { setLedgerSearch(e.target.value); }} placeholder="Name, mobile, bill no." />
                </div>
                <div>
                  <label className="ql-label">Status</label>
                  <select className="ql-select" value={ledgerStatus} onChange={function(e) { setLedgerStatus(e.target.value); }}>
                    <option value="ALL">All</option>
                    <option value="PAID">Paid</option>
                    <option value="UNPAID">Unpaid</option>
                    <option value="PARTIALLY_PAID">Partially paid</option>
                    <option value="PAYMENT_PENDING">Payment pending</option>
                  </select>
                </div>
                <div>
                  <label className="ql-label">Business date</label>
                  <input className="ql-input" type="date" value={ledgerDate} onChange={function(e) { setLedgerDate(e.target.value); }} />
                </div>
              </div>
              <div className="ql-row" style={{ marginTop: 10 }}>
                <button className="ql-btn" onClick={function() { exportLedgerCsv(filteredBills); }}>Export CSV</button>
                <button className="ql-btn gold" onClick={printDailyClosing}>Print Daily Closing</button>
                <button className="ql-btn ghost" onClick={function() { setLedgerSearch(""); setLedgerStatus("ALL"); setLedgerDate(""); }}>Clear</button>
              </div>
              <div className="ql-list" style={{ marginTop: 12, maxHeight: "70vh", overflow: "auto" }}>
                {filteredBills.length ? filteredBills.map(function(bill) {
                  const session = sessionLookup[bill.session_id];
                  return (
                    <button key={bill.bill_id} className={"ql-line " + (billDetail && billDetail.bill_id === bill.bill_id ? "selected" : "")} style={{ color: "inherit", textAlign: "left", cursor: "pointer" }} onClick={function() { loadBill(bill.bill_id); }}>
                      <div className="ql-space"><strong>{bill.bill_no || bill.bill_id}</strong><span className={"ql-badge " + (Number(bill.due_inr) > 0 ? "bad" : "")}>{bill.status}</span></div>
                      <div className="ql-muted">{(session && session.customer_name) || bill.customer_name || "Customer"} • {dateTime(bill.finalized_at || bill.created_at)}</div>
                      <div className="ql-space" style={{ marginTop: 5 }}><span>{money(bill.total_inr)}</span><span className="ql-muted">Due {money(bill.due_inr)}</span></div>
                    </button>
                  );
                }) : <div className="ql-empty">No bills match these filters.</div>}
              </div>
            </div>

            <div className="ql-card" style={{ gridColumn: "span 7" }}>
              {!billDetail ? <div className="ql-empty">Select a bill or finalize a live session.</div> : (
                <>
                  <div className="ql-space">
                    <div><h3>{billDetail.bill_no || "Final Bill"}</h3><div className="ql-muted">Server bill ID: {billDetail.bill_id}</div></div>
                    <span className={"ql-badge " + (Number(billDetail.due_inr) > 0 ? "bad" : "")}>{billDetail.status}</span>
                  </div>
                  <div className="ql-stat-grid" style={{ marginTop: 13 }}>
                    <div className="ql-stat"><span className="ql-muted">Game/Table</span><strong>{money(billDetail.game_total_inr)}</strong></div>
                    <div className="ql-stat"><span className="ql-muted">F&B</span><strong>{money(billDetail.fnb_total_inr)}</strong></div>
                    <div className="ql-stat"><span className="ql-muted">Paid</span><strong>{money(billDetail.paid_inr)}</strong></div>
                    <div className="ql-stat"><span className="ql-muted">Due</span><strong>{money(billDetail.due_inr)}</strong></div>
                  </div>
                  {Number(billDetail.discount_inr) > 0 ? <div className="ql-muted" style={{ marginTop: 8 }}>Discount: {money(billDetail.discount_inr)}</div> : null}
                  <div className="ql-row" style={{ marginTop: 12 }}>
                    <button className="ql-btn" onClick={printReceipt}>Print / Save PDF</button>
                    <button className="ql-btn" onClick={downloadReceipt}>Download Receipt HTML</button>
                    <button className="ql-btn ghost" onClick={refreshBillDetail}>Refresh Bill</button>
                  </div>

                  <div className="ql-section">Payments — Cash / UPI / Split</div>
                  <div className="ql-paybox">
                    <div className="ql-line">
                      <strong>Cash</strong>
                      <label className="ql-label" style={{ marginTop: 8 }}>Amount applied</label>
                      <input className="ql-input" type="number" min="0" step="0.01" value={cashAmount} onChange={function(e) { setCashAmount(e.target.value); }} />
                      <label className="ql-label" style={{ marginTop: 8 }}>Cash tendered</label>
                      <input className="ql-input" type="number" min="0" step="0.01" value={cashTendered} onChange={function(e) { setCashTendered(e.target.value); }} />
                      <button className="ql-btn primary" style={{ width: "100%", marginTop: 9 }} disabled={busy || Number(billDetail.due_inr) <= 0} onClick={recordCash}>Record Cash</button>
                    </div>
                    <div className="ql-line">
                      <strong>UPI</strong>
                      <label className="ql-label" style={{ marginTop: 8 }}>UPI amount</label>
                      <input className="ql-input" type="number" min="0" step="0.01" value={upiAmount} onChange={function(e) { setUpiAmount(e.target.value); }} />
                      <button className="ql-btn gold" style={{ width: "100%", marginTop: 9 }} disabled={busy || Number(billDetail.due_inr) <= 0} onClick={createUpi}>Generate Cashfree QR</button>
                      <div className="ql-muted" style={{ marginTop: 8 }}>For split payment, record partial cash first, then UPI for the remaining due.</div>
                    </div>
                    <div className="ql-line">
                      <strong>Receipt</strong>
                      <div className="ql-muted" style={{ margin: "9px 0" }}>WhatsApp receipt sends independently. If a valid Cashfree payment already exists, its payment link is included.</div>
                      <button className="ql-btn" style={{ width: "100%" }} disabled={busy} onClick={sendReceipt}>{upiOrder && upiOrder.payment_url ? "Send Receipt + Payment Link" : "Send Receipt"}</button>
                    </div>
                  </div>

                  {upiOrder && upiOrder.qr_payload ? (
                    <div className="ql-line" style={{ marginTop: 12 }}>
                      <div className="ql-space">
                        <div><strong>Cashfree UPI Payment</strong><div className="ql-muted">{money(upiOrder.amount_inr)} • {upiOrder.status}</div><div className="ql-muted">Payment ID: {upiOrder.payment_id}</div></div>
                        <div className="ql-qr"><QRCodeSVG value={upiOrder.qr_payload} size={170} /></div>
                      </div>
                      <div className="ql-row" style={{ marginTop: 10 }}>
                        <button className="ql-btn gold" onClick={function() { setQrClock(Date.now()); setShowUpiQrModal(true); }}>Show Large QR</button>
                        <button className="ql-btn" onClick={function() { verifyPayment(upiOrder.payment_id); }}>Check Verification</button>
                        {upiOrder.payment_url ? <a className="ql-btn gold" href={upiOrder.payment_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open Customer Pay Link</a> : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="ql-section">Recorded payments</div>
                  <div className="ql-list">
                    {(billDetail.payments || []).length ? (billDetail.payments || []).map(function(payment) {
                      const paymentId = payment.payment_id || payment.id;
                      return (
                        <div className="ql-line ql-space" key={paymentId}>
                          <div><strong>{payment.method} • {money(payment.amount_inr)}</strong><div className="ql-muted">{payment.status} • {paymentId}</div></div>
                          {payment.method === "UPI" && payment.status === "PENDING" ? <button className="ql-btn" onClick={function() { verifyPayment(paymentId); }}>Verify</button> : null}
                        </div>
                      );
                    }) : <div className="ql-empty">No payment recorded yet.</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === "admin" ? (
          <>
            <div className="ql-stat-grid">
              <div className="ql-stat"><span className="ql-muted">Role</span><strong>{role}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Database</span><strong>{health && health.database_ready ? "LIVE" : "CHECK"}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Cashfree</span><strong>{health && health.cashfree_ready ? "READY" : "CHECK"}</strong></div>
              <div className="ql-stat"><span className="ql-muted">MSG91</span><strong>{health && health.msg91_ready ? "READY" : "CHECK"}</strong></div>
            </div>

            {isAdmin ? (
              <>
                <div className="ql-section">F&B catalogue</div>
                <div className="ql-card full">
                  <div className="ql-space">
                    <div>
                      <h3>Ledger Items</h3>
                      <div className="ql-muted">
                        {catalogue.length} active item(s). This is the billing catalogue used by Desk Ledger and walk-in F&B.
                        Removing an item hides it from future sales but keeps old bills intact.
                      </div>
                    </div>
                    <button className="ql-btn primary" onClick={function() { setShowCatalogueAdd(function(value) { return !value; }); }}>
                      {showCatalogueAdd ? "Close" : "+ Add Item"}
                    </button>
                  </div>

                  {showCatalogueAdd ? (
                    <div className="ql-line" style={{ marginTop: 14 }}>
                      <div className="ql-form-grid">
                        <label>
                          <span className="ql-label">Item name</span>
                          <input className="ql-input" value={catalogueDraft.name} onChange={function(e) { updateCatalogueDraft("name", e.target.value); }} placeholder="e.g. Coke 750 ml" />
                        </label>
                        <label>
                          <span className="ql-label">Category</span>
                          <select className="ql-select" value={catalogueDraft.category} onChange={function(e) { updateCatalogueDraft("category", e.target.value); }}>
                            <option value="FOOD">Food</option>
                            <option value="BEVERAGES">Beverages</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </label>
                        <label>
                          <span className="ql-label">Selling price ₹</span>
                          <input className="ql-input" type="number" min="0" step="0.01" value={catalogueDraft.sellingPrice} onChange={function(e) { updateCatalogueDraft("sellingPrice", e.target.value); }} />
                        </label>
                        <label>
                          <span className="ql-label">Purchase / cost price ₹ (optional)</span>
                          <input className="ql-input" type="number" min="0" step="0.01" value={catalogueDraft.costPrice} onChange={function(e) { updateCatalogueDraft("costPrice", e.target.value); }} />
                        </label>
                        <label>
                          <span className="ql-label">Unit</span>
                          <input className="ql-input" value={catalogueDraft.unit} onChange={function(e) { updateCatalogueDraft("unit", e.target.value); }} placeholder="unit / bottle / plate" />
                        </label>
                        <label className="ql-line" style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={catalogueDraft.trackInventory}
                            onChange={function(e) { updateCatalogueDraft("trackInventory", e.target.checked); }}
                            style={{ width: 18, height: 18 }}
                          />
                          <span><strong>Track stock</strong><div className="ql-muted">Use for bottled/canned/packaged items that are replenished.</div></span>
                        </label>
                        {catalogueDraft.trackInventory ? (
                          <>
                            <label>
                              <span className="ql-label">Opening stock</span>
                              <input className="ql-input" type="number" min="0" step="1" value={catalogueDraft.openingStock} onChange={function(e) { updateCatalogueDraft("openingStock", e.target.value); }} />
                            </label>
                            <label>
                              <span className="ql-label">Low-stock warning at</span>
                              <input className="ql-input" type="number" min="0" step="1" value={catalogueDraft.lowStockThreshold} onChange={function(e) { updateCatalogueDraft("lowStockThreshold", e.target.value); }} />
                            </label>
                          </>
                        ) : null}
                      </div>
                      <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                        <button className="ql-btn ghost" disabled={busy} onClick={function() { setShowCatalogueAdd(false); }}>Cancel</button>
                        <button className="ql-btn primary" disabled={busy} onClick={addCatalogueItem}>{busy ? "Saving…" : "Save Item"}</button>
                      </div>
                    </div>
                  ) : null}

                  <div className="ql-list" style={{ marginTop: 14, maxHeight: "52vh", overflow: "auto" }}>
                    {catalogue.length ? catalogue.map(function(item) {
                      return (
                        <div className="ql-line ql-space" key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            <div className="ql-muted">
                              {String(item.category || "OTHER").replaceAll("_", " ")} • {money(item.selling_price_inr)}
                              {item.cost_price_inr != null ? " • cost " + money(item.cost_price_inr) : ""}
                              {item.track_inventory ? " • stock tracked" : ""}
                            </div>
                          </div>
                          <button className="ql-btn danger" disabled={busy} onClick={function() { removeCatalogueItem(item); }}>Delete Item</button>
                        </div>
                      );
                    }) : <div className="ql-empty">No active catalogue items.</div>}
                  </div>
                </div>
              </>
            ) : (
              <div className="ql-card full" style={{ marginTop: 14 }}>
                <strong>Staff read-only inventory view.</strong>
                <div className="ql-muted">Adding/removing catalogue items and stock adjustments require an Admin PIN session.</div>
              </div>
            )}

            <div className="ql-section">Tracked inventory</div>
            <div className="ql-grid">
              {inventory.length ? inventory.map(function(item) {
                return (
                  <div className="ql-card" key={item.item_id || item.id}>
                    <div className="ql-space">
                      <div><h3>{item.name}</h3><div className="ql-muted">Server stock</div></div>
                      <span className={"ql-badge " + (item.is_out_of_stock || item.is_low_stock ? "bad" : "")}>{item.current_stock}</span>
                    </div>
                    <div className="ql-muted" style={{ marginTop: 8 }}>Low-stock threshold: {item.low_stock_threshold == null ? "—" : item.low_stock_threshold}</div>
                    {isAdmin ? (
                      <div className="ql-row" style={{ marginTop: 12 }}>
                        <button className="ql-btn primary" onClick={function() { adminInventory(item, "restock"); }}>+ Restock</button>
                        <button className="ql-btn" onClick={function() { adminInventory(item, "adjust"); }}>Adjust</button>
                      </div>
                    ) : null}
                  </div>
                );
              }) : <div className="ql-card full"><div className="ql-empty">No stock-tracked items yet. Admin can add one above and enable Track stock.</div></div>}
            </div>
          </>
        ) : null}
      </div>

      {startTable ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setStartTable(null); }}>
          <div className="ql-modal">
            <div className="ql-space">
              <div><h3 style={{ margin: 0 }}>Start Table {startTable.table_no} — {startTable.display_name}</h3><div className="ql-muted">Server-authoritative session</div></div>
              <button className="ql-btn ghost" onClick={function() { setStartTable(null); }}>✕</button>
            </div>
            <div className="ql-form-grid" style={{ marginTop: 15 }}>
              <div className="full">
                <label className="ql-label">Game / Format</label>
                <select className="ql-select" value={startForm.gameType} onChange={function(e) { setStartForm({ ...startForm, gameType: e.target.value }); }}>
                  {allowedGames(startTable, rules).map(function(rule) {
                    return <option value={rule.game_type} key={rule.game_type}>{rule.display_name}{rule.billing_mode === "PER_PLAYER_PER_GAME" ? " — " + money(rule.rate_inr) + "/player/game" : ""}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="ql-label">Customer / Host name</label>
                <input className="ql-input" value={startForm.customerName} onChange={function(e) { setMemberCheck(null); setStartForm({ ...startForm, customerName: e.target.value, isMember: false }); }} placeholder="Player name" />
              </div>
              <div>
                <label className="ql-label">WhatsApp mobile (10 digits)</label>
                <input className="ql-input" inputMode="numeric" value={startForm.customerPhone} onChange={function(e) { setMemberCheck(null); setStartForm({ ...startForm, customerPhone: e.target.value.replace(/\D/g, "").slice(0, 10), isMember: false }); }} placeholder="9876543210" />
              </div>
              <div className="full">
                <label className="ql-label">Additional participants (comma separated)</label>
                <input className="ql-input" value={startForm.participants} onChange={function(e) { setStartForm({ ...startForm, participants: e.target.value }); }} placeholder="Player 2, Player 3" />
              </div>
              <div className="full ql-line">
                <div className="ql-space">
                  <div>
                    <strong>{startForm.isMember ? "✓ Verified Q Club Member" : "Membership check"}</strong>
                    <div className="ql-muted">
                      {memberCheck && memberCheck.verified
                        ? ((memberCheck.member && memberCheck.member.tier ? memberCheck.member.tier + " • " : "") + "valid until " + ((memberCheck.member && memberCheck.member.valid_until) || "not specified"))
                        : memberCheck
                          ? "No active matching membership. Walk-in rate will be used."
                          : "Member rate is applied only after a server-side registry match."}
                    </div>
                  </div>
                  <button type="button" className={startForm.isMember ? "ql-btn gold" : "ql-btn"} disabled={busy} onClick={verifyStartMember}>Verify Member</button>
                </div>
              </div>
            </div>
            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="ql-btn" onClick={function() { setStartTable(null); }}>Cancel</button>
              <button className="ql-btn primary" disabled={busy} onClick={createSession}>Save & Start Session</button>
            </div>
          </div>
        </div>
      ) : null}

      {showUpiQrModal && upiOrder && upiOrder.payment_session_id ? (
        <div className="ql-modal-bg ql-pay-modal-bg">
          <div className="ql-pay-modal" role="dialog" aria-modal="true" aria-label="Cashfree UPI payment QR">
            <div className="ql-space" style={{ alignItems: "center" }}>
              <div style={{ textAlign: "left" }}>
                <div className="ql-pay-kicker">THE Q CLUB PASIGHAT</div>
                <h2>UPI PAYMENT</h2>
              </div>
              <button className="ql-btn ghost" onClick={function() { setShowUpiQrModal(false); }}>✕</button>
            </div>

            <div className="ql-pay-amount">{money(upiOrder.amount_inr)}</div>
            <div className="ql-muted">
              {(billDetail && billDetail.bill_no) ? billDetail.bill_no : "Bill"} • Cashfree
            </div>

            <div
              className="ql-big-qr"
              style={{
                width: "fit-content",
                maxWidth: "calc(100vw - 48px)",
                overflow: "visible",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div id="qclub-cashfree-upi-qr" style={{ display: "grid", placeItems: "center", margin: "0 auto" }} />
            </div>

            {cashfreeQrError ? (
              <div className="ql-error" style={{ padding: 10, borderRadius: 10, marginBottom: 10 }}>{cashfreeQrError}</div>
            ) : null}

            <div style={{ fontWeight: 850, fontSize: 18 }}>Scan the Cashfree QR with any UPI app</div>
            <div className={
              "ql-pay-status " +
              (["VERIFIED", "SUCCESS", "PAID", "RECEIVED"].includes(String(upiOrder.status || "").toUpperCase())
                ? "good"
                : ["FAILED", "EXPIRED", "CANCELLED"].includes(String(upiOrder.status || "").toUpperCase())
                  ? "bad"
                  : "waiting")
            }>
              {paymentStatusLabel(upiOrder.status)}
            </div>
            <div className="ql-pay-expiry">{countdownLabel(upiOrder.expires_at, qrClock)}</div>
            <div className="ql-pay-note">Status checks automatically every 3 seconds. Closing this screen does not cancel the payment order.</div>

            <div className="ql-row" style={{ justifyContent: "center", marginTop: 16 }}>
              <button className="ql-btn" onClick={function() { verifyPayment(upiOrder.payment_id); }}>Check Now</button>
              {upiOrder.qr_element_url ? <a className="ql-btn gold" href={upiOrder.qr_element_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open Secure QR Page</a> : null}
              {upiOrder.payment_url ? <a className="ql-btn" href={upiOrder.payment_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Customer Pay Link</a> : null}
              <button className="ql-btn primary" onClick={function() { setShowUpiQrModal(false); }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {notice ? <div className={"ql-toast " + (noticeError ? "ql-error" : "")}>{notice}</div> : null}
    </div>
  );
}
