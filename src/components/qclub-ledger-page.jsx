import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseReady } from "../supabase";
import { autocompleteKeyAction, incrementItemQuantity, rankFnbAutocomplete } from "../lib/fnb-autocomplete.js";

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
    MINI_SNOOKER: ["NORMAL_SNOOKER", "QCHASE_RUMMY", "SIX_BALL_SNOOKER", "TEN_BALL_SNOOKER", "KITTY"],
    FULL_SIZE_SNOOKER: ["NORMAL_SNOOKER", "SIX_BALL_SNOOKER", "TEN_BALL_SNOOKER", "QCHASE_RUMMY", "KITTY"],
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

function activeSessionSeconds(session, nowMs) {
  if (!session) return 0;
  let seconds = Number(session.accumulated_seconds || 0);
  if (session.timer_running && session.timer_started_at) {
    const started = Date.parse(session.timer_started_at);
    const now = Number(nowMs || Date.now());
    if (Number.isFinite(started) && now > started) seconds += Math.floor((now - started) / 1000);
  }
  return Math.max(0, seconds);
}

function clockLabel(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
    : String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
}

function currentLoserPaysFrameSeconds(detail, nowMs) {
  if (!detail || detail.game_type !== "NORMAL_SNOOKER" || detail.payment_rule !== "LOSER_PAYS") return 0;
  const base = Number(detail.loser_pays_frame_base_session_seconds || 0);
  return Math.max(0, activeSessionSeconds(detail, nowMs) - base);
}

function sharedHourlyLiveShare(session, people) {
  if (!session || session.payment_rule !== "HOURLY_SHARED" || !session.timer_running) return 0;
  const active = (people || []).filter(function(person) { return person.status === "ACTIVE"; });
  if (!active.length) return 0;
  const start = Date.parse(session.shared_hourly_last_at || session.started_at || "");
  if (!Number.isFinite(start)) return 0;
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const rate = Number(session.shared_hourly_rate_inr || 0);
  return rate > 0 ? (rate * seconds / 3600) / active.length : 0;
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
  ".ql-fnb-tools{display:grid;grid-template-columns:minmax(0,2fr) minmax(180px,1fr);gap:10px;margin-bottom:12px}.ql-fnb-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ql-fnb{border:1px solid #1c382a;background:#08150f;border-radius:14px;padding:12px;min-height:148px;display:flex;flex-direction:column;justify-content:space-between}.ql-fnb.disabled{opacity:.5}.ql-qty{display:flex;align-items:center;gap:8px}.ql-qty button{width:31px;height:31px;border-radius:9px;border:1px solid #315242;background:#11261b;color:white;font-weight:900;cursor:pointer}.ql-fnb-actionbar{position:sticky;top:82px;z-index:70;margin:0 0 14px;border:1px solid #3b6b50;background:rgba(7,20,13,.97);backdrop-filter:blur(16px);box-shadow:0 14px 34px rgba(0,0,0,.42);border-radius:16px;padding:12px 14px}.ql-fnb-actionbar.has-items{border-color:#79e7aa;box-shadow:0 14px 34px rgba(0,0,0,.42),0 0 0 1px rgba(121,231,170,.16)}.ql-fnb-actionbar .ql-btn{min-width:190px}.ql-fnb-spacer{display:none}",
  ".ql-autocomplete{position:relative}.ql-autocomplete-menu{position:absolute;left:0;right:0;top:calc(100% + 5px);z-index:135;max-height:360px;overflow:auto;border:1px solid #315242;background:#07150f;border-radius:12px;box-shadow:0 18px 42px rgba(0,0,0,.48);padding:5px}.ql-autocomplete-option{width:100%;display:block;border:0;border-radius:9px;background:transparent;color:#f7fbf8;padding:9px 10px;text-align:left;cursor:pointer}.ql-autocomplete-option:hover,.ql-autocomplete-option.active{background:#163526;outline:1px solid #4a8b68}.ql-autocomplete-name{display:block;font-weight:900;font-size:14px}.ql-autocomplete-meta{display:flex;justify-content:space-between;gap:12px;margin-top:3px;color:#9eb2a5;font-size:12px}.ql-autocomplete-price{color:#f0d06f;font-weight:900}.ql-autocomplete-empty{padding:10px;color:#809488;font-size:12px}",
  ".ql-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}.ql-modal{width:min(680px,100%);max-height:90vh;overflow:auto;border:1px solid #2c513e;background:#09150f;border-radius:20px;padding:18px}",
  ".ql-login{min-height:100vh;display:grid;place-items:center;padding:20px}.ql-login-card{width:min(440px,100%);border:1px solid #31513f;background:linear-gradient(155deg,#10261a,#07110c);border-radius:24px;padding:24px}.ql-login-logo{font-size:34px}.ql-login h1{margin:8px 0 3px}.ql-login p{color:#9fb3a6;margin:0 0 20px}",
  ".ql-toast{position:fixed;right:18px;bottom:20px;z-index:140;max-width:min(420px,calc(100vw - 36px));padding:12px 14px;border-radius:12px;background:#183425;border:1px solid #3f7355;color:#d8f7e5}.ql-error{background:#3d1616;border-color:#7d3434;color:#ffd1d1}.ql-empty{border:1px dashed #2d493a;border-radius:14px;padding:24px;text-align:center;color:#809488}",
  ".ql-paybox{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.ql-qr{background:white;border-radius:14px;padding:12px;display:inline-flex}.ql-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ql-stat{border:1px solid #1e3a2c;border-radius:14px;padding:13px;background:#09170f}.ql-stat strong{display:block;font-size:21px;margin-top:4px}.ql-stat.clickable{cursor:pointer;transition:border-color .15s ease,transform .15s ease}.ql-stat.clickable:hover{border-color:#4c8d69;transform:translateY(-1px)}",
  ".ql-pay-modal-bg{background:rgba(0,0,0,.9);z-index:160}.ql-pay-modal{width:min(650px,100%);max-height:96vh;overflow:auto;border:2px solid #d8b64e;background:radial-gradient(circle at top,#173524 0,#09150f 48%,#040806 100%);border-radius:26px;padding:26px;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.55)}.ql-pay-modal h2{margin:2px 0 0;font-size:28px;letter-spacing:.08em}.ql-pay-modal .ql-pay-kicker{font-size:12px;letter-spacing:.18em;color:#d8b64e;font-weight:900}.ql-big-qr{display:inline-flex;background:white;border-radius:22px;padding:18px;margin:18px auto 12px}.ql-pay-amount{font-size:clamp(38px,7vw,66px);font-weight:950;line-height:1;color:#7df0ad;margin:12px 0 4px}.ql-pay-status{margin:16px auto 8px;border-radius:12px;padding:12px 14px;font-weight:950;letter-spacing:.08em}.ql-pay-status.waiting{background:#122b59;color:#9cc6ff}.ql-pay-status.good{background:#0d4529;color:#8df0b7}.ql-pay-status.bad{background:#501c1c;color:#ffb0b0}.ql-pay-expiry{font-size:14px;color:#c6d5cb;font-variant-numeric:tabular-nums}.ql-pay-note{color:#91a69a;font-size:12px;margin-top:8px}",
  ".ql-table-card{min-height:222px;display:flex;flex-direction:column}.ql-table-card.clickable{cursor:pointer;transition:border-color .15s ease,transform .15s ease}.ql-table-card.clickable:hover{border-color:#4c8d69;transform:translateY(-1px)}.ql-table-card .ql-table-open-hint{margin-top:auto;padding-top:14px;color:#79e7aa;font-size:12px;font-weight:850}.ql-player-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.ql-player-card{border:1px solid #1c382a;background:#08150f;border-radius:14px;padding:12px;min-width:0}.ql-club-tab-card{cursor:pointer;padding:12px;min-height:118px}.ql-club-tab-card:hover{border-color:#4c8d69}.ql-compact-stat{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}",
  "@media(max-width:900px){.ql-card,.ql-card.wide{grid-column:span 6}.ql-fnb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ql-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ql-player-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
  "@media(max-width:620px){.ql-wrap{padding:12px 10px 72px}.ql-top{align-items:flex-start}.ql-title{font-size:17px}.ql-server{max-width:52%}.ql-card,.ql-card.wide{grid-column:1/-1!important}.ql-form-grid{grid-template-columns:1fr}.ql-fnb-tools{grid-template-columns:1fr}.ql-fnb-grid{grid-template-columns:1fr}.ql-paybox{grid-template-columns:1fr}.ql-stat-grid{grid-template-columns:1fr 1fr}.ql-modal{padding:14px}.ql-player-grid,.ql-compact-stat{grid-template-columns:1fr}.ql-fnb-actionbar{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));margin:0;padding:11px;z-index:120}.ql-fnb-actionbar .ql-space{align-items:center}.ql-fnb-actionbar .ql-btn{min-width:0;flex:1}.ql-fnb-actionbar .ql-muted{display:none}.ql-fnb-spacer{display:block;height:108px}}"
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
  const [catalogueCategories, setCatalogueCategories] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [sessionDetails, setSessionDetails] = useState({});
  const [bills, setBills] = useState([]);
  const [operations, setOperations] = useState({ counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
  const [tableRequests, setTableRequests] = useState([]);
  const [tableOrders, setTableOrders] = useState([]);
  const [orderAlertQueue, setOrderAlertQueue] = useState([]);
  const [orderAlertsReady, setOrderAlertsReady] = useState(false);
  const orderAlertAudioRef = useRef(null);
  const seenOrderIdsRef = useRef(new Set());
  const pendingOrderSoundRef = useRef(false);
  const [tab, setTab] = useState("desk");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [startTable, setStartTable] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedFnbPersonId, setSelectedFnbPersonId] = useState("");
  const [gameEntry, setGameEntry] = useState(null);
  const [tableViewSessionId, setTableViewSessionId] = useState("");
  const [openClubTabsView, setOpenClubTabsView] = useState(false);
  const [openClubTabsSearch, setOpenClubTabsSearch] = useState("");
  const [clubTabViewCustomerId, setClubTabViewCustomerId] = useState("");
  const [clubTabDetail, setClubTabDetail] = useState(null);
  const [clubTabDetailLoading, setClubTabDetailLoading] = useState(false);
  const [clubCheckoutMethod, setClubCheckoutMethod] = useState("CASH");
  const [clubCheckoutAmount, setClubCheckoutAmount] = useState("");
  const [clubCheckoutPhone, setClubCheckoutPhone] = useState("");
  const [playerAccountView, setPlayerAccountView] = useState(null);
  const [billDetail, setBillDetail] = useState(null);
  const [upiOrder, setUpiOrder] = useState(null);
  const [showUpiQrModal, setShowUpiQrModal] = useState(false);
  const [qrClock, setQrClock] = useState(Date.now());
  const [cashfreeQrError, setCashfreeQrError] = useState("");
  const cashfreeQrComponentRef = useRef(null);
  const cashfreeQrStartedRef = useRef("");
  const fnbSearchInputRef = useRef(null);
  const fnbAutocompleteRef = useRef(null);
  const [quantities, setQuantities] = useState({});
  const [fnbSearch, setFnbSearch] = useState("");
  const [fnbAutocompleteOpen, setFnbAutocompleteOpen] = useState(false);
  const [fnbAutocompleteIndex, setFnbAutocompleteIndex] = useState(-1);
  const [fnbCategory, setFnbCategory] = useState("ALL");
  const [fnbDestination, setFnbDestination] = useState("TABLE");
  const [fnbTabs, setFnbTabs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [playerTabs, setPlayerTabs] = useState([]);
  const [selectedFnbTabId, setSelectedFnbTabId] = useState("");
  const [newTabName, setNewTabName] = useState("");
  const [newTabPhone, setNewTabPhone] = useState("");
  const [newTabCustomerId, setNewTabCustomerId] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [showCatalogueAdd, setShowCatalogueAdd] = useState(false);
  const [editingCatalogueItemId, setEditingCatalogueItemId] = useState("");
  const [catalogueDraft, setCatalogueDraft] = useState({
    name: "",
    category: "FOOD",
    unit: "unit",
    sellingPrice: "",
    costPrice: "",
    description: "",
    imageUrl: "",
    imagePath: "",
    qloungeCategoryKey: "",
    showOnQlounge: false,
    onlineOrderEnabled: false,
    sellInLedger: true,
    trackInventory: false,
    openingStock: "0",
    lowStockThreshold: "5",
  });
  const [cashAmount, setCashAmount] = useState("");
  const [cashTendered, setCashTendered] = useState("");
  const [manualPaymentMethod, setManualPaymentMethod] = useState("CASH");
  const [carryDifference, setCarryDifference] = useState(true);
  const [upiAmount, setUpiAmount] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [memberCheck, setMemberCheck] = useState(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerStatus, setLedgerStatus] = useState("ALL");
  const [ledgerDate, setLedgerDate] = useState("");
  const [showExcludedBills, setShowExcludedBills] = useState(false);
  const [liveClock, setLiveClock] = useState(Date.now());
  const [startForm, setStartForm] = useState({
    gameType: "NORMAL_SNOOKER",
    matchFormat: "FLEX",
    paymentRule: "HOURLY",
    isMember: false,
    players: [
      { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
      { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
    ],
  });

  const token = (auth && auth.token) || "";
  const role = (auth && auth.role) || "";
  const isAdmin = role === "ADMIN";

  const armOrderAlertAudio = useCallback(async function() {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return false;
      let context = orderAlertAudioRef.current;
      if (!context || context.state === "closed") {
        context = new AudioContextCtor();
        orderAlertAudioRef.current = context;
      }
      if (context.state === "suspended") await context.resume();
      const ready = context.state === "running";
      setOrderAlertsReady(ready);
      return ready;
    } catch {
      setOrderAlertsReady(false);
      return false;
    }
  }, []);

  const playOrderAlertSound = useCallback(function() {
    try {
      const context = orderAlertAudioRef.current;
      if (!context || context.state !== "running") return false;
      const now = context.currentTime;
      [880, 1047, 880].forEach(function(frequency, index) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + (index * 0.18);
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.15);
      });
      return true;
    } catch {
      return false;
    }
  }, []);

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
    setFnbTabs([]);
    setCustomers([]);
    setSelectedFnbTabId("");
    setOperations({ counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
    setTableRequests([]);
    setTableOrders([]);
    setOrderAlertQueue([]);
    seenOrderIdsRef.current = new Set();
    pendingOrderSoundRef.current = false;
    setPlayerAccountView(null);
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

  function runInBackground(promise) {
    Promise.resolve(promise).catch(function() {
      // Foreground action already succeeded. Periodic sync/manual refresh will reconcile.
    });
  }

  const refreshOneSession = useCallback(async function(sessionId) {
    if (!sessionId) return;
    const detail = await protectedCall("sessions/" + sessionId);
    setSessionDetails(function(current) {
      return { ...current, [sessionId]: detail };
    });
  }, [protectedCall]);

  const refreshBillingOverview = useCallback(async function() {
    if (!token) return;
    const calls = [
      protectedCall("bills?limit=500"),
      protectedCall("dashboard/summary"),
    ];
    if (isAdmin) calls.push(protectedCall("finance/reserve"));
    const values = await Promise.all(calls);
    setBills((values[0] && values[0].bills) || []);
    setSummary(values[1] || null);
    if (isAdmin && values[2]) {
      setFinance(values[2]);
      setFnbCostDraft(makeFnbCostDraft(values[2]));
    }
  }, [isAdmin, protectedCall, token]);

  const refreshFnbFastState = useCallback(async function() {
    if (!token) return;
    const values = await Promise.all([
      protectedCall("catalogue"),
      protectedCall("inventory"),
      protectedCall("fnb-tabs"),
      protectedCall("player-tabs"),
    ]);
    setCatalogue((values[0] && (values[0].items || values[0].catalogue)) || []);
    setInventory((values[1] && (values[1].items || values[1].inventory)) || []);
    const openFnbTabs = (values[2] && values[2].tabs) || [];
    setFnbTabs(openFnbTabs);
    setPlayerTabs((values[3] && values[3].tabs) || []);
    setSelectedFnbTabId(function(current) {
      return current && openFnbTabs.some(function(row) { return row.tab_id === current; }) ? current : "";
    });
  }, [protectedCall, token]);

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
        protectedCall("catalogue/categories"),
        protectedCall("inventory"),
        protectedCall("sessions?scope=active&limit=200"),
        protectedCall("bills?limit=500"),
        protectedCall("sessions?limit=500"),
        protectedCall("dashboard/summary"),
        protectedCall("operations/inbox"),
        protectedCall("fnb-tabs"),
        protectedCall("customers?limit=300"),
        protectedCall("player-tabs"),
        protectedCall("table-requests?status=PENDING"),
        protectedCall("table-orders?status=SENT"),
      ]);
      const h = values[0];
      const boot = values[1];
      const cat = values[2];
      const catCategories = values[3];
      const inv = values[4];
      const sessionPayload = values[5];
      const billPayload = values[6];
      const allPayload = values[7];
      const summaryPayload = values[8];
      const operationsPayload = values[9];
      const fnbTabPayload = values[10];
      const customerPayload = values[11];
      const playerTabPayload = values[12];
      const tableRequestPayload = values[13];
      const tableOrderPayload = values[14];
      setHealth(h);
      setSummary(summaryPayload);
      setBootstrap(boot);
      setCatalogue((cat && (cat.items || cat.catalogue)) || []);
      setCatalogueCategories((catCategories && catCategories.categories) || []);
      setInventory((inv && (inv.items || inv.inventory)) || []);
      const openRows = (sessionPayload && sessionPayload.sessions) || [];
      setSessions(openRows);
      setAllSessions((allPayload && allPayload.sessions) || []);
      setBills((billPayload && billPayload.bills) || []);
      const openFnbTabs = (fnbTabPayload && fnbTabPayload.tabs) || [];
      setFnbTabs(openFnbTabs);
      setCustomers((customerPayload && customerPayload.customers) || []);
      setPlayerTabs((playerTabPayload && playerTabPayload.tabs) || []);
      setTableRequests((tableRequestPayload && tableRequestPayload.requests) || []);
      setTableOrders((tableOrderPayload && tableOrderPayload.orders) || []);
      setSelectedFnbTabId(function(current) {
        return current && openFnbTabs.some(function(row) { return row.tab_id === current; }) ? current : "";
      });
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
        protectedCall("fnb-tabs"),
        protectedCall("player-tabs"),
        protectedCall("table-requests?status=PENDING"),
        protectedCall("table-orders?status=SENT"),
      ]);
      const openRows = (values[0] && values[0].sessions) || [];
      setSessions(openRows);
      setOperations(values[1] || { counts: {}, bookings: [], food_orders: [], shop_receipts: [] });
      const openFnbTabs = (values[2] && values[2].tabs) || [];
      setPlayerTabs((values[3] && values[3].tabs) || []);
      setTableRequests((values[4] && values[4].requests) || []);
      setTableOrders((values[5] && values[5].orders) || []);
      setFnbTabs(openFnbTabs);
      setSelectedFnbTabId(function(current) {
        return current && openFnbTabs.some(function(row) { return row.tab_id === current; }) ? current : "";
      });
      await loadSessionDetails(openRows);
    } catch {
      // Keep the last known live state visible; manual refresh surfaces detailed errors.
    }
  }, [loadSessionDetails, protectedCall, token]);

  const refreshQrOrders = useCallback(async function() {
    if (!token) return;
    try {
      const payload = await protectedCall("table-orders?status=SENT");
      setTableOrders((payload && payload.orders) || []);
    } catch {
      // Keep the last known QR orders visible; the normal live refresh can reconcile.
    }
  }, [protectedCall, token]);

  useEffect(function() {
    apiRequest("health").then(setHealth).catch(function() { setHealth(null); });
  }, []);

  useEffect(function() {
    function closeAutocompleteOnOutsidePointer(event) {
      const root = fnbAutocompleteRef.current;
      if (root && !root.contains(event.target)) {
        setFnbAutocompleteOpen(false);
        setFnbAutocompleteIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeAutocompleteOnOutsidePointer);
    return function() { document.removeEventListener("pointerdown", closeAutocompleteOnOutsidePointer); };
  }, []);

  useEffect(function() {
    if (token) refreshAll();
  }, [token, refreshAll]);

  useEffect(function() {
    if (!token) return undefined;
    const timer = window.setInterval(refreshLiveState, 10000);
    return function() { window.clearInterval(timer); };
  }, [token, refreshLiveState]);

  useEffect(function() {
    if (!token) return undefined;
    refreshQrOrders();
    const timer = window.setInterval(refreshQrOrders, 3000);
    return function() { window.clearInterval(timer); };
  }, [token, refreshQrOrders]);

  useEffect(function() {
    if (!auth || orderAlertsReady) return undefined;
    function arm() { armOrderAlertAudio(); }
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return function() {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [auth, orderAlertsReady, armOrderAlertAudio]);

  useEffect(function() {
    if (!token) return;
    const fresh = (tableOrders || []).filter(function(row) {
      return row && row.id && !seenOrderIdsRef.current.has(row.id);
    });
    if (!fresh.length) return;
    fresh.forEach(function(row) { seenOrderIdsRef.current.add(row.id); });
    setOrderAlertQueue(function(current) {
      const existing = new Set((current || []).map(function(row) { return row.id; }));
      return (current || []).concat(fresh.filter(function(row) { return !existing.has(row.id); }));
    });
    if (!playOrderAlertSound()) pendingOrderSoundRef.current = true;
  }, [tableOrders, token, playOrderAlertSound]);

  useEffect(function() {
    const pendingIds = new Set((tableOrders || []).map(function(row) { return row.id; }));
    setOrderAlertQueue(function(current) {
      return (current || []).filter(function(row) { return pendingIds.has(row.id); });
    });
  }, [tableOrders]);

  useEffect(function() {
    if (!orderAlertsReady || !pendingOrderSoundRef.current || !orderAlertQueue.length) return;
    if (playOrderAlertSound()) pendingOrderSoundRef.current = false;
  }, [orderAlertsReady, orderAlertQueue.length, playOrderAlertSound]);

  useEffect(function() {
    if (!token) return undefined;
    setLiveClock(Date.now());
    const timer = window.setInterval(function() { setLiveClock(Date.now()); }, 1000);
    return function() { window.clearInterval(timer); };
  }, [token]);

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
        const result = await protectedCall(upiOrder.scope === "CLUB_TAB" ? ("player-tab-payments/" + upiOrder.payment_id) : ("payments/" + upiOrder.payment_id));
        if (stopped) return;
        setUpiOrder(function(current) {
          if (!current || current.payment_id !== upiOrder.payment_id) return current;
          return { ...current, ...result };
        });
        const nextStatus = String(result.status || "PENDING").toUpperCase();
        if (nextStatus !== "PENDING") {
          flash(paymentStatusLabel(nextStatus) + ".", !["VERIFIED", "SUCCESS", "PAID", "RECEIVED"].includes(nextStatus));
          if (upiOrder.scope === "CLUB_TAB" && clubTabDetail && clubTabDetail.customer?.customer_id) {
            try {
              const detail = await protectedCall("player-tabs/" + clubTabDetail.customer.customer_id + "/detail");
              if (!stopped) {
                setClubTabDetail(detail);
                setClubCheckoutAmount(Number(detail.current_due_inr || 0).toFixed(2));
              }
            } catch {
              // Keep terminal payment state visible even if Club Tab refresh is temporarily unavailable.
            }
          } else if (billDetail && billDetail.bill_id) {
            try {
              const detail = await protectedCall("bills/" + billDetail.bill_id);
              if (!stopped) setBillDetail(detail);
            } catch {
              // Keep the terminal payment state visible even if bill refresh is temporarily unavailable.
            }
          }
          runInBackground(refreshBillingOverview());
          if (upiOrder.scope === "CLUB_TAB") runInBackground(refreshFnbFastState());
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
  }, [showUpiQrModal, upiOrder && upiOrder.payment_id, upiOrder && upiOrder.status, upiOrder && upiOrder.scope, billDetail && billDetail.bill_id, clubTabDetail && clubTabDetail.customer && clubTabDetail.customer.customer_id, protectedCall, refreshBillingOverview, flash]);

  async function login(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!pin.trim()) return;
    armOrderAlertAudio();
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
      // ENDED/FINALIZED sessions no longer occupy the physical table.
      if (["ACTIVE", "PAUSED"].includes(session.status)) map[session.table_id] = session;
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
  const selectedFnbTab = fnbTabs.find(function(row) { return row.tab_id === selectedFnbTabId; }) || null;
  const selectedFnbPerson = selectedSession && selectedSession.account_mode === "INDIVIDUAL"
    ? ((((sessionDetails[selectedSession.session_id] || {}).people) || []).find(function(person) { return person.person_id === selectedFnbPersonId; }) || null)
    : null;
  const playerAccountSession = playerAccountView
    ? sessions.find(function(row) { return row.session_id === playerAccountView.sessionId; }) || null
    : null;
  const playerAccountPerson = playerAccountView
    ? ((((sessionDetails[playerAccountView.sessionId] || {}).people) || []).find(function(person) { return person.person_id === playerAccountView.personId; }) || null)
    : null;
  const tableViewSession = tableViewSessionId
    ? sessions.find(function(row) { return row.session_id === tableViewSessionId; }) || null
    : null;
  const tableViewDetail = tableViewSession
    ? (sessionDetails[tableViewSession.session_id] || tableViewSession)
    : null;
  const tableViewTable = tableViewSession
    ? tables.find(function(row) { return row.table_id === tableViewSession.table_id; }) || null
    : null;
  const tableViewRule = tableViewSession
    ? rules.find(function(row) { return row.game_type === tableViewSession.game_type; }) || null
    : null;
  const clubTabView = clubTabViewCustomerId
    ? playerTabs.find(function(row) { return row.customer_id === clubTabViewCustomerId; }) || null
    : null;
  const filteredOpenClubTabs = useMemo(function() {
    const query = String(openClubTabsSearch || "").trim().toLowerCase();
    if (!query) return playerTabs;
    return playerTabs.filter(function(playerTab) {
      const locations = (playerTab.active_locations || []).map(function(location) {
        return [
          String(location.table_id || "").replace("table_","T"),
          String(location.game_type || "").replaceAll("_"," "),
        ].join(" ");
      }).join(" ");
      return [
        playerTab.name,
        playerTab.phone,
        locations,
        playerTab.current_due_inr,
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [playerTabs, openClubTabsSearch]);

  const sellableCatalogue = useMemo(function() {
    return catalogue.filter(function(item) { return item.sell_in_ledger !== false; });
  }, [catalogue]);

  const fnbCategories = useMemo(function() {
    return ["ALL"].concat(Array.from(new Set(sellableCatalogue.map(function(item) {
      return String(item.category || "Other").trim() || "Other";
    }))).sort(function(a, b) { return a.localeCompare(b); }));
  }, [sellableCatalogue]);

  const filteredCatalogue = useMemo(function() {
    const query = fnbSearch.trim().toLowerCase();
    return sellableCatalogue.filter(function(item) {
      const category = String(item.category || "Other").trim() || "Other";
      if (fnbCategory !== "ALL" && category !== fnbCategory) return false;
      if (!query) return true;
      return [item.name, category].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [sellableCatalogue, fnbCategory, fnbSearch]);

  const fnbAutocompleteResults = useMemo(function() {
    return rankFnbAutocomplete(sellableCatalogue, fnbSearch, 10);
  }, [sellableCatalogue, fnbSearch]);

  const showFnbAutocomplete = Boolean(fnbAutocompleteOpen && fnbSearch.trim() && fnbAutocompleteResults.length);

  const selectedFnbCount = Object.values(quantities).reduce(function(sum, q) { return sum + Number(q || 0); }, 0);
  const selectedFnbTotal = sellableCatalogue.reduce(function(sum, item) {
    const qty = Number(quantities[item.id] || 0);
    return sum + (qty * Number(item.selling_price_inr || 0));
  }, 0);

  const filteredBills = useMemo(function() {
    const query = ledgerSearch.trim().toLowerCase();
    return bills.filter(function(bill) {
      if (bill.accounting_excluded && !showExcludedBills) return false;
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
  }, [bills, ledgerDate, ledgerSearch, ledgerStatus, sessionLookup, showExcludedBills]);

  function normalizeCustomerLookup(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function customerMatches(value, limit) {
    const query = normalizeCustomerLookup(value);
    if (!query) return [];
    const tokens = query.split(/\s+/).filter(Boolean);
    return customers
      .filter(function(customer) {
        const haystack = normalizeCustomerLookup(customer.name).replace(/\s+/g, "");
        return tokens.every(function(token) { return haystack.includes(token); });
      })
      .sort(function(a, b) {
        const aName = normalizeCustomerLookup(a.name);
        const bName = normalizeCustomerLookup(b.name);
        const aExact = aName === query ? 1 : 0;
        const bExact = bName === query ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return Number(b.visit_count || 0) - Number(a.visit_count || 0);
      })
      .slice(0, limit || 6);
  }

  function customerByPhone(value) {
    const phone = String(value || "").replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(phone)) return null;
    return customers.find(function(customer) {
      return String(customer.phone || "").replace(/\D/g, "").slice(-10) === phone;
    }) || null;
  }

  function isReversedNameMatch(value, customerName) {
    const typed = normalizeCustomerLookup(value).split(/\s+/).filter(Boolean);
    const existing = normalizeCustomerLookup(customerName).split(/\s+/).filter(Boolean);
    return typed.length === 2 && existing.length === 2 && typed[0] === existing[1] && typed[1] === existing[0];
  }

  function renderCustomerMatches(value, onPick) {
    const matches = customerMatches(value, 5);
    const normalized = normalizeCustomerLookup(value);
    if (!normalized || (matches.length === 1 && normalizeCustomerLookup(matches[0].name) === normalized)) return null;
    return (
      <div className="ql-row" style={{ marginTop: 6, gap: 6 }}>
        {matches.map(function(customer) {
          const reversed = isReversedNameMatch(value, customer.name);
          return (
            <button
              type="button"
              className={reversed ? "ql-btn gold" : "ql-btn ghost"}
              key={customer.customer_id || customer.id}
              onClick={function() { onPick(customer); }}
              style={{ padding: "7px 9px" }}
              title={reversed ? "Possible existing player with first/last name order reversed" : "Use existing player"}
            >
              {reversed ? "⚠ Possible existing: " : ""}{customer.name}{customer.phone ? " • " + String(customer.phone).slice(-4) : ""}{reversed ? " • Use Existing" : ""}
            </button>
          );
        })}
      </div>
    );
  }

  function applyCustomerToStartPlayer(index, customer) {
    const players = (startForm.players || []).map(function(player, i) {
      return i === index ? {
        ...player,
        customerId: customer.customer_id || customer.id || null,
        name: String(customer.name || "").toUpperCase(),
        phone: customer.phone || "",
        isMember: Boolean(customer.is_member),
      } : player;
    });
    setMemberCheck(null);
    setStartForm({ ...startForm, players, isMember: index === 0 ? Boolean(customer.is_member) : startForm.isMember });
  }

  function applyCustomerToNewTab(customer) {
    setNewTabCustomerId(customer.customer_id || customer.id || "");
    setNewTabName(String(customer.name || "").toUpperCase());
    setNewTabPhone(customer.phone || "");
  }

  function applyCustomerToWalkIn(customer) {
    setWalkInName(String(customer.name || "").toUpperCase());
    setWalkInPhone(customer.phone || "");
  }

  function startDefaults(gameType) {
    if (gameType === "QCHASE_RUMMY" || gameType === "KITTY") {
      return {
        gameType,
        matchFormat: "FLEX",
        paymentRule: "PER_PLAYER",
        isMember: false,
        players: [
          { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
          { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
        ],
      };
    }
    if (gameType === "SIX_BALL_SNOOKER" || gameType === "TEN_BALL_SNOOKER") {
      return {
        gameType,
        matchFormat: "SINGLES",
        paymentRule: "LOSER_PAYS",
        isMember: false,
        players: [
          { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
          { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
        ],
      };
    }
    return {
      gameType,
      matchFormat: "FLEX",
      paymentRule: "HOURLY",
      isMember: false,
      players: [
        { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
        { name: "", phone: "", customerId: null, teamNo: null, isMember: false },
      ],
    };
  }

  function normalizedStartPlayers(form) {
    return (form.players || []).map(function(player, index) {
      return {
        name: String(player.name || "").trim().toUpperCase(),
        phone: String(player.phone || "").replace(/\D/g, "").slice(-10),
        is_member: Boolean(player.isMember || (index === 0 && form.isMember)),
        customer_id: player.customerId || null,
        team_no: form.matchFormat === "DOUBLES" ? (index < 2 ? 1 : 2) : null,
      };
    }).filter(function(player) { return player.name; });
  }

  function resizeStartPlayers(matchFormat) {
    const wanted = matchFormat === "SINGLES" ? 2 : matchFormat === "DOUBLES" ? 4 : Math.max(2, Math.min(6, (startForm.players || []).length));
    const current = (startForm.players || []).slice(0, wanted);
    while (current.length < wanted) current.push({ name: "", phone: "", customerId: null, teamNo: null, isMember: false });
    return current;
  }

  async function decideQrOrder(orderRow, decision) {
    if (!orderRow) return;
    setBusy(true);
    try {
      await protectedCall("table-orders/" + orderRow.id, {
        method: "PATCH",
        body: { decision: decision },
      });
      flash(decision === "ACCEPT"
        ? "QR order accepted and added to " + ((orderRow.access && orderRow.access.customer_name) || "player") + "'s Club Tab."
        : "QR order rejected.");
      await Promise.all([refreshLiveState(), refreshFnbFastState()]);
    } catch (error) {
      flash(error.message || "Unable to process QR order.", true);
    } finally {
      setBusy(false);
    }
  }

  function prepareQrStart(requestRow) {
    const table = tables.find(function(row) { return row.table_id === requestRow.table_id; });
    if (!table) return flash("QR request table was not found.", true);
    const options = allowedGames(table, rules);
    const requested = String(requestRow.requested_game_type || "").toUpperCase();
    const gameType = options.some(function(rule) { return rule.game_type === requested; })
      ? requested
      : ((options[0] && options[0].game_type) || "NORMAL_SNOOKER");
    const form = startDefaults(gameType);
    const first = {
      name: String(requestRow.customer_name || "").toUpperCase(),
      phone: String(requestRow.phone || "").replace(/\D/g, "").slice(-10),
      customerId: requestRow.customer_id || null,
      teamNo: null,
      isMember: false,
    };
    form.players = [first, ...(form.players || []).slice(1)];
    setStartTable(table);
    setMemberCheck(null);
    setStartForm(form);
    flash("QR start request loaded. Add any other players, verify membership if needed, then Start Table.");
  }

  async function decideQrRequest(requestRow, decision) {
    if (!requestRow) return;
    if (decision === "START_FORM") {
      prepareQrStart(requestRow);
      return;
    }
    setBusy(true);
    try {
      const result = await protectedCall("table-requests/" + requestRow.id, {
        method: "PATCH",
        body: { decision: decision },
      });
      if (decision === "APPROVE") {
        flash(result && result.waiting_next_game
          ? requestRow.customer_name + " will join from the next QChase/Rummy game."
          : requestRow.customer_name + " connected to the table.");
      } else {
        flash(requestRow.customer_name + " request rejected.");
      }
      await refreshLiveState();
    } catch (error) {
      if (error && error.status === 409 && String(error.message || "").includes("Start Table")) {
        prepareQrStart(requestRow);
      } else {
        flash(error.message || "Unable to update QR request.", true);
      }
    } finally {
      setBusy(false);
    }
  }

  function openStart(table) {
    const options = allowedGames(table, rules);
    const gameType = (options[0] && options[0].game_type) || "NORMAL_SNOOKER";
    setStartTable(table);
    setMemberCheck(null);
    setStartForm(startDefaults(gameType));
  }

  function changeStartGame(gameType) {
    setMemberCheck(null);
    setStartForm(startDefaults(gameType));
  }

  function changeMatchFormat(matchFormat) {
    const next = { ...startForm, matchFormat };
    const wanted = matchFormat === "SINGLES" ? 2 : matchFormat === "DOUBLES" ? 4 : Math.max(2, Math.min(6, (startForm.players || []).length));
    next.players = (startForm.players || []).slice(0, wanted);
    while (next.players.length < wanted) next.players.push({ name: "", phone: "", customerId: null, teamNo: null, isMember: false });
    setStartForm(next);
  }

  function updateStartPlayer(index, field, value) {
    let nextValue = field === "name" ? String(value || "").toUpperCase() : value;
    let matched = null;
    if (field === "name") {
      const exact = customerMatches(nextValue, 2);
      if (exact.length === 1 && normalizeCustomerLookup(exact[0].name) === normalizeCustomerLookup(value)) matched = exact[0];
    } else if (field === "phone") {
      matched = customerByPhone(value);
    }

    const players = (startForm.players || []).map(function(player, i) {
      if (i !== index) return player;
      if (matched) return {
        ...player,
        customerId: matched.customer_id || matched.id || null,
        name: matched.name || player.name,
        phone: matched.phone || value,
        isMember: Boolean(matched.is_member),
      };
      return {
        ...player,
        [field]: nextValue,
        ...(field === "name" ? { customerId: null, isMember: false } : {}),
        ...(field === "phone" ? { isMember: false } : {}),
      };
    });
    setMemberCheck(null);
    setStartForm({
      ...startForm,
      players,
      isMember: index === 0 ? Boolean(players[0]?.isMember) : startForm.isMember,
    });
  }

  function addStartPlayer() {
    if ((startForm.players || []).length >= 6) return;
    setStartForm({ ...startForm, players: [...(startForm.players || []), { name: "", phone: "", customerId: null, teamNo: null, isMember: false }] });
  }

  function removeStartPlayer(index) {
    if ((startForm.players || []).length <= 1) return;
    setStartForm({ ...startForm, players: (startForm.players || []).filter(function(_, i) { return i !== index; }) });
  }

  async function verifyStartMember(index) {
    const playerIndex = Number.isInteger(index) ? index : 0;
    const player = (startForm.players || [])[playerIndex] || {};
    if (!String(player.name || "").trim() && !String(player.phone || "").trim()) {
      flash("Enter the player name or mobile number first.", true);
      return;
    }
    setBusy(true);
    try {
      const result = await protectedCall(
        "members/verify?phone=" + encodeURIComponent(String(player.phone || "").trim()) +
        "&name=" + encodeURIComponent(String(player.name || "").trim())
      );
      setMemberCheck(result);
      const players = (startForm.players || []).map(function(row, i) {
        return i === playerIndex ? { ...row, isMember: Boolean(result && result.verified) } : row;
      });
      setStartForm({ ...startForm, players, isMember: playerIndex === 0 ? Boolean(result && result.verified) : startForm.isMember });
      flash(result && result.verified ? (player.name || ("Player " + (playerIndex + 1))) + " membership verified." : "No active matching membership. Walk-in rate applies.", !(result && result.verified));
    } catch (error) {
      setMemberCheck(null);
      const players = (startForm.players || []).map(function(row, i) {
        return i === playerIndex ? { ...row, isMember: false } : row;
      });
      setStartForm({ ...startForm, players, isMember: playerIndex === 0 ? false : startForm.isMember });
      flash(error.message || "Unable to verify membership.", true);
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    if (!startTable) return;
    const players = normalizedStartPlayers(startForm);
    if (!players.length) return flash("Enter at least one player.", true);
    if (startForm.matchFormat === "SINGLES" && players.length !== 2) return flash("Singles requires exactly 2 named players.", true);
    if (startForm.matchFormat === "DOUBLES" && players.length !== 4) return flash("Doubles requires exactly 4 named players.", true);
    if (startForm.gameType === "QCHASE_RUMMY" && (players.length < 2 || players.length > 6)) return flash("QChase/Rummy requires 2 to 6 players.", true);
    if (startForm.gameType === "KITTY" && (players.length < 2 || players.length > 6)) return flash("Kitty requires 2 to 6 players.", true);
    setBusy(true);
    try {
      await protectedCall("sessions", {
        method: "POST",
        body: {
          table_id: startTable.table_id,
          game_type: startForm.gameType,
          account_mode: "INDIVIDUAL",
          match_format: startForm.matchFormat,
          payment_rule: startForm.paymentRule,
          frame_rate_override_inr: null,
          people: players,
          idempotency_key: makeKey("session"),
        },
      });
      setStartTable(null);
      flash(startForm.gameType === "QCHASE_RUMMY" && startForm.paymentRule === "PER_PLAYER"
        ? "Table started. Game 1 entry charge was posted immediately to every starting player."
        : "Table started with individual player accounts.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to start table.", true);
    } finally {
      setBusy(false);
    }
  }

  async function patchSession(sessionId, action) {
    const session = sessions.find(function(row) { return row.session_id === sessionId; }) || allSessions.find(function(row) { return row.session_id === sessionId; }) || null;
    const table = session ? tables.find(function(row) { return row.table_id === session.table_id; }) : null;
    const release = action === "END" || action === "CLOSE";
    if (release) {
      const gameLabel = session ? ((rules.find(function(row) { return row.game_type === session.game_type; }) || {}).display_name || String(session.game_type || "").replaceAll("_"," ")) : "current game";
      const tableLabel = table ? ("Table " + table.table_no + " — " + table.display_name) : "this table";
      const ok = window.confirm(
        "End " + gameLabel + " and free " + tableLabel + " now?\n\n" +
        "The table will become AVAILABLE immediately. Existing player charges and Club Tabs stay open, so players can move to another table or settle later."
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const result = await protectedCall("sessions/" + sessionId, { method: "PATCH", body: { action } });
      if (release) setTableViewSessionId("");
      flash(action === "PAUSE"
        ? "Table timer paused."
        : release
          ? "Game ended and table released. Player Club Tabs remain open for later play or settlement."
          : "Table timer resumed.");
      await refreshAll();
      return result;
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function editSessionPerson(session, person) {
    const name = window.prompt("Player name:", person.name || "");
    if (name == null || !name.trim()) return;
    const phone = window.prompt("Mobile (optional, 10 digits):", person.phone || "");
    if (phone == null) return;
    const normalized = String(phone).replace(/\D/g, "").slice(-10);
    if (normalized && !/^\d{10}$/.test(normalized)) return flash("Enter a valid 10-digit mobile or leave blank.", true);
    setBusy(true);
    try {
      await protectedCall("sessions/" + session.session_id + "/people/" + person.person_id, {
        method: "PATCH",
        body: { name: name.trim().toUpperCase(), phone: normalized || null },
      });
      flash("Player updated.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to update player.", true);
    } finally {
      setBusy(false);
    }
  }

  async function joinPlayer(session) {
    const name = window.prompt("Joining player name:");
    if (!name || !name.trim()) return;
    const canonicalJoinName = name.trim().toUpperCase();
    const matches = customerMatches(canonicalJoinName, 2);
    const knownCustomer = matches.length === 1 ? matches[0] : null;
    const phoneRaw = knownCustomer && knownCustomer.phone
      ? knownCustomer.phone
      : (window.prompt("Mobile (optional):", "") || "");
    const phone = String(phoneRaw).replace(/\D/g, "").slice(-10);
    let teamNo = null;
    if (session.match_format === "DOUBLES") {
      const team = window.prompt("Team number for " + name.trim() + " (1 or 2):", "1");
      if (team == null) return;
      teamNo = Number(team);
      if (![1,2].includes(teamNo)) return flash("Team must be 1 or 2.", true);
    }
    setBusy(true);
    try {
      const joined = await protectedCall("sessions/" + session.session_id + "/people", {
        method: "POST",
        body: { name: canonicalJoinName, phone: phone || null, team_no: teamNo },
      });
      flash(joined && joined.qchase_charged_on_join
        ? canonicalJoinName + " joined QChase/Rummy and was charged " + money(joined.entry_charge_inr) + " immediately for Game " + joined.entry_game_number + "."
        : canonicalJoinName + " joined the table.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to add player.", true);
    } finally {
      setBusy(false);
    }
  }

  async function setPersonPresence(session, person, action) {
    setBusy(true);
    try {
      const result = await protectedCall("sessions/" + session.session_id + "/people/" + person.person_id, {
        method: "PATCH",
        body: { action },
      });
      flash(action === "LEAVE"
        ? person.name + " left the game/table. Historical games and charges are preserved."
        : (result && result.qchase_charged_on_rejoin
          ? person.name + " rejoined QChase/Rummy and was charged " + money(result.entry_charge_inr) + " immediately for Game " + result.entry_game_number + "."
          : person.name + " rejoined the table."));
      await refreshAll();
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function settleAndLeave(session, person) {
    if (!session || !person) return;
    const ok = window.confirm(
      person.name + " will leave this table now. Their shared table share stops at this moment and a bill will be created from all current unbilled Club Tab charges. Continue?"
    );
    if (!ok) return;

    setBusy(true);
    let left = false;
    try {
      await protectedCall("sessions/" + session.session_id + "/people/" + person.person_id, {
        method: "PATCH",
        body: { action: "LEAVE" },
      });
      left = true;

      const bill = person.customer_id
        ? await protectedCall("player-tabs/" + person.customer_id + "/finalize", {
            method: "POST",
            body: { idempotency_key: makeKey("settle-leave-club-tab") },
          })
        : await protectedCall("sessions/" + session.session_id + "/people/" + person.person_id + "/finalize", {
            method: "POST",
            body: { idempotency_key: makeKey("settle-leave-player") },
          });

      setBillDetail(bill);
      setCashAmount(Number(bill.due_inr || 0).toFixed(2));
      setCashTendered(Number(bill.due_inr || 0).toFixed(2));
      setUpiAmount(Number(bill.due_inr || 0).toFixed(2));
      setPaymentPhone(String(bill.customer_phone || person.phone || "").replace(/\D/g, "").slice(-10));
      setTab("ledger");
      flash(person.name + " left the table. Their shared table charge is frozen and bill " + (bill.bill_no || "") + " is ready.");
      runInBackground(refreshBillingOverview());
      runInBackground(refreshLiveState());
    } catch (error) {
      if (left && error?.payload?.error === "NOTHING_TO_BILL") {
        flash(person.name + " left the table. There was nothing new to bill.");
        runInBackground(refreshLiveState());
      } else {
        flash((left ? person.name + " left the table, but bill creation needs attention: " : "") + (error.message || "Unable to settle and leave."), true);
        runInBackground(refreshLiveState());
      }
    } finally {
      setBusy(false);
    }
  }


  function openGameEntry(session) {
    const detail = sessionDetails[session.session_id] || {};
    const activePeople = (detail.people || []).filter(function(person) { return person.status === "ACTIVE"; });
    setGameEntry({
      session,
      people: activePeople,
      selectedIds: activePeople.map(function(person) { return person.person_id; }),
      winnerPersonId: "",
      winningTeam: "",
      payerMode: "SPLIT",
      payerPersonId: "",
      kittyResult: "WINNER",
      kittyWinnerId: "",
    });
  }

  async function submitGameEntry() {
    if (!gameEntry) return;
    const session = gameEntry.session;
    const people = gameEntry.people || [];
    let selectedIds = gameEntry.selectedIds || [];
    let loserIds = [];
    let winnerIds = [];
    if (!selectedIds.length) return flash("Select the players in this game.", true);
    if (session.game_type === "KITTY") {
      if (gameEntry.kittyResult !== "NO_WINNER" && !gameEntry.kittyWinnerId) return flash("Select the Kitty winner or choose No Winner / Kitty.", true);
    } else if (session.payment_rule === "LOSER_PAYS") {
      if (session.match_format === "DOUBLES") {
        if (!gameEntry.winningTeam) return flash("Tap the winning team.", true);
        const losingTeam = String(gameEntry.winningTeam) === "1" ? "2" : "1";
        winnerIds = people.filter(function(person) { return String(person.team_no) === String(gameEntry.winningTeam) && selectedIds.includes(person.person_id); }).map(function(person) { return person.person_id; });
        loserIds = people.filter(function(person) { return String(person.team_no) === losingTeam && selectedIds.includes(person.person_id); }).map(function(person) { return person.person_id; });
        if (winnerIds.length !== 2 || loserIds.length !== 2) return flash("Both doubles teams must have 2 selected players.", true);
      } else {
        if (!gameEntry.winnerPersonId) return flash("Tap the frame winner.", true);
        if (!selectedIds.includes(gameEntry.winnerPersonId)) return flash("The winner must be one of the selected players.", true);
        winnerIds = [gameEntry.winnerPersonId];
        loserIds = selectedIds.filter(function(id) { return id !== gameEntry.winnerPersonId; });
        if (loserIds.length !== 1) return flash("Singles loser-pays requires exactly 2 selected players.", true);
      }
    }
    if (session.payment_rule === "LOSER_PAYS" && session.match_format === "DOUBLES" && gameEntry.payerMode === "ONE" && !gameEntry.payerPersonId) {
      return flash("Select which losing player will pay the full charge.", true);
    }
    setBusy(true);
    try {
      await protectedCall("sessions/" + session.session_id + "/games", {
        method: "POST",
        body: {
          player_ids: selectedIds,
          winner_person_ids: winnerIds,
          loser_person_ids: loserIds,
          payer_person_id: gameEntry.payerMode === "ONE" ? gameEntry.payerPersonId : null,
          kitty_no_winner: session.game_type === "KITTY" && gameEntry.kittyResult === "NO_WINNER",
          winner_person_id: session.game_type === "KITTY" && gameEntry.kittyResult !== "NO_WINNER" ? gameEntry.kittyWinnerId : null,
          idempotency_key: makeKey("game"),
        },
      });
      setGameEntry(null);
      flash(session.game_type === "KITTY"
        ? (gameEntry.kittyResult === "NO_WINNER" ? "Kitty recorded. Time carries forward to the next game." : "Kitty winner recorded and timed charge posted to the winner.")
        : session.game_type === "QCHASE_RUMMY" && session.payment_rule === "PER_PLAYER"
          ? "Next QChase/Rummy game started. Each selected player has been charged immediately; no charge waits for the game to finish."
          : session.payment_rule === "HOURLY_SHARED"
            ? "Game recorded. No ₹100 game charge — table time continues to be shared by active players."
            : session.game_type === "NORMAL_SNOOKER" && session.payment_rule === "LOSER_PAYS"
              ? "Frame recorded. Actual active frame time was charged to the loser at their member/non-member table rate. Next frame timer is now zero."
              : session.payment_rule === "LOSER_PAYS"
                ? "Frame recorded and charge posted to the loser(s)."
                : "Game recorded to individual accounts.");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to record game.", true);
    } finally {
      setBusy(false);
    }
  }

  async function allocateHourly(session) {
    const detail = sessionDetails[session.session_id] || {};
    const people = (detail.people || []).filter(function(person) { return person.status !== "SETTLED"; });
    if (!people.length) return flash("No players available for allocation.", true);
    const answer = window.prompt("Table charge allocation:\n1 = By playing time\n2 = Equal split\n3 = One person pays all", "1");
    if (answer == null) return;
    let strategy = answer === "2" ? "EQUAL" : answer === "3" ? "ONE" : "BY_TIME";
    let payer = null;
    if (strategy === "ONE") {
      const numbered = people.map(function(person, index) { return (index + 1) + ". " + person.name; }).join("\n");
      const pick = Number(window.prompt("Who pays the whole table charge?\n" + numbered, "1"));
      if (!(pick >= 1 && pick <= people.length)) return flash("Invalid player selection.", true);
      payer = people[pick - 1].person_id;
    }
    setBusy(true);
    try {
      const result = await protectedCall("sessions/" + session.session_id + "/hourly-allocation", {
        method: "POST",
        body: { strategy, payer_person_id: payer },
      });
      flash("Table charge allocated: " + money(result.total_inr) + ".");
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to allocate table charge.", true);
    } finally {
      setBusy(false);
    }
  }


  async function openClubTabDetail(playerTab, options) {
    if (!playerTab || !playerTab.customer_id) return;
    const opts = options || {};
    if (!opts.silent) setClubTabDetailLoading(true);
    try {
      const detail = await protectedCall("player-tabs/" + playerTab.customer_id + "/detail");
      setClubTabDetail(detail);
      setClubCheckoutAmount(Number(detail.current_due_inr || 0).toFixed(2));
      setClubCheckoutPhone(String(detail.customer?.phone || playerTab.phone || "").replace(/\D/g, "").slice(-10));
      if (!opts.keepSummaryOpen) setClubTabViewCustomerId("");
      return detail;
    } catch (error) {
      flash(error.message || "Unable to load Club Tab details.", true);
      return null;
    } finally {
      if (!opts.silent) setClubTabDetailLoading(false);
    }
  }

  async function addFnbForClubTab(playerTab) {
    if (!playerTab || !playerTab.customer_id) return;
    setBusy(true);
    try {
      let running = fnbTabs.find(function(row) { return row.customer_id === playerTab.customer_id && row.status === "OPEN"; }) || null;
      if (!running) {
        running = await protectedCall("fnb-tabs", {
          method: "POST",
          body: {
            customer_id: playerTab.customer_id,
            customer_name: playerTab.name,
            customer_phone: playerTab.phone || null,
            idempotency_key: makeKey("club-tab-fnb"),
          },
        });
      }
      setFnbTabs(function(current) {
        const found = current.some(function(row) { return row.tab_id === running.tab_id; });
        return found ? current.map(function(row) { return row.tab_id === running.tab_id ? running : row; }) : [running, ...current];
      });
      setSelectedFnbTabId(running.tab_id);
      setFnbDestination("RUNNING_TAB");
      setClubTabViewCustomerId("");
      setClubTabDetail(null);
      setOpenClubTabsView(false);
      setTab("fnb");
      setQuantities({});
      setFnbSearch("");
      flash("Add F&B directly to " + playerTab.name + "'s Club Tab. No table session is required.");
      window.requestAnimationFrame(function() {
        if (fnbSearchInputRef.current) fnbSearchInputRef.current.focus();
      });
    } catch (error) {
      flash(error.message || "Unable to open F&B for this Club Tab.", true);
    } finally {
      setBusy(false);
    }
  }

  async function prepareClubTabCheckout(playerTab) {
    if (!playerTab || !playerTab.customer_id) return;
    setBusy(true);
    try {
      let detail = await protectedCall("player-tabs/" + playerTab.customer_id + "/detail");
      if (Number(detail.unbilled?.total_inr || 0) > 0.009) {
        await protectedCall("player-tabs/" + playerTab.customer_id + "/finalize", {
          method: "POST",
          body: { idempotency_key: makeKey("club-tab-checkout") },
        });
        detail = await protectedCall("player-tabs/" + playerTab.customer_id + "/detail");
      }
      setClubTabViewCustomerId("");
      setClubTabDetail(detail);
      setClubCheckoutAmount(Number(detail.current_due_inr || 0).toFixed(2));
      setClubCheckoutPhone(String(detail.customer?.phone || playerTab.phone || "").replace(/\D/g, "").slice(-10));
      flash(Number(detail.current_due_inr || 0) > 0.009
        ? "Checkout prepared. Review the itemized statement, then collect payment."
        : "This Club Tab has no amount due.");
      runInBackground(refreshBillingOverview());
      runInBackground(refreshFnbFastState());
    } catch (error) {
      flash(error.message || "Unable to prepare Club Tab checkout.", true);
    } finally {
      setBusy(false);
    }
  }

  async function payClubTabManual() {
    if (!clubTabDetail || !clubTabDetail.customer?.customer_id) return;
    const received = Number(clubCheckoutAmount || 0);
    if (!(received > 0)) return flash("Enter the amount actually received.", true);
    setBusy(true);
    try {
      const result = await protectedCall("player-tabs/" + clubTabDetail.customer.customer_id + "/pay", {
        method: "POST",
        body: {
          method: clubCheckoutMethod,
          received_inr: received,
          idempotency_key: makeKey("club-tab-payment"),
        },
      });
      const detail = result.tab || await protectedCall("player-tabs/" + clubTabDetail.customer.customer_id + "/detail");
      setClubTabDetail(detail);
      setClubCheckoutAmount(Number(detail.current_due_inr || 0).toFixed(2));
      const carry = Number(result.carry_inr || 0);
      if (result.closed) {
        flash("Payment received. Club Tab settled and closed.");
      } else if (carry > 0) {
        flash("Payment received. " + money(carry) + " credit carried to the player's account.");
      } else {
        flash("Partial payment recorded. Remaining Club Tab due " + money(detail.current_due_inr) + ".");
      }
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to record Club Tab payment.", true);
    } finally {
      setBusy(false);
    }
  }

  async function createClubTabOnline() {
    if (!clubTabDetail || !clubTabDetail.customer?.customer_id) return;
    const phone = String(clubCheckoutPhone || clubTabDetail.customer.phone || "").replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(phone)) return flash("Enter the customer's 10-digit mobile number for Cashfree Online.", true);
    setBusy(true);
    try {
      const result = await protectedCall("player-tabs/" + clubTabDetail.customer.customer_id + "/online", {
        method: "POST",
        body: { customer_phone: phone, idempotency_key: makeKey("club-tab-online") },
      });
      setClubCheckoutPhone(phone);
      setUpiOrder(result);
      setCashfreeQrError("");
      cashfreeQrStartedRef.current = "";
      setQrClock(Date.now());
      setShowUpiQrModal(true);
      flash("Cashfree Online QR created for the full Club Tab balance.");
    } catch (error) {
      flash(error.message || "Unable to create Club Tab Cashfree QR.", true);
    } finally {
      setBusy(false);
    }
  }

  function clubActivityAmount(entry) {
    const value = Number(entry && entry.amount_inr || 0);
    if (value < 0) return "−" + money(Math.abs(value));
    return money(value);
  }

  async function finalizeClubTab(playerTab) {
    if (!playerTab || !(Number(playerTab.unbilled_inr || 0) > 0)) return flash("No new unbilled charges for " + (playerTab?.name || "this player") + ".", true);
    setBusy(true);
    try {
      const bill = await protectedCall("player-tabs/" + playerTab.customer_id + "/finalize", { method:"POST", body:{ idempotency_key:makeKey("club-tab") } });
      setBillDetail(bill);
      setCashAmount(Number(bill.due_inr || 0).toFixed(2));
      setCashTendered(Number(bill.due_inr || 0).toFixed(2));
      setUpiAmount(Number(bill.due_inr || 0).toFixed(2));
      setPaymentPhone(String(bill.customer_phone || "").replace(/\D/g,"").slice(-10));
      setClubTabViewCustomerId("");
      setTab("ledger");
      flash(playerTab.name + " current charges moved to one bill. Their Club Tab can continue receiving new charges.");
      runInBackground(refreshBillingOverview());
      runInBackground(refreshLiveState());
    } catch (error) { flash(error.message || "Unable to finalize club tab.", true); }
    finally { setBusy(false); }
  }

  async function finalizePerson(session, person) {
    if (!(Number(person.unbilled_inr || 0) > 0)) {
      if (Number(person.billed_due_inr || 0) > 0 && person.bills && person.bills.length) {
        const latest = person.bills[person.bills.length - 1];
        await loadBill(latest.bill_id);
        setTab("ledger");
        return;
      }
      return flash("Nothing new to bill for " + person.name + ".", true);
    }
    setBusy(true);
    try {
      const bill = await protectedCall("sessions/" + session.session_id + "/people/" + person.person_id + "/finalize", {
        method: "POST",
        body: { idempotency_key: makeKey("player-bill") },
      });
      setBillDetail(bill);
      setCashAmount(Number(bill.due_inr || 0).toFixed(2));
      setCashTendered(Number(bill.due_inr || 0).toFixed(2));
      setUpiAmount(Number(bill.due_inr || 0).toFixed(2));
      setPaymentPhone(String(bill.customer_phone || "").replace(/\D/g, "").slice(-10));
      setTab("ledger");
      flash(person.name + " bill " + bill.bill_no + " created. The player stays active and can keep playing after payment.");
      runInBackground(refreshOneSession(session.session_id));
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message || "Unable to create player bill.", true);
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
      setPaymentPhone(String(bill.customer_phone || "").replace(/\D/g, "").slice(-10));
      setTab("ledger");
      flash("Bill " + (bill.bill_no || "") + " finalized.");
      runInBackground(refreshOneSession(session.session_id));
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function createRunningFnbTab() {
    const name = newTabName.trim();
    if (!name) {
      flash("Enter the customer's name before opening a tab.", true);
      return;
    }
    const phone = String(newTabPhone || "").replace(/\D/g, "").slice(-10);
    if (phone && !/^\d{10}$/.test(phone)) {
      flash("Enter a valid 10-digit mobile number or leave it blank.", true);
      return;
    }

    setBusy(true);
    try {
      const opened = await protectedCall("fnb-tabs", {
        method: "POST",
        body: {
          customer_id: newTabCustomerId || null,
          customer_name: name,
          customer_phone: phone || null,
          idempotency_key: makeKey("fnb-tab"),
        },
      });
      setNewTabName("");
      setNewTabPhone("");
      setNewTabCustomerId("");
      setFnbDestination("RUNNING_TAB");
      setFnbTabs(function(current) {
        return [opened, ...current.filter(function(row) { return row.tab_id !== opened.tab_id; })];
      });
      setSelectedFnbTabId(opened.tab_id);
      flash(opened.reused ? "Existing Club Tab reopened for " + opened.customer_name + "." : "Club Tab opened for " + opened.customer_name + ".");
      runInBackground(refreshFnbFastState());
    } catch (error) {
      flash(error.message || "Unable to open running tab.", true);
    } finally {
      setBusy(false);
    }
  }

  async function closeRunningFnbTab(tabRow) {
    const activeTab = tabRow || selectedFnbTab;
    if (!activeTab) {
      flash("Select an open Club Tab first.", true);
      return;
    }
    if (!(Number(activeTab.total_inr || 0) > 0)) {
      flash("This Club Tab has no items to bill.", true);
      return;
    }

    const linkedClubTab = activeTab.customer_id
      ? playerTabs.find(function(row) { return row.customer_id === activeTab.customer_id; })
      : null;
    const amountToFinalize = Number(linkedClubTab?.unbilled_inr || activeTab.total_inr || 0);
    const ok = window.confirm(
      "Finalize " + activeTab.customer_name + "'s Club Tab for " + money(amountToFinalize) +
      (linkedClubTab && Number(linkedClubTab.player_unbilled_inr || 0) > 0 ? "? This includes F&B plus game/table charges." : "?")
    );
    if (!ok) return;

    setBusy(true);
    try {
      const bill = activeTab.customer_id
        ? await protectedCall("player-tabs/" + activeTab.customer_id + "/finalize", {
            method: "POST",
            body: { idempotency_key: makeKey("club-tab") },
          })
        : await protectedCall("fnb-tabs/" + activeTab.tab_id + "/close", {
            method: "POST",
            body: { idempotency_key: makeKey("close-fnb-tab") },
          });

      setBillDetail(bill);
      setCashAmount(Number(bill.due_inr || 0).toFixed(2));
      setCashTendered(Number(bill.due_inr || 0).toFixed(2));
      setUpiAmount(Number(bill.due_inr || 0).toFixed(2));
      setPaymentPhone(String(bill.customer_phone || "").replace(/\D/g, "").slice(-10));
      setSelectedFnbTabId("");
      setQuantities({});
      setTab("ledger");
      setFnbTabs(function(current) { return current.filter(function(row) { return row.tab_id !== activeTab.tab_id; }); });
      flash(activeTab.customer_name + "'s Club Tab finalized. Bill " + (bill.bill_no || "") + " includes all unbilled activity.");
      runInBackground(refreshBillingOverview());
      runInBackground(refreshFnbFastState());
      runInBackground(refreshLiveState());
    } catch (error) {
      flash(error.message || "Unable to finalize Club Tab.", true);
    } finally {
      setBusy(false);
    }
  }

  async function cancelEmptyRunningFnbTab(tabRow) {
    if (!tabRow) return;
    if (Number(tabRow.item_count || 0) > 0) {
      flash("This tab already has orders. Void the items as Admin or close it into a bill.", true);
      return;
    }
    const ok = window.confirm("Cancel empty tab for " + tabRow.customer_name + "?");
    if (!ok) return;

    setBusy(true);
    try {
      await protectedCall("fnb-tabs/" + tabRow.tab_id, { method: "DELETE" });
      if (selectedFnbTabId === tabRow.tab_id) setSelectedFnbTabId("");
      setFnbTabs(function(current) { return current.filter(function(row) { return row.tab_id !== tabRow.tab_id; }); });
      flash("Empty running tab cancelled.");
      runInBackground(refreshFnbFastState());
    } catch (error) {
      flash(error.message || "Unable to cancel tab.", true);
    } finally {
      setBusy(false);
    }
  }

  function selectFnbAutocompleteItem(item) {
    if (!item) return;
    setQuantities(function(current) { return incrementItemQuantity(current, item.id); });
    setFnbSearch("");
    setFnbAutocompleteOpen(false);
    setFnbAutocompleteIndex(-1);
    window.requestAnimationFrame(function() {
      if (fnbSearchInputRef.current) fnbSearchInputRef.current.focus();
    });
  }

  function handleFnbSearchKeyDown(event) {
    const action = autocompleteKeyAction(event.key, fnbAutocompleteIndex, fnbAutocompleteResults.length);
    if (!action) return;

    event.preventDefault();
    if (action.type === "CLOSE") {
      setFnbAutocompleteOpen(false);
      setFnbAutocompleteIndex(-1);
      return;
    }
    if (action.type === "MOVE") {
      setFnbAutocompleteOpen(true);
      setFnbAutocompleteIndex(action.index);
      return;
    }
    if (action.type === "SELECT") {
      selectFnbAutocompleteItem(fnbAutocompleteResults[action.index]);
    }
  }

  async function addFnb() {
    if (fnbDestination === "TABLE" && !selectedSession) {
      flash("Select an active table/session first.", true);
      return;
    }
    if (fnbDestination === "RUNNING_TAB" && !selectedFnbTab) {
      flash("Select an open running tab first.", true);
      return;
    }
    const lines = sellableCatalogue.map(function(item) {
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
    let updatedTab = null;
    try {
      if (fnbDestination === "RUNNING_TAB") {
        updatedTab = await protectedCall("fnb-tabs/" + selectedFnbTab.tab_id + "/fnb", {
          method: "POST",
          body: {
            lines: lines,
            idempotency_key: makeKey("fnb-tab-order"),
          },
        });
        flash("Added to " + updatedTab.customer_name + "'s tab. Running total " + money(updatedTab.total_inr) + ".");
      } else if (fnbDestination === "WALK_IN") {
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
      setPaymentPhone(String(bill.customer_phone || "").replace(/\D/g, "").slice(-10));
        setWalkInName("");
        setWalkInPhone("");
        setTab("ledger");
        flash("Walk-in F&B bill " + (bill.bill_no || "") + " created.");
      } else {
        const detail = sessionDetails[selectedSession.session_id] || {};
        if (selectedSession.account_mode === "INDIVIDUAL" && !selectedFnbPersonId) {
          throw new Error("Choose which player is ordering.");
        }
        await protectedCall("sessions/" + selectedSession.session_id + "/fnb", {
          method: "POST",
          body: { lines: lines, person_id: selectedFnbPersonId || null, idempotency_key: makeKey("fnb") },
        });
        const owner = (detail.people || []).find(function(person) { return person.person_id === selectedFnbPersonId; });
        flash("F&B added" + (owner ? " to " + owner.name + "'s account." : " to the live table bill."));
      }
      setQuantities({});
      if (fnbDestination === "RUNNING_TAB" && typeof updatedTab !== "undefined" && updatedTab) {
        setFnbTabs(function(current) {
          const found = current.some(function(row) { return row.tab_id === updatedTab.tab_id; });
          return found
            ? current.map(function(row) { return row.tab_id === updatedTab.tab_id ? updatedTab : row; })
            : [updatedTab, ...current];
        });
      }
      if (fnbDestination === "TABLE" && selectedSession) {
        runInBackground(refreshOneSession(selectedSession.session_id));
      }
      runInBackground(refreshFnbFastState());
      if (fnbDestination === "WALK_IN") runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function loadBill(billId, options) {
    const opts = options || {};
    if (!opts.silent) setBusy(true);
    try {
      const detail = await protectedCall("bills/" + billId);
      setBillDetail(detail);
      setCashAmount(Number(detail.due_inr || 0).toFixed(2));
      setCashTendered(Number(detail.due_inr || 0).toFixed(2));
      setUpiAmount(Number(detail.due_inr || 0).toFixed(2));
      if (!opts.preserveContact) {
        setPaymentPhone(String(detail.customer_phone || "").replace(/\D/g, "").slice(-10));
      }
      if (!opts.preserveUpi) {
        setUpiOrder(null);
        setShowUpiQrModal(false);
      }
    } catch (error) {
      flash(error.message, true);
    } finally {
      if (!opts.silent) setBusy(false);
    }
  }

  async function refreshBillDetail(options) {
    if (!billDetail || !billDetail.bill_id) return;
    await loadBill(billDetail.bill_id, { preserveContact: true, ...(options || {}) });
    runInBackground(refreshBillingOverview());
  }

  async function recordCash() {
    if (!billDetail) return;
    const received = Number(cashAmount || 0);
    if (!(received > 0)) {
      flash("Enter the amount actually received.", true);
      return;
    }
    setBusy(true);
    try {
      const result = await protectedCall("payments/manual", {
        method: "POST",
        body: {
          bill_id: billDetail.bill_id,
          method: manualPaymentMethod,
          received_inr: received,
          carry_difference: carryDifference,
          customer_name: billDetail.customer_name || "",
          customer_phone: String(paymentPhone || billDetail.customer_phone || "").replace(/\D/g, "").slice(-10) || null,
          idempotency_key: makeKey("manual-payment"),
        },
      });
      setCashAmount(Number(result.due_inr || 0).toFixed(2));
      setCashTendered(Number(result.due_inr || 0).toFixed(2));
      setUpiAmount(Number(result.due_inr || 0).toFixed(2));
      const carry = Number(result.carry_inr || 0);
      if (carry > 0) flash((manualPaymentMethod === "UPI" ? "UPI" : "Cash") + " recorded. " + money(carry) + " player credit carried forward.");
      else if (carry < 0) flash((manualPaymentMethod === "UPI" ? "UPI" : "Cash") + " recorded. " + money(Math.abs(carry)) + " player debit carried forward.");
      else if (Number(result.change_inr) > 0) flash("Cash recorded. Return change " + money(result.change_inr) + ".");
      else flash((manualPaymentMethod === "UPI" ? "UPI" : "Cash") + " payment recorded.");
      await loadBill(billDetail.bill_id, { preserveContact: true, preserveUpi: true, silent: true });
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function applyCarriedBalance() {
    if (!billDetail) return;
    setBusy(true);
    try {
      const result = await protectedCall("payments/balance", {
        method: "POST",
        body: { bill_id: billDetail.bill_id, idempotency_key: makeKey("balance-apply") },
      });
      if (result.entry_type === "CREDIT_APPLIED") flash("Player credit applied: " + money(result.applied_inr) + ".");
      else if (result.entry_type === "DEBIT_APPLIED") flash("Previous debit added to this bill: " + money(result.applied_inr) + ".");
      else flash("No carried balance to apply.");
      await loadBill(billDetail.bill_id, { preserveContact: true, preserveUpi: true, silent: true });
      runInBackground(refreshBillingOverview());
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
    const phone = String(paymentPhone || (session && session.customer_phone) || billDetail.customer_phone || "").replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(phone)) {
      flash("Enter the customer's 10-digit mobile number to generate the Cashfree Online QR.", true);
      return;
    }
    setPaymentPhone(phone);
    setBusy(true);
    try {
      const result = await protectedCall("payments/upi", {
        method: "POST",
        body: {
          bill_id: billDetail.bill_id,
          amount_inr: amount,
          customer_phone: phone,
          customer_name: (session && session.customer_name) || billDetail.customer_name || "",
          idempotency_key: makeKey("upi"),
        },
      });
      setUpiOrder(result);
      setCashfreeQrError("");
      cashfreeQrStartedRef.current = "";
      setQrClock(Date.now());
      setShowUpiQrModal(true);
      setBillDetail(function(current) {
        return current ? { ...current, customer_phone: phone } : current;
      });
      flash("Cashfree Online order created. The secure QR is loading.");
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment(paymentId) {
    setBusy(true);
    try {
      const clubScope = upiOrder && upiOrder.scope === "CLUB_TAB";
      const result = await protectedCall(clubScope ? ("player-tab-payments/" + paymentId) : ("payments/" + paymentId));
      const status = String(result.status || "PENDING").toUpperCase();
      if (upiOrder && upiOrder.payment_id === paymentId) setUpiOrder({ ...upiOrder, ...result });

      if (["VERIFIED", "SUCCESS", "PAID", "RECEIVED"].includes(status)) {
        setShowUpiQrModal(false);
        if (clubScope && clubTabDetail && clubTabDetail.customer?.customer_id) {
          const detail = await protectedCall("player-tabs/" + clubTabDetail.customer.customer_id + "/detail");
          setClubTabDetail(detail);
          setClubCheckoutAmount(Number(detail.current_due_inr || 0).toFixed(2));
          await refreshAll();
          flash(Number(detail.current_due_inr || 0) <= 0.009 ? "Online payment received. Club Tab settled and closed." : "Online payment verified.");
        } else {
          flash(result.bill_status === "PAID" ? "Payment received. Bill closed automatically." : "Payment verified successfully.");
        }
      } else if (["FAILED", "EXPIRED", "CANCELLED"].includes(status)) {
        setShowUpiQrModal(false);
        if (upiOrder && upiOrder.payment_id === paymentId) setUpiOrder(null);
        flash(status === "EXPIRED" ? "Payment attempt expired. You can generate a new Cashfree QR." : "Payment was not completed. You can start a new payment attempt.", true);
      } else {
        const expiry = result.expires_at ? countdownLabel(result.expires_at, Date.now()) : "";
        flash("Payment is still pending" + (expiry ? " • " + expiry : "") + ".");
      }
      if (result.bill_status || result.due_inr != null) {
        setBillDetail(function(current) {
          if (!current) return current;
          return {
            ...current,
            status: result.bill_status || current.status,
            due_inr: result.due_inr == null ? current.due_inr : result.due_inr,
          };
        });
      }
      if (billDetail && billDetail.bill_id) {
        runInBackground(loadBill(billDetail.bill_id, { preserveContact: true, preserveUpi: true, silent: true }));
      }
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function sendReceipt() {
    if (!billDetail) return;
    const session = sessionLookup[billDetail.session_id];
    const phone = String(paymentPhone || (session && session.customer_phone) || billDetail.customer_phone || "").replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(phone)) {
      flash("Enter the customer's 10-digit mobile number to send the WhatsApp receipt.", true);
      return;
    }
    setPaymentPhone(phone);
    setBusy(true);
    try {
      const payment = upiOrder && upiOrder.payment_id ? upiOrder : null;
      await protectedCall("notifications/receipt", {
        method: "POST",
        body: {
          bill_id: billDetail.bill_id,
          phone: phone,
          payment_id: payment ? payment.payment_id : undefined,
          idempotency_key: makeKey("receipt"),
        },
      });
      flash(payment && payment.payment_url ? "Receipt and Cashfree payment link submitted to MSG91." : "Receipt submitted to MSG91.");
      runInBackground(loadBill(billDetail.bill_id, { preserveContact: true, preserveUpi: true, silent: true }));
    } catch (error) {
      flash(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function setBillTestExclusion(excluded) {
    if (!isAdmin || !billDetail) return;
    let reason = "";
    if (excluded) {
      reason = window.prompt(
        "Reason for excluding this bill from accounting:",
        "Test transaction"
      );
      if (reason == null) return;
      if (!reason.trim()) {
        flash("Enter a reason before marking a bill as TEST.", true);
        return;
      }
      const ok = window.confirm(
        "Mark " + (billDetail.bill_no || "this bill") + " as TEST / excluded from accounting?\n\n" +
        "The Cashfree/payment audit trail will be preserved, but this bill will be removed from operational revenue, Finance/F&B totals, exports and daily closing."
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        "Restore " + (billDetail.bill_no || "this bill") + " to normal accounting?\n\n" +
        "Its existing successful payments will again count in revenue totals."
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const updated = await protectedCall("bills/" + billDetail.bill_id + "/accounting-exclusion", {
        method: "PATCH",
        body: {
          accounting_excluded: Boolean(excluded),
          reason: reason.trim(),
        },
      });
      setBillDetail(updated);
      flash(excluded ? "Bill marked TEST and excluded from accounting." : "Bill restored to accounting.");
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message || "Unable to update accounting status.", true);
    } finally {
      setBusy(false);
    }
  }

  async function clearPaymentAttempt(payment) {
    if (!isAdmin || !payment) return;
    const paymentId = payment.payment_id || payment.id;
    const reason = window.prompt(
      "Reason for clearing this payment attempt:",
      "Test / stale payment attempt"
    );
    if (reason == null) return;
    const ok = window.confirm(
      "Clear this " + String(payment.status || "") + " " + String(payment.method || "") +
      " attempt for " + money(payment.amount_inr) + "?\n\n" +
      "Successful VERIFIED/RECEIVED payments cannot be cleared this way."
    );
    if (!ok) return;

    setBusy(true);
    try {
      const updated = await protectedCall("payments/" + paymentId + "/cancel", {
        method: "POST",
        body: { reason: reason.trim() || "Admin cleared payment attempt" },
      });
      setBillDetail(updated);
      if (upiOrder && upiOrder.payment_id === paymentId) {
        setUpiOrder(null);
        setShowUpiQrModal(false);
      }
      flash("Payment attempt cleared.");
      runInBackground(refreshBillingOverview());
    } catch (error) {
      flash(error.message || "Unable to clear payment attempt.", true);
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
      if (bill.accounting_excluded) return false;
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

  function emptyCatalogueDraft() {
    return {
      name: "",
      category: "FOOD",
      unit: "unit",
      sellingPrice: "",
      costPrice: "",
      description: "",
      imageUrl: "",
      imagePath: "",
      qloungeCategoryKey: catalogueCategories[0]?.category_key || "",
      showOnQlounge: false,
      onlineOrderEnabled: false,
      sellInLedger: true,
      trackInventory: false,
      openingStock: "0",
      lowStockThreshold: "5",
    };
  }

  function updateCatalogueDraft(field, value) {
    setCatalogueDraft(function(current) {
      const next = { ...current, [field]: value };
      if (field === "showOnQlounge" && !value) next.onlineOrderEnabled = false;
      return next;
    });
  }

  function beginAddCatalogueItem() {
    setEditingCatalogueItemId("");
    setCatalogueDraft(emptyCatalogueDraft());
    setShowCatalogueAdd(true);
  }

  function beginEditCatalogueItem(item) {
    setEditingCatalogueItemId(item.id);
    setCatalogueDraft({
      name: item.name || "",
      category: item.category || "OTHER",
      unit: item.unit || "unit",
      sellingPrice: item.selling_price_inr == null ? "" : String(item.selling_price_inr),
      costPrice: item.cost_price_inr == null ? "" : String(item.cost_price_inr),
      description: item.description || "",
      imageUrl: item.image_url || "",
      imagePath: item.image_path || "",
      qloungeCategoryKey: item.qlounge_category_key || catalogueCategories[0]?.category_key || "",
      showOnQlounge: Boolean(item.show_on_qlounge),
      onlineOrderEnabled: Boolean(item.online_order_enabled),
      sellInLedger: item.sell_in_ledger !== false,
      trackInventory: Boolean(item.track_inventory),
      openingStock: item.current_stock == null ? "0" : String(item.current_stock),
      lowStockThreshold: item.low_stock_threshold == null ? "5" : String(item.low_stock_threshold),
    });
    setShowCatalogueAdd(true);
  }

  async function uploadCatalogueImage(file) {
    if (!file) return;
    if (!supabaseReady || !supabase) {
      flash("Supabase storage is not available in this browser.", true);
      return;
    }
    setBusy(true);
    try {
      const rawExt = String(file.name || "").split(".").pop()?.toLowerCase();
      const ext = rawExt && rawExt.length <= 8 ? rawExt : "jpg";
      const path = "menu-items/" + Date.now() + "-" + makeKey("ledger").replace(/[^a-z0-9_-]/gi, "") + "." + ext;
      const { error } = await supabase.storage.from("photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("photos").getPublicUrl(path);
      updateCatalogueDraft("imagePath", path);
      updateCatalogueDraft("imageUrl", data?.publicUrl || "");
      flash("Image uploaded. Save the item to publish it.");
    } catch (error) {
      flash(error.message || "Image upload failed.", true);
    } finally {
      setBusy(false);
    }
  }

  async function saveCatalogueItem() {
    if (!isAdmin) {
      flash("Admin PIN is required to manage catalogue items.", true);
      return;
    }
    const name = catalogueDraft.name.trim();
    const sellingPrice = Number(catalogueDraft.sellingPrice);
    const costPrice = String(catalogueDraft.costPrice).trim() === "" ? null : Number(catalogueDraft.costPrice);
    const openingStock = catalogueDraft.trackInventory ? Number(catalogueDraft.openingStock || 0) : null;
    const lowStockThreshold = catalogueDraft.trackInventory ? Number(catalogueDraft.lowStockThreshold || 0) : null;

    if (!name) return flash("Enter an item name.", true);
    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return flash("Enter a valid selling price.", true);
    if (costPrice != null && (!Number.isFinite(costPrice) || costPrice < 0)) return flash("Check the cost price.", true);
    if (catalogueDraft.showOnQlounge && !catalogueDraft.qloungeCategoryKey) return flash("Choose a Q Lounge category.", true);
    if (!editingCatalogueItemId && catalogueDraft.trackInventory && (!Number.isFinite(openingStock) || openingStock < 0 || !Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
      return flash("Check opening stock and low-stock threshold.", true);
    }

    const body = {
      name,
      category: catalogueDraft.category,
      unit: catalogueDraft.unit || "unit",
      selling_price_inr: sellingPrice,
      cost_price_inr: costPrice,
      description: catalogueDraft.description,
      image_url: catalogueDraft.imageUrl,
      image_path: catalogueDraft.imagePath,
      qlounge_category_key: catalogueDraft.showOnQlounge ? catalogueDraft.qloungeCategoryKey : null,
      show_on_qlounge: Boolean(catalogueDraft.showOnQlounge),
      online_order_enabled: Boolean(catalogueDraft.showOnQlounge && catalogueDraft.onlineOrderEnabled),
      sell_in_ledger: Boolean(catalogueDraft.sellInLedger),
    };
    if (!editingCatalogueItemId) {
      body.track_inventory = Boolean(catalogueDraft.trackInventory);
      body.opening_stock = openingStock;
      body.low_stock_threshold = lowStockThreshold;
    }

    setBusy(true);
    try {
      if (editingCatalogueItemId) {
        await protectedCall("catalogue/items/" + encodeURIComponent(editingCatalogueItemId), { method: "PATCH", body });
        flash("Item updated everywhere from the shared catalogue.");
      } else {
        await protectedCall("catalogue/items", { method: "POST", body });
        flash("Item added to the shared F&B catalogue.");
      }
      setEditingCatalogueItemId("");
      setCatalogueDraft(emptyCatalogueDraft());
      setShowCatalogueAdd(false);
      await refreshAll();
    } catch (error) {
      flash(error.message || "Unable to save item.", true);
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
      "Deactivate " + item.name + " everywhere?\n\nIt will disappear from Ledger sales and Q Lounge, but historical bills remain unchanged."
    );
    if (!ok) return;
    setBusy(true);
    try {
      await protectedCall("catalogue/items/" + encodeURIComponent(item.id), { method: "DELETE" });
      flash(item.name + " deactivated. Historical bills are preserved.");
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
          <button className="ql-tab" onClick={function() { window.open("/table-qr-print","_blank","noopener"); }}>▦ Print Table QRs</button>
          <button className="ql-tab" onClick={refreshAll}>{busy ? "Refreshing…" : "↻ Refresh"}</button>
        </div>

        {tab === "desk" ? (
          <>
            <div className="ql-stat-grid">
              <div className="ql-stat"><span className="ql-muted">Active tables</span><strong>{sessions.filter(function(s) { return ["ACTIVE", "PAUSED"].includes(s.status); }).length}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Today&apos;s finalized bills</span><strong>{todayFinalizedCount}</strong></div>
              <div className="ql-stat"><span className="ql-muted">Today&apos;s realized sales</span><strong>{money(todaySales)}</strong><div className="ql-muted">Cash {money(summary && summary.today_cash_inr)} • UPI {money(summary && summary.today_upi_inr)}</div></div>
              <div className="ql-stat"><span className="ql-muted">Outstanding all ledger</span><strong>{money(outstanding)}</strong></div>
              <div
                className={"ql-stat " + (playerTabs.length ? "clickable" : "")}
                role={playerTabs.length ? "button" : undefined}
                tabIndex={playerTabs.length ? 0 : undefined}
                onClick={playerTabs.length ? function() { setOpenClubTabsSearch(""); setOpenClubTabsView(true); } : undefined}
                onKeyDown={playerTabs.length ? function(event) {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpenClubTabsSearch("");
                    setOpenClubTabsView(true);
                  }
                } : undefined}
              >
                <span className="ql-muted">Open Club Tabs</span>
                <strong>{playerTabs.length}</strong>
                <div className="ql-muted">{playerTabs.length ? "Tap to view all player tabs" : "None open"}</div>
              </div>
              <div
                className={"ql-stat " + (tableRequests.length ? "clickable" : "")}
                role={tableRequests.length ? "button" : undefined}
                onClick={tableRequests.length ? function() {
                  const el = document.getElementById("qclub-qr-requests");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                } : undefined}
              >
                <span className="ql-muted">QR Join / Start Requests</span>
                <strong>{tableRequests.length}</strong>
                <div className="ql-muted">{tableRequests.length ? "Needs Game Marshall action" : "None waiting"}</div>
              </div>
              <div
                className={"ql-stat " + (tableOrders.length ? "clickable" : "")}
                role={tableOrders.length ? "button" : undefined}
                onClick={tableOrders.length ? function() {
                  const el = document.getElementById("qclub-qr-orders");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                } : undefined}
              >
                <span className="ql-muted">QR Food Orders</span>
                <strong>{tableOrders.length}</strong>
                <div className="ql-muted">{tableOrders.length ? "Tap to accept / reject" : "None waiting"}</div>
              </div>
            </div>
            {tableOrders.length ? (
              <>
                <div className="ql-section" id="qclub-qr-orders">Customer QR food orders</div>
                <div className="ql-grid">
                  {tableOrders.map(function(orderRow) {
                    const customerName = (orderRow.access && orderRow.access.customer_name) || "Player";
                    const table = orderRow.table || {};
                    return (
                      <div className="ql-card" key={orderRow.id} style={{ borderColor: "#4c8d69" }}>
                        <div className="ql-space">
                          <div>
                            <h3>{customerName}</h3>
                            <div className="ql-muted">Table {table.table_no || "?"} — {table.display_name || orderRow.table_id}</div>
                          </div>
                          <strong className="ql-price">{money(orderRow.total_inr)}</strong>
                        </div>
                        <div className="ql-list" style={{ marginTop: 10 }}>
                          {(orderRow.priced_lines || []).map(function(line, index) {
                            return <div className="ql-line" key={line.item_id || index}><div className="ql-space"><span>{line.name} × {Number(line.quantity || 0)}</span><strong>{money(line.line_total_inr)}</strong></div></div>;
                          })}
                        </div>
                        <div className="ql-row" style={{ marginTop: 12 }}>
                          <button className="ql-btn primary" disabled={busy} onClick={function() { decideQrOrder(orderRow,"ACCEPT"); }}>Accept • Add to Player Account</button>
                          <button className="ql-btn danger" disabled={busy} onClick={function() { decideQrOrder(orderRow,"REJECT"); }}>Reject</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            {tableRequests.length ? (
              <>
                <div className="ql-section" id="qclub-qr-requests">Customer QR requests</div>
                <div className="ql-grid">
                  {tableRequests.map(function(requestRow) {
                    const table = requestRow.table || tables.find(function(row) { return row.table_id === requestRow.table_id; });
                    const isStart = requestRow.action === "START";
                    return (
                      <div className="ql-card" key={requestRow.id} style={{ borderColor: "#8c742a" }}>
                        <div className="ql-space">
                          <div>
                            <h3>{requestRow.customer_name}</h3>
                            <div className="ql-muted">{requestRow.phone || "No mobile"}</div>
                          </div>
                          <span className="ql-badge gold">{requestRow.action === "JOIN_NEXT" ? "NEXT GAME" : requestRow.action.replaceAll("_"," ")}</span>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <strong>Table {table && table.table_no ? table.table_no : "?"} — {(table && table.display_name) || requestRow.table_id}</strong>
                          <div className="ql-muted">{requestRow.requested_game_type ? String(requestRow.requested_game_type).replaceAll("_"," ") : "Current table game"}</div>
                        </div>
                        <div className="ql-row" style={{ marginTop: 12 }}>
                          {isStart
                            ? <button className="ql-btn primary" disabled={busy} onClick={function() { decideQrRequest(requestRow,"START_FORM"); }}>Open Start Form</button>
                            : <button className="ql-btn primary" disabled={busy} onClick={function() { decideQrRequest(requestRow,"APPROVE"); }}>{requestRow.action === "JOIN_NEXT" ? "Approve Next Game" : "Approve Join"}</button>}
                          <button className="ql-btn danger" disabled={busy} onClick={function() { decideQrRequest(requestRow,"REJECT"); }}>Reject</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            <div className="ql-section">Live tables</div>
            <div className="ql-grid">
              {tables.map(function(table) {
                const session = sessionByTable[table.table_id];
                const detail = session ? sessionDetails[session.session_id] || session : null;
                const rule = rules.find(function(r) { return r.game_type === (session && session.game_type); });
                const games = (detail && detail.games) || [];
                const fnb = (detail && detail.fnb_lines) || [];
                const liveFnb = fnb.filter(function(line) { return line.status !== "VOIDED"; }).reduce(function(sum, line) { return sum + Number(line.line_total_inr || 0); }, 0);
                const people = (detail && detail.people) || [];
                const activePeople = people.filter(function(person) { return person.status === "ACTIVE"; });
                const playerDue = people.reduce(function(sum, person) { return sum + Number(person.current_due_inr || 0); }, 0);
                return (
                  <div
                    className={"ql-card ql-table-card " + (session ? "clickable" : "")}
                    key={table.table_id}
                    role={session ? "button" : undefined}
                    tabIndex={session ? 0 : undefined}
                    onClick={session ? function() { setTableViewSessionId(session.session_id); } : undefined}
                    onKeyDown={session ? function(event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setTableViewSessionId(session.session_id); } } : undefined}
                  >
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
                        <button className="ql-btn primary" onClick={function(event) { event.stopPropagation(); openStart(table); }}>+ Enter Customer in Ledger</button>
                      </>
                    ) : (
                      <>
                        <div className="ql-section">Current session</div>
                        <div className="ql-row">
                          <span className="ql-badge">{(rule && rule.display_name) || session.game_type}</span>
                          {session.account_mode === "INDIVIDUAL" ? <span className="ql-badge gold">{session.match_format || "FLEX"} • {String(session.payment_rule || "").replaceAll("_"," ")}</span> : null}
                          <span className="ql-badge">Games {games.filter(function(g) { return g.status !== "VOIDED"; }).length}</span>
                        </div>
                        {session.account_mode === "INDIVIDUAL" ? (
                          <div style={{ marginTop: 12 }}>
                            <div className="ql-space">
                              <div>
                                <strong>{activePeople.length} active player{activePeople.length === 1 ? "" : "s"}</strong>
                                <div className="ql-muted">{people.length} player account{people.length === 1 ? "" : "s"} in this session</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <strong>{money(playerDue)}</strong>
                                <div className="ql-muted">session player due</div>
                              </div>
                            </div>
                            <div className="ql-muted" style={{ marginTop: 8 }}>F&B on table {money(liveFnb)}</div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 12 }}>
                            <strong>{session.customer_name || "Guest"}</strong>
                            <div className="ql-muted">{session.customer_phone || "No phone"} • {elapsedLabel(session)}</div>
                          </div>
                        )}
                        <div className="ql-table-open-hint">Tap table to open players & controls →</div>
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
                  <div className="ql-muted">Charge a playing customer, keep a visitor&apos;s Running Tab open for repeated orders, or make a one-off Quick Bill.</div>
                  <div className="ql-row" style={{ marginTop: 10 }}>
                    <button className={"ql-btn " + (fnbDestination === "TABLE" ? "primary" : "ghost")} onClick={function() { setFnbDestination("TABLE"); setSelectedFnbTabId(""); }}>Playing Table</button>
                    <button className={"ql-btn " + (fnbDestination === "RUNNING_TAB" ? "primary" : "ghost")} onClick={function() { setFnbDestination("RUNNING_TAB"); setSelectedSessionId(""); setSelectedFnbPersonId(""); }}>Running Tab</button>
                    <button className={"ql-btn " + (fnbDestination === "WALK_IN" ? "primary" : "ghost")} onClick={function() { setFnbDestination("WALK_IN"); setSelectedSessionId(""); setSelectedFnbTabId(""); }}>Quick Bill</button>
                  </div>
                </div>

                <div style={{ minWidth: 280 }}>
                  {fnbDestination === "TABLE" ? (
                    <>
                      <label className="ql-label">Session / Table</label>
                      <select className="ql-select" value={selectedSessionId} onChange={function(e) { setSelectedSessionId(e.target.value); setSelectedFnbPersonId(""); }}>
                        <option value="">Select session</option>
                        {sessions.map(function(session) {
                          const table = tables.find(function(t) { return t.table_id === session.table_id; });
                          return <option key={session.session_id} value={session.session_id}>Table {(table && table.table_no) || "?"} — {session.customer_name || "Guest"}</option>;
                        })}
                      </select>
                      {selectedSession && selectedSession.account_mode === "INDIVIDUAL" ? (
                        <>
                          <label className="ql-label" style={{ marginTop: 8 }}>Charge F&B to</label>
                          <select className="ql-select" value={selectedFnbPersonId} onChange={function(e) { setSelectedFnbPersonId(e.target.value); }}>
                            <option value="">Select player</option>
                            {(((sessionDetails[selectedSession.session_id] || {}).people) || []).filter(function(person) { return person.status !== "SETTLED"; }).map(function(person) {
                              return <option key={person.person_id} value={person.person_id}>{person.name}{person.team_no ? " — Team " + person.team_no : ""} • Due {money(person.current_due_inr)}</option>;
                            })}
                          </select>
                        </>
                      ) : null}
                    </>
                  ) : fnbDestination === "RUNNING_TAB" ? (
                    <>
                      <label className="ql-label">Use an open tab</label>
                      <select className="ql-select" value={selectedFnbTabId} onChange={function(e) { setSelectedFnbTabId(e.target.value); }}>
                        <option value="">Select customer tab</option>
                        {fnbTabs.map(function(row) {
                          return <option key={row.tab_id} value={row.tab_id}>{row.customer_name} • {money(row.total_inr)}</option>;
                        })}
                      </select>
                      {selectedFnbTab ? <div className="ql-muted" style={{ marginTop: 6 }}>{selectedFnbTab.item_count} item(s) • Running total {money(selectedFnbTab.total_inr)}</div> : null}

                      <div className="ql-section" style={{ marginTop: 14 }}>Open new tab</div>
                      <label className="ql-label">Customer name</label>
                      <input
                        className="ql-input"
                        value={newTabName}
                        onChange={function(e) {
                          const value = e.target.value.toUpperCase();
                          setNewTabName(value);
                          setNewTabCustomerId("");
                          const exact = customerMatches(value, 2);
                          if (exact.length === 1 && normalizeCustomerLookup(exact[0].name) === normalizeCustomerLookup(value)) { setNewTabCustomerId(exact[0].customer_id || exact[0].id || ""); if (exact[0].phone) setNewTabPhone(exact[0].phone); }
                        }}
                        placeholder="Type a regular customer's name"
                        autoComplete="off"
                      />
                      {renderCustomerMatches(newTabName, applyCustomerToNewTab)}
                      <label className="ql-label" style={{ marginTop: 8 }}>Mobile (optional)</label>
                      <input
                        className="ql-input"
                        inputMode="numeric"
                        value={newTabPhone}
                        onChange={function(e) {
                          const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setNewTabPhone(value);
                          const match = customerByPhone(value);
                          if (match) { setNewTabCustomerId(match.customer_id || match.id || ""); setNewTabName(String(match.name || newTabName).toUpperCase()); }
                        }}
                        placeholder="Auto-fills for known regulars"
                      />
                      <button className="ql-btn primary" style={{ width: "100%", marginTop: 9 }} disabled={busy || !newTabName.trim()} onClick={createRunningFnbTab}>+ Open Club Tab</button>
                    </>
                  ) : (
                    <>
                      <label className="ql-label">Visitor name (optional)</label>
                      <input
                        className="ql-input"
                        value={walkInName}
                        onChange={function(e) {
                          const value = e.target.value.toUpperCase();
                          setWalkInName(value);
                          const exact = customerMatches(value, 2);
                          if (exact.length === 1 && normalizeCustomerLookup(exact[0].name) === normalizeCustomerLookup(value) && exact[0].phone) setWalkInPhone(exact[0].phone);
                        }}
                        placeholder="Type name — regulars auto-fill"
                        autoComplete="off"
                      />
                      {renderCustomerMatches(walkInName, applyCustomerToWalkIn)}
                      <label className="ql-label" style={{ marginTop: 8 }}>Mobile (optional)</label>
                      <input
                        className="ql-input"
                        inputMode="numeric"
                        value={walkInPhone}
                        onChange={function(e) {
                          const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setWalkInPhone(value);
                          const match = customerByPhone(value);
                          if (match) setWalkInName(String(match.name || walkInName).toUpperCase());
                        }}
                        placeholder="Auto-fills for known regulars"
                      />
                      <div className="ql-muted" style={{ marginTop: 7 }}>Quick Bill creates a payable bill immediately. Use Club Tab when the customer may order again or later join a table.</div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {fnbDestination === "RUNNING_TAB" ? (
              <>
                <div className="ql-section">Open customer Club Tabs — {fnbTabs.length}</div>
                <div className="ql-grid">
                  {fnbTabs.length ? fnbTabs.map(function(row) {
                    const selected = row.tab_id === selectedFnbTabId;
                    return (
                      <div className={"ql-card " + (selected ? "wide" : "")} key={row.tab_id} style={selected ? { borderColor: "#69dca0" } : undefined}>
                        <div className="ql-space">
                          <div>
                            <h3>{row.customer_name}</h3>
                            <div className="ql-muted">{row.customer_phone || "No mobile"} • {row.tab_no}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <strong className="ql-price">{money(row.total_inr)}</strong>
                            <div className="ql-muted">{row.item_count} item(s)</div>
                          </div>
                        </div>
                        <div className="ql-muted" style={{ marginTop: 7 }}>Last order {row.last_order_at ? new Date(row.last_order_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                        <div className="ql-row" style={{ marginTop: 10 }}>
                          <button className={"ql-btn " + (selected ? "primary" : "")} onClick={function() { setSelectedFnbTabId(row.tab_id); }}>+ Add Order</button>
                          <button className="ql-btn gold" disabled={busy || !(Number(row.total_inr) > 0)} onClick={function() { closeRunningFnbTab(row); }}>Pay / Close Club Tab</button>
                          {Number(row.item_count || 0) === 0 ? <button className="ql-btn danger" disabled={busy} onClick={function() { cancelEmptyRunningFnbTab(row); }}>Cancel</button> : null}
                        </div>

                        {selected ? (
                          <div className="ql-list" style={{ marginTop: 12 }}>
                            {(row.lines || []).filter(function(line) { return line.status === "ACTIVE"; }).length ? (row.lines || []).filter(function(line) { return line.status === "ACTIVE"; }).map(function(line) {
                              return (
                                <div className="ql-line" key={line.id}>
                                  <div className="ql-space">
                                    <div>
                                      <strong>{line.item_name_snapshot} × {Number(line.quantity)}</strong>
                                      <div className="ql-muted">{line.added_at ? new Date(line.added_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <strong>{money(line.line_total_inr)}</strong>
                                      {isAdmin ? <div><button className="ql-btn danger" style={{ marginTop: 6 }} onClick={function() { voidFnbLine(line); }}>Void</button></div> : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            }) : <div className="ql-empty">No orders yet. Select items below and tap Add to Tab.</div>}
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <div className="ql-card full"><div className="ql-empty">No running tabs. Enter a customer name above and open one.</div></div>}
                </div>
              </>
            ) : null}
            <div className="ql-section">Live catalogue</div>
            <div className="ql-fnb-tools">
              <div className="ql-autocomplete" ref={fnbAutocompleteRef}>
                <label className="ql-label" htmlFor="qclub-fnb-search">Search food / drinks</label>
                <input
                  id="qclub-fnb-search"
                  ref={fnbSearchInputRef}
                  className="ql-input"
                  value={fnbSearch}
                  onChange={function(e) {
                    const value = e.target.value;
                    setFnbSearch(value);
                    setFnbAutocompleteOpen(Boolean(value.trim()));
                    setFnbAutocompleteIndex(value.trim() ? 0 : -1);
                  }}
                  onFocus={function() {
                    if (fnbSearch.trim() && fnbAutocompleteResults.length) setFnbAutocompleteOpen(true);
                  }}
                  onKeyDown={handleFnbSearchKeyDown}
                  placeholder="Type item name..."
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showFnbAutocomplete}
                  aria-controls="qclub-fnb-autocomplete"
                  aria-activedescendant={showFnbAutocomplete && fnbAutocompleteIndex >= 0 ? "qclub-fnb-option-" + fnbAutocompleteIndex : undefined}
                />
                {showFnbAutocomplete ? (
                  <div id="qclub-fnb-autocomplete" className="ql-autocomplete-menu" role="listbox">
                    {fnbAutocompleteResults.map(function(item, index) {
                      const active = index === fnbAutocompleteIndex;
                      return (
                        <button
                          id={"qclub-fnb-option-" + index}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={"ql-autocomplete-option " + (active ? "active" : "")}
                          key={item.id}
                          onMouseDown={function(e) { e.preventDefault(); }}
                          onClick={function() { selectFnbAutocompleteItem(item); }}
                        >
                          <span className="ql-autocomplete-name">{item.name}</span>
                          <span className="ql-autocomplete-meta">
                            <span>{item.category || "Other"}</span>
                            <span className="ql-autocomplete-price">{money(item.selling_price_inr)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="ql-label">Category</label>
                <div className="ql-row" role="group" aria-label="F&B category filter" style={{ gap: 6, flexWrap: "wrap" }} data-category-filter="buttons">
                  {fnbCategories.map(function(category) {
                    const active = fnbCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        className={"ql-btn " + (active ? "primary" : "")}
                        aria-pressed={active}
                        onClick={function() { setFnbCategory(category); }}
                      >
                        {category === "ALL" ? "ALL" : category}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className={"ql-fnb-actionbar " + (selectedFnbCount > 0 ? "has-items" : "")}>
              <div className="ql-space">
                <div>
                  <strong>Cart • {selectedFnbCount} item(s) • {money(selectedFnbTotal)}</strong>
                  <div className="ql-muted">
                    {fnbDestination === "RUNNING_TAB"
                      ? (selectedFnbTab ? "Charge to " + selectedFnbTab.customer_name + "'s Club Tab" : "Choose a Club Tab above")
                      : fnbDestination === "WALK_IN"
                        ? "Walk-in Quick Bill"
                        : selectedSession && selectedSession.account_mode === "INDIVIDUAL"
                          ? (selectedFnbPerson ? "Charge to " + selectedFnbPerson.name + " • " + String(selectedSession.table_id || "").replace("table_","T") : "Choose which player is ordering")
                          : selectedSession
                            ? "Charge to " + String(selectedSession.table_id || "").replace("table_","T") + " table bill"
                            : "Choose destination above"}
                  </div>
                </div>
                <div className="ql-row" style={{ justifyContent: "flex-end" }}>
                  {selectedFnbCount > 0 ? <button className="ql-btn ghost" disabled={busy} onClick={function() { setQuantities({}); }}>Clear</button> : null}
                  <button className="ql-btn primary" disabled={(fnbDestination === "TABLE" && (!selectedSessionId || (selectedSession && selectedSession.account_mode === "INDIVIDUAL" && !selectedFnbPersonId))) || (fnbDestination === "RUNNING_TAB" && !selectedFnbTabId) || busy || selectedFnbCount <= 0} onClick={addFnb}>
                    {busy
                      ? "Adding…"
                      : fnbDestination === "RUNNING_TAB"
                        ? "Add " + money(selectedFnbTotal) + " to " + (selectedFnbTab ? selectedFnbTab.customer_name : "Club Tab")
                        : fnbDestination === "WALK_IN"
                          ? "Create Quick Bill • " + money(selectedFnbTotal)
                          : selectedSession && selectedSession.account_mode === "INDIVIDUAL"
                            ? "Add " + money(selectedFnbTotal) + " to " + (selectedFnbPerson ? selectedFnbPerson.name : "Player")
                            : "Add to Table Bill • " + money(selectedFnbTotal)}
                  </button>
                </div>
              </div>
            </div>
            <div className="ql-fnb-spacer" aria-hidden="true" />
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
                {isAdmin ? (
                  <label className="ql-line" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: 0, padding: "8px 10px" }}>
                    <input
                      type="checkbox"
                      checked={showExcludedBills}
                      onChange={function(e) {
                        const next = e.target.checked;
                        setShowExcludedBills(next);
                        if (!next && billDetail && billDetail.accounting_excluded) {
                          setBillDetail(null);
                          setUpiOrder(null);
                          setShowUpiQrModal(false);
                        }
                      }}
                    />
                    <span>Show TEST / excluded bills</span>
                  </label>
                ) : null}
              </div>
              <div className="ql-list" style={{ marginTop: 12, maxHeight: "70vh", overflow: "auto" }}>
                {filteredBills.length ? filteredBills.map(function(bill) {
                  const session = sessionLookup[bill.session_id];
                  return (
                    <button key={bill.bill_id} className={"ql-line " + (billDetail && billDetail.bill_id === bill.bill_id ? "selected" : "")} style={{ color: "inherit", textAlign: "left", cursor: "pointer" }} onClick={function() { loadBill(bill.bill_id); }}>
                      <div className="ql-space"><strong>{bill.bill_no || bill.bill_id}</strong><span className={"ql-badge " + (bill.accounting_excluded ? "gold" : (Number(bill.due_inr) > 0 ? "bad" : ""))}>{bill.accounting_excluded ? "TEST / EXCLUDED" : bill.status}</span></div>
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
                    <span className={"ql-badge " + (billDetail.accounting_excluded ? "gold" : (Number(billDetail.due_inr) > 0 ? "bad" : ""))}>{billDetail.accounting_excluded ? "TEST / EXCLUDED" : billDetail.status}</span>
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
                    {isAdmin ? (
                      <button
                        className={billDetail.accounting_excluded ? "ql-btn" : "ql-btn danger"}
                        disabled={busy}
                        onClick={function() { setBillTestExclusion(!billDetail.accounting_excluded); }}
                      >
                        {billDetail.accounting_excluded ? "Restore to Accounting" : "Mark as TEST / Exclude"}
                      </button>
                    ) : null}
                  </div>
                  {billDetail.accounting_excluded ? (
                    <div className="ql-line" style={{ marginTop: 10 }}>
                      <strong>TEST / ACCOUNTING EXCLUDED</strong>
                      <div className="ql-muted">{billDetail.exclusion_reason || "Excluded by Admin"} • Provider/payment audit history is preserved.</div>
                    </div>
                  ) : null}

                  <div className="ql-section">Payments — Cash / UPI / Online</div>
                  {billDetail.customer_id ? (
                    <div className="ql-line" style={{ marginBottom: 12 }}>
                      <div className="ql-space">
                        <div>
                          <strong>Player carry balance</strong>
                          <div className="ql-muted">Positive = credit • Negative = debit • every change is timestamped.</div>
                        </div>
                        <strong style={{ fontSize: 18 }}>{money(billDetail.customer_balance_inr || 0)}</strong>
                      </div>
                      {Math.abs(Number(billDetail.customer_balance_inr || 0)) > 0.009 && Number(billDetail.due_inr) > 0 ? (
                        <button className="ql-btn" style={{ marginTop: 9 }} disabled={busy} onClick={applyCarriedBalance}>Apply carried balance to this bill</button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="ql-paybox">
                    <div className="ql-line">
                      <strong>Cash / UPI</strong>
                      <label className="ql-label" style={{ marginTop: 8 }}>How did the player pay?</label>
                      <select className="ql-select" value={manualPaymentMethod} onChange={function(e) { setManualPaymentMethod(e.target.value); }}>
                        <option value="CASH">Cash</option>
                        <option value="UPI">UPI — shop/static QR</option>
                      </select>
                      <label className="ql-label" style={{ marginTop: 8 }}>Amount actually received</label>
                      <input className="ql-input" type="number" min="0" step="0.01" value={cashAmount} onChange={function(e) { setCashAmount(e.target.value); }} />
                      <label className="ql-line" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 9 }}>
                        <input type="checkbox" checked={carryDifference} onChange={function(e) { setCarryDifference(e.target.checked); }} />
                        <span><strong>Carry difference</strong><div className="ql-muted">Extra becomes player credit; shortfall becomes player debit for the next game.</div></span>
                      </label>
                      <button className="ql-btn primary" style={{ width: "100%", marginTop: 9 }} disabled={busy || Number(billDetail.due_inr) <= 0} onClick={recordCash}>Record {manualPaymentMethod === "UPI" ? "UPI" : "Cash"}</button>
                    </div>
                    <div className="ql-line">
                      <strong>Online</strong>
                      <label className="ql-label" style={{ marginTop: 8 }}>Customer mobile for Cashfree / WhatsApp</label>
                      <input
                        className="ql-input"
                        inputMode="numeric"
                        maxLength={10}
                        value={paymentPhone}
                        onChange={function(e) { setPaymentPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); }}
                        placeholder="10-digit mobile"
                      />
                      <div className="ql-muted" style={{ marginTop: 6 }}>Use this only for the dynamic Cashfree QR generated by QclubLedger.</div>
                      <label className="ql-label" style={{ marginTop: 8 }}>Online amount</label>
                      <input className="ql-input" type="number" min="0" step="0.01" value={upiAmount} onChange={function(e) { setUpiAmount(e.target.value); }} />
                      <button className="ql-btn gold" style={{ width: "100%", marginTop: 9 }} disabled={busy || Number(billDetail.due_inr) <= 0} onClick={createUpi}>Generate Cashfree QR</button>
                      <div className="ql-muted" style={{ marginTop: 8 }}>Cashfree verifies this automatically. Do not use this for payments made to the shop/static QR.</div>
                    </div>
                    <div className="ql-line">
                      <strong>Receipt</strong>
                      <div className="ql-muted" style={{ margin: "9px 0" }}>
                        {billDetail.status === "PAID"
                          ? "Receipt was sent automatically when the bill became fully paid. Use the button below only to resend it."
                          : "WhatsApp receipt will be sent automatically after the bill becomes fully paid."}
                      </div>
                      <button className="ql-btn" style={{ width: "100%" }} disabled={busy} onClick={sendReceipt}>
                        {billDetail.status === "PAID" ? "Resend Receipt" : (upiOrder && upiOrder.payment_url ? "Send Receipt + Payment Link" : "Send Receipt")}
                      </button>
                    </div>
                  </div>

                  {upiOrder && upiOrder.qr_payload ? (
                    <div className="ql-line" style={{ marginTop: 12 }}>
                      <div className="ql-space">
                        <div><strong>Cashfree Online Payment</strong><div className="ql-muted">{money(upiOrder.amount_inr)} • {upiOrder.status}</div><div className="ql-muted">Payment ID: {upiOrder.payment_id}</div></div>
                        <div className="ql-qr"><QRCodeSVG value={upiOrder.qr_payload} size={170} /></div>
                      </div>
                      <div className="ql-row" style={{ marginTop: 10 }}>
                        <button className="ql-btn gold" onClick={function() { setQrClock(Date.now()); setShowUpiQrModal(true); }}>Show Large QR</button>
                        <button className="ql-btn" onClick={function() { verifyPayment(upiOrder.payment_id); }}>Check Verification</button>
                        {upiOrder.payment_url ? <a className="ql-btn gold" href={upiOrder.payment_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open Customer Pay Link</a> : null}
                      </div>
                    </div>
                  ) : null}

                  {(billDetail.balance_history || []).length ? (
                    <>
                      <div className="ql-section">Player credit / debit history</div>
                      <div className="ql-list">
                        {(billDetail.balance_history || []).slice(0, 8).map(function(entry) {
                          return (
                            <div className="ql-line ql-space" key={entry.id}>
                              <div>
                                <strong>{Number(entry.delta_inr) > 0 ? "CREDIT +" : "DEBIT / USE "}{money(Math.abs(Number(entry.delta_inr || 0)))}</strong>
                                <div className="ql-muted">{entry.note || entry.entry_type} • {dateTime(entry.created_at)}</div>
                              </div>
                              <div className="ql-muted">Balance {money(entry.balance_after_inr)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  <div className="ql-section">Recorded payments</div>
                  <div className="ql-list">
                    {(billDetail.payments || []).length ? (billDetail.payments || []).map(function(payment) {
                      const paymentId = payment.payment_id || payment.id;
                      return (
                        <div className="ql-line ql-space" key={paymentId}>
                          <div><strong>{payment.method} • {money(payment.amount_inr)}</strong><div className="ql-muted">{payment.status} • {paymentId}</div></div>
                          <div className="ql-row">
                            {(payment.method === "ONLINE" || (payment.method === "UPI" && payment.cashfree_order_id)) && payment.status === "PENDING" ? <button className="ql-btn" disabled={busy} onClick={function() { verifyPayment(paymentId); }}>Verify Payment</button> : null}
                          </div>
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
                <div className="ql-section">Shared F&B Master Catalogue</div>
                <div className="ql-card full">
                  <div className="ql-space">
                    <div>
                      <h3>One catalogue for Ledger + Q Lounge</h3>
                      <div className="ql-muted">
                        {catalogue.length} active item(s). Price and public-menu details here are the master values used across the club.
                      </div>
                    </div>
                    <button className="ql-btn primary" onClick={beginAddCatalogueItem}>+ Add Item</button>
                  </div>

                  {showCatalogueAdd ? (
                    <div className="ql-line" style={{ marginTop: 14 }}>
                      <div className="ql-space" style={{ marginBottom: 10 }}>
                        <strong>{editingCatalogueItemId ? "Edit Item" : "Add Item"}</strong>
                        <button className="ql-btn ghost" onClick={function() { setShowCatalogueAdd(false); setEditingCatalogueItemId(""); }}>Close</button>
                      </div>
                      <div className="ql-form-grid">
                        <label><span className="ql-label">Item name</span><input className="ql-input" value={catalogueDraft.name} onChange={function(e) { updateCatalogueDraft("name", e.target.value); }} /></label>
                        <label>
                          <span className="ql-label">Ledger category</span>
                          <select className="ql-select" value={catalogueDraft.category} onChange={function(e) { updateCatalogueDraft("category", e.target.value); }}>
                            <option value="FOOD">Food</option><option value="BEVERAGES">Beverages</option><option value="OTHER">Other</option>
                          </select>
                        </label>
                        <label><span className="ql-label">Selling price ₹</span><input className="ql-input" type="number" min="0" step="0.01" value={catalogueDraft.sellingPrice} onChange={function(e) { updateCatalogueDraft("sellingPrice", e.target.value); }} /></label>
                        <label><span className="ql-label">Purchase / cost price ₹</span><input className="ql-input" type="number" min="0" step="0.01" value={catalogueDraft.costPrice} onChange={function(e) { updateCatalogueDraft("costPrice", e.target.value); }} placeholder="Optional" /></label>
                        <label><span className="ql-label">Unit</span><input className="ql-input" value={catalogueDraft.unit} onChange={function(e) { updateCatalogueDraft("unit", e.target.value); }} placeholder="unit / bottle / plate" /></label>
                        <label className="full"><span className="ql-label">Public description</span><input className="ql-input" value={catalogueDraft.description} onChange={function(e) { updateCatalogueDraft("description", e.target.value); }} placeholder="Shown on Q Lounge" /></label>
                        <label>
                          <span className="ql-label">Q Lounge category</span>
                          <select className="ql-select" value={catalogueDraft.qloungeCategoryKey} disabled={!catalogueDraft.showOnQlounge} onChange={function(e) { updateCatalogueDraft("qloungeCategoryKey", e.target.value); }}>
                            <option value="">Choose category</option>
                            {catalogueCategories.map(function(category) { return <option key={category.category_key} value={category.category_key}>{category.title}</option>; })}
                          </select>
                        </label>
                        <label>
                          <span className="ql-label">Item image</span>
                          <input className="ql-input" type="file" accept="image/*" onChange={function(e) { uploadCatalogueImage(e.target.files && e.target.files[0]); }} />
                        </label>
                        {catalogueDraft.imageUrl ? <div className="full ql-muted">Image ready: {catalogueDraft.imageUrl}</div> : null}

                        <label className="ql-line" style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                          <input type="checkbox" checked={catalogueDraft.sellInLedger} onChange={function(e) { updateCatalogueDraft("sellInLedger", e.target.checked); }} />
                          <span><strong>Sell in Ledger</strong><div className="ql-muted">Available to staff for table/walk-in billing.</div></span>
                        </label>
                        <label className="ql-line" style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                          <input type="checkbox" checked={catalogueDraft.showOnQlounge} onChange={function(e) { updateCatalogueDraft("showOnQlounge", e.target.checked); }} />
                          <span><strong>Show on Q Lounge</strong><div className="ql-muted">Visible on the public Food & Drinks menu.</div></span>
                        </label>
                        <label className="ql-line" style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                          <input type="checkbox" disabled={!catalogueDraft.showOnQlounge} checked={catalogueDraft.onlineOrderEnabled} onChange={function(e) { updateCatalogueDraft("onlineOrderEnabled", e.target.checked); }} />
                          <span><strong>Online ordering</strong><div className="ql-muted">Allow customers to add this item to their Q Lounge cart.</div></span>
                        </label>

                        {!editingCatalogueItemId ? (
                          <>
                            <label className="ql-line" style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                              <input type="checkbox" checked={catalogueDraft.trackInventory} onChange={function(e) { updateCatalogueDraft("trackInventory", e.target.checked); }} />
                              <span><strong>Track stock</strong><div className="ql-muted">Use for packaged/bottled items that must be replenished.</div></span>
                            </label>
                            {catalogueDraft.trackInventory ? (
                              <>
                                <label><span className="ql-label">Opening stock</span><input className="ql-input" type="number" min="0" step="1" value={catalogueDraft.openingStock} onChange={function(e) { updateCatalogueDraft("openingStock", e.target.value); }} /></label>
                                <label><span className="ql-label">Low-stock warning at</span><input className="ql-input" type="number" min="0" step="1" value={catalogueDraft.lowStockThreshold} onChange={function(e) { updateCatalogueDraft("lowStockThreshold", e.target.value); }} /></label>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                        <button className="ql-btn" disabled={busy} onClick={function() { setShowCatalogueAdd(false); setEditingCatalogueItemId(""); }}>Cancel</button>
                        <button className="ql-btn primary" disabled={busy} onClick={saveCatalogueItem}>{busy ? "Saving…" : (editingCatalogueItemId ? "Save Changes" : "Save Item")}</button>
                      </div>
                    </div>
                  ) : null}

                  <div className="ql-list" style={{ marginTop: 14, maxHeight: "58vh", overflow: "auto" }}>
                    {catalogue.length ? catalogue.map(function(item) {
                      return (
                        <div className="ql-line" key={item.id}>
                          <div className="ql-space">
                            <div>
                              <strong>{item.name}</strong>
                              <div className="ql-muted">
                                {money(item.selling_price_inr)} • {String(item.category || "OTHER").replaceAll("_", " ")}
                                {item.track_inventory ? " • stock tracked" : ""}
                              </div>
                              <div className="ql-row" style={{ marginTop: 6 }}>
                                <span className={"ql-badge " + (item.sell_in_ledger === false ? "bad" : "")}>Ledger {item.sell_in_ledger === false ? "OFF" : "ON"}</span>
                                <span className={"ql-badge " + (!item.show_on_qlounge ? "bad" : "")}>Q Lounge {item.show_on_qlounge ? "ON" : "OFF"}</span>
                                <span className={"ql-badge " + (!item.online_order_enabled ? "bad" : "")}>Online {item.online_order_enabled ? "ON" : "OFF"}</span>
                              </div>
                            </div>
                            <div className="ql-row">
                              <button className="ql-btn" disabled={busy} onClick={function() { beginEditCatalogueItem(item); }}>Edit</button>
                              <button className="ql-btn danger" disabled={busy} onClick={function() { removeCatalogueItem(item); }}>Deactivate</button>
                            </div>
                          </div>
                        </div>
                      );
                    }) : <div className="ql-empty">No active catalogue items.</div>}
                  </div>
                </div>
              </>
            ) : (
              <div className="ql-card full" style={{ marginTop: 14 }}>
                <strong>Staff read-only inventory view.</strong>
                <div className="ql-muted">Shared catalogue changes and stock adjustments require an Admin PIN session.</div>
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

      {openClubTabsView ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setOpenClubTabsView(false); }}>
          <div className="ql-modal" style={{ maxWidth: 1120 }}>
            <div className="ql-space">
              <div>
                <h3 style={{ margin: 0 }}>Open Club Tabs</h3>
                <div className="ql-muted">{playerTabs.length} player account{playerTabs.length === 1 ? "" : "s"} • search and tap a player to view or settle</div>
              </div>
              <button className="ql-btn ghost" aria-label="Close Open Club Tabs popup" onClick={function() { setOpenClubTabsView(false); }}>✕</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="ql-label">Find player</label>
              <input
                className="ql-input"
                value={openClubTabsSearch}
                onChange={function(event) { setOpenClubTabsSearch(event.target.value); }}
                placeholder="Type player name, mobile or table"
                autoFocus
              />
            </div>

            <div className="ql-section">Player Tabs</div>
            {filteredOpenClubTabs.length ? (
              <div className="ql-player-grid">
                {filteredOpenClubTabs.map(function(playerTab) {
                  const locations=(playerTab.active_locations || []).map(function(x){
                    return String(x.table_id || "").replace("table_","T") + " " + String(x.game_type || "").replaceAll("_"," ");
                  }).join(" • ");
                  return (
                    <div
                      className="ql-player-card ql-club-tab-card"
                      key={playerTab.customer_id}
                      role="button"
                      tabIndex={0}
                      onClick={function() {
                        setOpenClubTabsView(false);
                        setClubTabViewCustomerId(playerTab.customer_id);
                      }}
                      onKeyDown={function(event) {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setOpenClubTabsView(false);
                          setClubTabViewCustomerId(playerTab.customer_id);
                        }
                      }}
                    >
                      <div className="ql-space">
                        <div style={{ minWidth: 0 }}>
                          <strong>{playerTab.name}</strong>
                          <div className="ql-muted">{locations || "In club • not currently playing"}</div>
                        </div>
                        <strong>{money(playerTab.current_due_inr)}</strong>
                      </div>
                      <div className="ql-muted" style={{ marginTop: 8 }}>
                        F&B {money(playerTab.fnb_unbilled_inr)} • Games/Table {money(playerTab.player_unbilled_inr)} • Earlier due {money(playerTab.billed_due_inr)}
                      </div>
                      <div className="ql-row" style={{ marginTop: 9 }}>
                        {(playerTab.active_locations || []).length ? <span className="ql-badge good">PLAYING</span> : <span className="ql-badge">TAB OPEN</span>}
                        {Number(playerTab.unbilled_inr || 0) > 0 ? <span className="ql-badge gold">NEW {money(playerTab.unbilled_inr)}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="ql-empty">No player tabs match this search.</div>
            )}

            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="ql-btn ghost" onClick={function() { setOpenClubTabsView(false); }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {clubTabView ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setClubTabViewCustomerId(""); }}>
          <div className="ql-modal" style={{ maxWidth: 820 }}>
            <div className="ql-space">
              <div>
                <h3 style={{ margin: 0 }}>{clubTabView.name} — Club Tab</h3>
                <div className="ql-muted">Customer account stays open across tables, games and F&B orders until checkout.</div>
              </div>
              <button className="ql-btn ghost" aria-label="Close Club Tab popup" onClick={function() { setClubTabViewCustomerId(""); }}>✕</button>
            </div>

            <div className="ql-row" style={{ marginTop: 12 }}>
              {(clubTabView.active_locations || []).length ? (clubTabView.active_locations || []).map(function(location) {
                return <span className="ql-badge good" key={location.session_id}>{String(location.table_id || "").replace("table_","T")} • {String(location.game_type || "").replaceAll("_"," ")}</span>;
              }) : <span className="ql-badge">NOT CURRENTLY PLAYING</span>}
            </div>

            <div className="ql-compact-stat" style={{ marginTop: 14 }}>
              <div
                className="ql-stat clickable"
                role="button"
                tabIndex={0}
                onClick={function() { openClubTabDetail(clubTabView); }}
                onKeyDown={function(event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openClubTabDetail(clubTabView); } }}
              >
                <span className="ql-muted">CURRENT DUE • TAP FOR DETAILS</span>
                <strong>{money(clubTabView.current_due_inr)}</strong>
              </div>
              <div className="ql-stat"><span className="ql-muted">NEW / UNBILLED</span><strong>{money(clubTabView.unbilled_inr)}</strong><div className="ql-muted">F&B {money(clubTabView.fnb_unbilled_inr)} • Games/Table {money(clubTabView.player_unbilled_inr)}</div></div>
              <div className="ql-stat"><span className="ql-muted">EARLIER BILLED DUE</span><strong>{money(clubTabView.billed_due_inr)}</strong></div>
            </div>

            <div className="ql-line" style={{ marginTop: 14 }}>
              <strong>One Club Tab, even when the player is not on a table.</strong>
              <div className="ql-muted" style={{ marginTop: 4 }}>
                Add food or drinks here, move between tables, and keep every game/table/F&B charge under the same customer account. Checkout only when the customer is ready to settle.
              </div>
            </div>

            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="ql-btn primary" disabled={busy} onClick={function() { addFnbForClubTab(clubTabView); }}>+ Add F&B</button>
              <button className="ql-btn" disabled={clubTabDetailLoading} onClick={function() { openClubTabDetail(clubTabView); }}>{clubTabDetailLoading ? "Loading…" : "View Activity"}</button>
              {Number(clubTabView.current_due_inr || 0) > 0.009 ? (
                <button className="ql-btn gold" disabled={busy} onClick={function() { prepareClubTabCheckout(clubTabView); }}>Checkout</button>
              ) : null}
              <button className="ql-btn ghost" onClick={function() { setClubTabViewCustomerId(""); }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {clubTabDetail ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setClubTabDetail(null); }}>
          <div className="ql-modal" style={{ maxWidth: 1080 }}>
            <div className="ql-space">
              <div>
                <h3 style={{ margin: 0 }}>{clubTabDetail.customer?.name || "Customer"} — Club Tab Activity</h3>
                <div className="ql-muted">Live running check • tables, games, F&B, previous bills and payments in one place</div>
              </div>
              <button className="ql-btn ghost" aria-label="Close Club Tab activity popup" onClick={function() { setClubTabDetail(null); }}>✕</button>
            </div>

            <div className="ql-row" style={{ marginTop: 12 }}>
              {(clubTabDetail.active_locations || []).length ? (clubTabDetail.active_locations || []).map(function(location) {
                return <span className="ql-badge good" key={location.session_id}>{String(location.table_id || "").replace("table_","T")} • {String(location.game_type || "").replaceAll("_"," ")}</span>;
              }) : <span className="ql-badge">NOT CURRENTLY PLAYING</span>}
              {clubTabDetail.customer?.is_member ? <span className="ql-badge gold">MEMBER</span> : null}
            </div>

            <div className="ql-compact-stat" style={{ marginTop: 14 }}>
              <div className="ql-stat"><span className="ql-muted">CURRENT DUE</span><strong>{money(clubTabDetail.current_due_inr)}</strong></div>
              <div className="ql-stat"><span className="ql-muted">NEW / UNBILLED</span><strong>{money(clubTabDetail.unbilled?.total_inr)}</strong><div className="ql-muted">F&B {money(clubTabDetail.unbilled?.fnb_inr)} • Games/Table {money(clubTabDetail.unbilled?.games_table_inr)}</div></div>
              <div className="ql-stat"><span className="ql-muted">EARLIER BILLED DUE</span><strong>{money(clubTabDetail.billed_due_inr)}</strong></div>
            </div>

            <div className="ql-row" style={{ marginTop: 14 }}>
              <button className="ql-btn primary" disabled={busy} onClick={function() {
                addFnbForClubTab({
                  customer_id: clubTabDetail.customer.customer_id,
                  name: clubTabDetail.customer.name,
                  phone: clubTabDetail.customer.phone,
                });
              }}>+ Add F&B</button>
              <button className="ql-btn" disabled={clubTabDetailLoading} onClick={function() {
                openClubTabDetail({
                  customer_id: clubTabDetail.customer.customer_id,
                  name: clubTabDetail.customer.name,
                  phone: clubTabDetail.customer.phone,
                }, { silent: false });
              }}>↻ Refresh Activity</button>
            </div>

            <div className="ql-section">Account Activity</div>
            <div className="ql-list" style={{ maxHeight: "38vh", overflow: "auto" }}>
              {(clubTabDetail.activity || []).length ? (clubTabDetail.activity || []).map(function(entry) {
                const meta = [
                  entry.table_id ? String(entry.table_id).replace("table_","T") : "",
                  entry.game_type ? String(entry.game_type).replaceAll("_"," ") : "",
                  entry.bill_no || "",
                  dateTime(entry.occurred_at),
                ].filter(Boolean).join(" • ");
                return (
                  <div className="ql-line ql-space" key={entry.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ql-row">
                        <span className={"ql-badge " + (entry.kind === "PAYMENT" ? "good" : entry.status === "BILLED" ? "gold" : "")}>{entry.kind}</span>
                        <span className="ql-badge">{entry.status}</span>
                      </div>
                      <strong style={{ display: "block", marginTop: 6 }}>{entry.description}</strong>
                      <div className="ql-muted">
                        {entry.quantity && Number(entry.quantity) !== 1 ? entry.quantity + " × " + money(entry.unit_price_inr) + " • " : ""}{meta}
                      </div>
                    </div>
                    <strong style={{ whiteSpace: "nowrap" }}>{clubActivityAmount(entry)}</strong>
                  </div>
                );
              }) : <div className="ql-empty">No charge activity on this Club Tab yet.</div>}
            </div>

            {(clubTabDetail.outstanding_bills || []).length ? (
              <>
                <div className="ql-section">Outstanding Bills</div>
                <div className="ql-list">
                  {(clubTabDetail.outstanding_bills || []).map(function(bill) {
                    return (
                      <div className="ql-line ql-space" key={bill.bill_id}>
                        <div>
                          <strong>{bill.bill_no}</strong>
                          <div className="ql-muted">{bill.status} • {dateTime(bill.finalized_at)} • total {money(bill.total_inr)} • paid {money(bill.paid_inr)}</div>
                        </div>
                        <div className="ql-row">
                          <strong>{money(bill.due_inr)} due</strong>
                          <button className="ql-btn" onClick={async function() {
                            await loadBill(bill.bill_id);
                            setClubTabDetail(null);
                            setTab("ledger");
                          }}>Open Bill</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            <div className="ql-section">Checkout</div>
            {Number(clubTabDetail.unbilled?.total_inr || 0) > 0.009 ? (
              <div className="ql-line">
                <strong>Prepare the final checkout first.</strong>
                <div className="ql-muted" style={{ marginTop: 4 }}>
                  This freezes all current game/table/F&B charges into an auditable bill. Earlier unpaid bills remain intact but are included in the one Club Tab balance below.
                </div>
                <button className="ql-btn gold" style={{ marginTop: 10 }} disabled={busy} onClick={function() {
                  prepareClubTabCheckout({
                    customer_id: clubTabDetail.customer.customer_id,
                    name: clubTabDetail.customer.name,
                    phone: clubTabDetail.customer.phone,
                  });
                }}>Prepare Checkout • {money(clubTabDetail.current_due_inr)}</button>
              </div>
            ) : Number(clubTabDetail.current_due_inr || 0) > 0.009 ? (
              <div className="ql-line">
                <div className="ql-space">
                  <div>
                    <strong>FINAL CLUB TAB BALANCE</strong>
                    <div className="ql-muted">Payment is allocated oldest-bill-first without rewriting old bills.</div>
                  </div>
                  <strong style={{ fontSize: 24 }}>{money(clubTabDetail.current_due_inr)}</strong>
                </div>

                <div className="ql-form-grid" style={{ marginTop: 12 }}>
                  <label>
                    <span className="ql-label">Cash / static QR</span>
                    <select className="ql-select" value={clubCheckoutMethod} onChange={function(event) { setClubCheckoutMethod(event.target.value); }}>
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI — shop/static QR</option>
                    </select>
                  </label>
                  <label>
                    <span className="ql-label">Amount actually received</span>
                    <input className="ql-input" type="number" min="0" step="0.01" value={clubCheckoutAmount} onChange={function(event) { setClubCheckoutAmount(event.target.value); }} />
                  </label>
                </div>
                <div className="ql-row" style={{ marginTop: 10 }}>
                  <button className="ql-btn primary" disabled={busy} onClick={payClubTabManual}>
                    {Number(clubCheckoutAmount || 0) + 0.009 >= Number(clubTabDetail.current_due_inr || 0) ? "Pay & Close Tab" : "Record Partial Payment"}
                  </button>
                  <span className="ql-muted">Overpayment becomes player credit. A short payment remains due instead of silently closing the tab.</span>
                </div>

                <div className="ql-section">Online • Cashfree dynamic QR</div>
                <div className="ql-form-grid">
                  <label className="full">
                    <span className="ql-label">Customer mobile</span>
                    <input className="ql-input" inputMode="numeric" value={clubCheckoutPhone} onChange={function(event) { setClubCheckoutPhone(event.target.value.replace(/\D/g,"").slice(0,10)); }} placeholder="10-digit mobile number" />
                  </label>
                </div>
                <button className="ql-btn gold" style={{ marginTop: 10 }} disabled={busy} onClick={createClubTabOnline}>Generate Cashfree QR • {money(clubTabDetail.current_due_inr)}</button>
              </div>
            ) : (
              <div className="ql-line">
                <strong>✓ CLUB TAB SETTLED</strong>
                <div className="ql-muted" style={{ marginTop: 4 }}>
                  No amount is currently due. This final statement stays visible until staff closes it. If the player is still active on a table, the Club Tab remains available for new charges; otherwise it drops from Open Club Tabs after refresh.
                </div>
                {(clubTabDetail.settlements || [])[0] ? (
                  <div className="ql-line" style={{ marginTop: 10 }}>
                    <div className="ql-space">
                      <div>
                        <strong>{clubTabDetail.settlements[0].settlement_no}</strong>
                        <div className="ql-muted">{clubTabDetail.settlements[0].method} • {clubTabDetail.settlements[0].status} • {dateTime(clubTabDetail.settlements[0].verified_at || clubTabDetail.settlements[0].created_at)}</div>
                      </div>
                      <strong>{money(clubTabDetail.settlements[0].amount_inr)}</strong>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="ql-btn ghost" onClick={function() { setClubTabDetail(null); }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {tableViewSession && tableViewDetail && tableViewTable ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setTableViewSessionId(""); }}>
          <div className="ql-modal" style={{ maxWidth: 1120 }}>
            <div className="ql-space">
              <div>
                <h3 style={{ margin: 0 }}>Table {tableViewTable.table_no} — {tableViewTable.display_name}</h3>
                <div className="ql-muted">{String(tableViewTable.table_type || "").replaceAll("_"," ")} • {tableViewSession.status}</div>
              </div>
              <button className="ql-btn ghost" aria-label="Close table popup" onClick={function() { setTableViewSessionId(""); }}>✕</button>
            </div>

            <div className="ql-row" style={{ marginTop: 12 }}>
              <span className="ql-badge">{(tableViewRule && tableViewRule.display_name) || tableViewSession.game_type}</span>
              {tableViewSession.account_mode === "INDIVIDUAL" ? <span className="ql-badge gold">{tableViewSession.match_format || "FLEX"} • {String(tableViewSession.payment_rule || "").replaceAll("_"," ")}</span> : null}
              <span className={"ql-table-status " + (tableViewSession.status === "PAUSED" ? "pause" : "busy")}>{tableViewSession.status}</span>
            </div>

            {tableViewSession.payment_rule === "HOURLY_SHARED" ? (() => {
              const people = tableViewDetail.people || [];
              const activeCount = people.filter(function(person) { return person.status === "ACTIVE"; }).length;
              return (
                <div className="ql-line" style={{ marginTop: 12 }}>
                  <strong>Hourly Shared</strong>
                  <div className="ql-muted">Table {money(tableViewSession.shared_hourly_rate_inr)}/hr • {activeCount} active player{activeCount === 1 ? "" : "s"} • current slice ≈ {money(sharedHourlyLiveShare(tableViewSession, people))} each.</div>
                </div>
              );
            })() : null}

            {tableViewSession.game_type === "NORMAL_SNOOKER" && tableViewSession.payment_rule === "LOSER_PAYS" ? (
              <div className="ql-line" style={{ marginTop: 12 }}>
                <div className="ql-space">
                  <div><strong>FRAME TIMER • {clockLabel(currentLoserPaysFrameSeconds(tableViewDetail, liveClock))}</strong><div className="ql-muted">Paused time is excluded. Tap Complete Frame and select the winner.</div></div>
                  <div style={{ textAlign: "right" }}><div className="ql-muted">Member {money(tableViewTable.member_price_per_hour_inr)}/hr</div><div className="ql-muted">Walk-in {money(tableViewTable.price_per_hour_inr)}/hr</div></div>
                </div>
              </div>
            ) : null}

            {tableViewSession.account_mode === "INDIVIDUAL" ? (
              <>
                <div className="ql-section">Players</div>
                <div className="ql-player-grid">
                  {(tableViewDetail.people || []).map(function(person) {
                    return (
                      <div className="ql-player-card" key={person.person_id}>
                        <div className="ql-space">
                          <div style={{ minWidth: 0 }}>
                            <strong>{person.name}</strong>
                            <div className="ql-row" style={{ marginTop: 6 }}>
                              {person.team_no ? <span className="ql-badge">TEAM {person.team_no}</span> : null}
                              <span className={"ql-badge " + (person.is_member ? "gold" : "")}>{person.is_member ? "MEMBER" : "WALK-IN"}</span>
                              <span className={"ql-badge " + (person.status === "ACTIVE" ? "good" : person.status === "SETTLED" ? "gold" : "")}>{person.status}</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <strong>{money(person.current_due_inr)}</strong>
                            <div className="ql-muted">due</div>
                          </div>
                        </div>

                        <div className="ql-muted" style={{ marginTop: 10 }}>
                          Game {money(person.game_charges_inr)} • F&B {money(person.fnb_charges_inr)} • Table {money(person.table_charges_inr)}
                        </div>
                        {tableViewSession.payment_rule === "HOURLY_SHARED" && person.status === "ACTIVE" ? (
                          <div className="ql-muted" style={{ marginTop: 4 }}>Live shared slice ≈ {money(sharedHourlyLiveShare(tableViewSession, tableViewDetail.people || []))}</div>
                        ) : null}

                        <div className="ql-row" style={{ marginTop: 10 }}>
                          <button className="ql-btn" onClick={function() {
                            setTableViewSessionId("");
                            setPlayerAccountView({ sessionId: tableViewSession.session_id, personId: person.person_id });
                          }}>View</button>
                          <button className="ql-btn" onClick={function() {
                            setTableViewSessionId("");
                            setSelectedSessionId(tableViewSession.session_id);
                            setSelectedFnbPersonId(person.person_id);
                            setTab("fnb");
                          }}>+ F&B</button>
                          <button className="ql-btn" onClick={function() { editSessionPerson(tableViewSession, person); }}>Edit</button>
                        </div>
                        <div className="ql-row" style={{ marginTop: 8 }}>
                          {person.status === "ACTIVE" ? (
                            <button className="ql-btn" onClick={function() { setPersonPresence(tableViewSession, person, "LEAVE"); }}>Leave Table • Keep Club Tab</button>
                          ) : (
                            <button className="ql-btn" onClick={function() { setPersonPresence(tableViewSession, person, "REJOIN"); }}>Rejoin</button>
                          )}
                          {Number(person.current_due_inr || 0) > 0 ? (
                            <button className="ql-btn primary" onClick={function() {
                              setTableViewSessionId("");
                              finalizePerson(tableViewSession, person);
                            }}>Pay {money(person.current_due_inr)}</button>
                          ) : <span className="ql-badge good">PAID UP</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="ql-row" style={{ justifyContent: "space-between", marginTop: 16 }}>
                  <div className="ql-row">
                    <button className="ql-btn" onClick={function() { joinPlayer(tableViewSession); }}>+ Join Player</button>
                    {tableViewSession.payment_rule !== "HOURLY" && tableViewSession.status !== "ENDED" ? (
                      <button className="ql-btn gold" onClick={function() {
                        setTableViewSessionId("");
                        openGameEntry(tableViewSession);
                      }}>{tableViewSession.game_type === "QCHASE_RUMMY" && tableViewSession.payment_rule === "PER_PLAYER" ? "₹ Start Next Game" : tableViewSession.game_type === "NORMAL_SNOOKER" && tableViewSession.payment_rule === "LOSER_PAYS" ? "✓ Complete Frame" : "✓ Complete Frame/Game"}</button>
                    ) : null}
                    {tableViewSession.payment_rule === "HOURLY" ? <button className="ql-btn gold" onClick={function() { allocateHourly(tableViewSession); }}>Allocate Table Charge</button> : null}
                  </div>
                  <div className="ql-row">
                    {tableViewSession.status === "ACTIVE" && ((tableViewRule && tableViewRule.timer_required) || tableViewSession.payment_rule === "HOURLY_SHARED") ? <button className="ql-btn" onClick={function() { patchSession(tableViewSession.session_id, "PAUSE"); }}>Pause</button> : null}
                    {tableViewSession.status === "PAUSED" ? <button className="ql-btn" onClick={function() { patchSession(tableViewSession.session_id, "RESUME"); }}>Resume</button> : null}
                    <button className="ql-btn danger" onClick={function() { patchSession(tableViewSession.session_id, "END"); }}>
                      {["HOURLY","HOURLY_SHARED"].includes(tableViewSession.payment_rule) ? "End Table • Free Table" : "End Game • Free Table"}
                    </button>
                    <button className="ql-btn ghost" onClick={function() { setTableViewSessionId(""); }}>Close Popup</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="ql-section">Customer</div>
                <div className="ql-line">
                  <strong>{tableViewSession.customer_name || "Guest"}</strong>
                  <div className="ql-muted">{tableViewSession.customer_phone || "No phone"} • {elapsedLabel(tableViewSession)}</div>
                </div>
                <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
                  {tableViewRule && tableViewRule.billing_mode === "PER_PLAYER_PER_GAME" && tableViewSession.status !== "ENDED" ? <button className="ql-btn gold" onClick={function() { setTableViewSessionId(""); openGameEntry(tableViewSession); }}>✓ Game Complete</button> : null}
                  {tableViewSession.status === "ACTIVE" && tableViewRule && tableViewRule.timer_required ? <button className="ql-btn" onClick={function() { patchSession(tableViewSession.session_id, "PAUSE"); }}>Pause</button> : null}
                  {tableViewSession.status === "PAUSED" ? <button className="ql-btn" onClick={function() { patchSession(tableViewSession.session_id, "RESUME"); }}>Resume</button> : null}
                  <button className="ql-btn" onClick={function() { setTableViewSessionId(""); setSelectedSessionId(tableViewSession.session_id); setSelectedFnbPersonId(""); setTab("fnb"); }}>+ F&B</button>
                  <button className="ql-btn primary" onClick={function() { setTableViewSessionId(""); finalizeBill(tableViewSession); }}>Settle & Pay</button>
                  <button className="ql-btn ghost" onClick={function() { setTableViewSessionId(""); }}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {startTable ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setStartTable(null); }}>
          <div className="ql-modal" style={{ maxWidth: 820 }}>
            <div className="ql-space">
              <div><h3 style={{ margin: 0 }}>Start Table {startTable.table_no} — {startTable.display_name}</h3><div className="ql-muted">Individual player accounts • up to 6 players</div></div>
              <button className="ql-btn ghost" aria-label="Close popup" onClick={function() { setStartTable(null); }}>✕</button>
            </div>

            <div className="ql-form-grid" style={{ marginTop: 15 }}>
              <div className="full">
                <label className="ql-label">Game / Format</label>
                <select className="ql-select" value={startForm.gameType} onChange={function(e) { changeStartGame(e.target.value); }}>
                  {allowedGames(startTable, rules).map(function(rule) {
                    return <option value={rule.game_type} key={rule.game_type}>{rule.display_name}{rule.billing_mode === "PER_PLAYER_PER_GAME" ? " — " + money(rule.rate_inr) + "/player/game" : ""}</option>;
                  })}
                </select>
              </div>

              {startForm.gameType !== "QCHASE_RUMMY" && startForm.gameType !== "KITTY" ? (
                <>
                  <div>
                    <label className="ql-label">Match format</label>
                    <select className="ql-select" value={startForm.matchFormat} onChange={function(e) { changeMatchFormat(e.target.value); }}>
                      {(startForm.gameType === "NORMAL_SNOOKER" || startForm.gameType === "NORMAL_POOL") && startForm.paymentRule === "HOURLY" ? <option value="FLEX">Flexible players</option> : null}
                      {startForm.gameType !== "NORMAL_POOL" ? <option value="SINGLES">Singles — 2 players</option> : null}
                      {startForm.gameType !== "NORMAL_POOL" ? <option value="DOUBLES">Doubles — 2 vs 2</option> : null}
                    </select>
                  </div>
                  <div>
                    <label className="ql-label">Billing rule</label>
                    <select className="ql-select" value={startForm.paymentRule} onChange={function(e) {
                      const rule = e.target.value;
                      const next = { ...startForm, paymentRule: rule };
                      if (startForm.gameType === "NORMAL_SNOOKER" && rule === "HOURLY") {
                        next.matchFormat = "FLEX";
                      } else if (next.matchFormat === "FLEX") {
                        next.matchFormat = "SINGLES";
                        next.players = (startForm.players || []).slice(0, 2);
                        while (next.players.length < 2) next.players.push({ name: "", phone: "", teamNo: null });
                      }
                      setStartForm(next);
                    }}>
                      {startForm.gameType === "NORMAL_SNOOKER" || startForm.gameType === "NORMAL_POOL" ? <option value="HOURLY">Hourly table charge</option> : <option value="PER_PLAYER">Normal — each player pays own share</option>}
                      {startForm.gameType !== "NORMAL_POOL" ? <option value="LOSER_PAYS">{startForm.gameType === "NORMAL_SNOOKER" ? "Loser pays by frame time" : "Loser pays the game"}</option> : null}
                    </select>
                  </div>
                </>
              ) : startForm.gameType === "QCHASE_RUMMY" ? (
                <div className="full ql-line">
                  <strong>QChase / Rummy</strong>
                  <div className="ql-form-grid" style={{ marginTop: 10 }}>
                    <label>
                      <span className="ql-label">Billing mode</span>
                      <select
                        className="ql-select"
                        value={startForm.paymentRule}
                        onChange={function(e) { setStartForm({ ...startForm, matchFormat: "FLEX", paymentRule: e.target.value }); }}
                      >
                        <option value="PER_PLAYER">Per Game — ₹100/player/game</option>
                        <option value="HOURLY_SHARED">Hourly Shared — split table time among active players</option>
                      </select>
                    </label>
                    <div>
                      <span className="ql-label">How it works</span>
                      <div className="ql-muted" style={{ paddingTop: 8 }}>
                        {startForm.paymentRule === "HOURLY_SHARED"
                          ? "The table hourly charge is split equally among the players currently playing. Leaving freezes that player’s share; remaining players continue sharing automatically. Completed QChase/Rummy games are recorded with no ₹100 game charge."
                          : "Each completed game charges ₹100 only to the players who actually played that game."}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="full ql-line"><strong>Kitty</strong><div className="ql-muted">2–6 individual players. No singles/doubles and no shared billing rule. The game runs on time: Liberwin/Wiraka ₹600/hr; Mini Snooker ₹500/hr. Only the winner is charged, minimum ₹100, rounded to the nearest ₹10. If there is no winner, that game time carries forward until a later game produces a winner.</div></div>
              )}

              {startForm.gameType === "NORMAL_SNOOKER" && startForm.paymentRule === "LOSER_PAYS" ? (
                <div className="full ql-line">
                  <strong>Loser pays actual frame time</strong>
                  <div className="ql-muted" style={{ marginTop: 5 }}>
                    Tap the winner when the frame ends. The other player/team is marked as loser automatically.
                    Paused time is excluded. Verified members use {money(startTable && startTable.member_price_per_hour_inr)}/hr;
                    non-members use {money(startTable && startTable.price_per_hour_inr)}/hr.
                  </div>
                </div>
              ) : null}

              <div className="full ql-section">Players</div>
              {(startForm.players || []).map(function(player, index) {
                const teamNo = startForm.matchFormat === "DOUBLES" ? (index < 2 ? 1 : 2) : null;
                return (
                  <div className="full ql-line" key={index}>
                    <div className="ql-space">
                      <strong>{teamNo ? "Team " + teamNo + " — " : ""}Player {index + 1}</strong>
                      {startForm.matchFormat === "FLEX" && (startForm.players || []).length > 1 ? <button className="ql-btn danger" type="button" onClick={function() { removeStartPlayer(index); }}>Remove</button> : null}
                    </div>
                    <div className="ql-form-grid" style={{ marginTop: 8 }}>
                      <label>
                        <span className="ql-label">Name</span>
                        <input className="ql-input" value={player.name} onChange={function(e) { updateStartPlayer(index, "name", e.target.value); }} placeholder="Type regular player name" autoComplete="off" />
                        {renderCustomerMatches(player.name, function(customer) { applyCustomerToStartPlayer(index, customer); })}
                      </label>
                      <label><span className="ql-label">Mobile (optional)</span><input className="ql-input" inputMode="numeric" value={player.phone} onChange={function(e) { updateStartPlayer(index, "phone", e.target.value.replace(/\D/g,"").slice(0,10)); }} placeholder="For UPI / receipt" /></label>
                    </div>
                    <div className="ql-row" style={{ marginTop: 8 }}>
                      <span className={"ql-badge " + (player.isMember ? "gold" : "")}>{player.isMember ? "MEMBER RATE" : "WALK-IN RATE"}</span>
                      <button type="button" className="ql-btn" disabled={busy} onClick={function() { verifyStartMember(index); }}>Verify Member</button>
                    </div>
                  </div>
                );
              })}
              {startForm.matchFormat === "FLEX" && (startForm.players || []).length < 6 ? <div className="full"><button className="ql-btn" type="button" onClick={addStartPlayer}>+ Add Player</button></div> : null}

              <div className="full ql-muted">
                Membership is verified per player. In Loser Pays, the losing player's own verified member rate is used. For ordinary hourly table billing, Player 1 remains the rate-holder for the table.
              </div>
            </div>
            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="ql-btn" onClick={function() { setStartTable(null); }}>Cancel</button>
              <button className="ql-btn primary" disabled={busy} onClick={createSession}>Save & Start Session</button>
            </div>
          </div>
        </div>
      ) : null}

      {playerAccountView && playerAccountPerson ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setPlayerAccountView(null); }}>
          <div className="ql-modal" style={{ maxWidth: 760 }}>
            <div className="ql-space">
              <div>
                <h3 style={{ margin: 0 }}>{playerAccountPerson.name} — Running Account</h3>
                <div className="ql-muted">
                  {playerAccountSession ? String(playerAccountSession.game_type || "").replaceAll("_", " ") : "Table session"}
                  {playerAccountPerson.team_no ? " • Team " + playerAccountPerson.team_no : ""}
                  {" • "}{playerAccountPerson.status}
                </div>
              </div>
              <button className="ql-btn ghost" aria-label="Close popup" onClick={function() { setPlayerAccountView(null); }}>✕</button>
            </div>

            <div className="ql-grid" style={{ marginTop: 14 }}>
              <div className="ql-card">
                <div className="ql-muted">CURRENT DUE</div>
                <strong className="ql-price">{money(playerAccountPerson.current_due_inr)}</strong>
                <div className="ql-muted">Unbilled {money(playerAccountPerson.unbilled_inr)} • Billed due {money(playerAccountPerson.billed_due_inr)}</div>
              </div>
              <div className="ql-card">
                <div className="ql-muted">SESSION TOTALS</div>
                <strong>Game {money(playerAccountPerson.game_charges_inr)}</strong>
                <div className="ql-muted">F&B {money(playerAccountPerson.fnb_charges_inr)} • Table {money(playerAccountPerson.table_charges_inr)}</div>
              </div>
            </div>

            <div className="ql-section">Account activity</div>
            <div className="ql-list">
              {(playerAccountPerson.account_entries || []).length ? (playerAccountPerson.account_entries || []).slice().reverse().map(function(entry) {
                return (
                  <div className="ql-line" key={entry.charge_id}>
                    <div className="ql-space">
                      <div>
                        <strong>{entry.description}</strong>
                        <div className="ql-muted">
                          {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                          {" • "}{String(entry.charge_type || "").replaceAll("_", " ")}
                          {entry.bill_no ? " • " + entry.bill_no : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong>{money(entry.amount_inr)}</strong>
                        <div><span className={"ql-badge " + (entry.settlement_status === "PAID" ? "good" : entry.settlement_status === "BILLED" ? "gold" : "")}>{entry.settlement_status}</span></div>
                      </div>
                    </div>
                  </div>
                );
              }) : <div className="ql-empty">No charges yet.</div>}
            </div>

            {(playerAccountPerson.bills || []).length ? (
              <>
                <div className="ql-section">Bills / settlements</div>
                <div className="ql-list">
                  {(playerAccountPerson.bills || []).slice().reverse().map(function(bill) {
                    return (
                      <div className="ql-line ql-space" key={bill.bill_id}>
                        <div>
                          <strong>{bill.bill_no}</strong>
                          <div className="ql-muted">{bill.status} • Paid {money(bill.paid_inr)} • Due {money(bill.due_inr)}</div>
                        </div>
                        <button className="ql-btn" onClick={async function() {
                          await loadBill(bill.bill_id);
                          setPlayerAccountView(null);
                          setTab("ledger");
                        }}>Open Bill</button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            <div className="ql-line" style={{ marginTop: 14 }}>
              <strong>Pay-and-continue</strong>
              <div className="ql-muted">Paying this account settles money only. The player remains ACTIVE and can continue playing and ordering until staff taps Leave Game/Table or the table is closed.</div>
            </div>

            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="ql-btn" onClick={function() { setSelectedSessionId(playerAccountView.sessionId); setSelectedFnbPersonId(playerAccountView.personId); setPlayerAccountView(null); setTab("fnb"); }}>+ F&B</button>
              {Number(playerAccountPerson.current_due_inr || 0) > 0 ? (
                <button className="ql-btn primary" onClick={function() {
                  const session = sessions.find(function(row) { return row.session_id === playerAccountView.sessionId; });
                  setPlayerAccountView(null);
                  if (session) finalizePerson(session, playerAccountPerson);
                }}>Pay {money(playerAccountPerson.current_due_inr)}</button>
              ) : <span className="ql-badge good">PAID UP</span>}
              <button className="ql-btn ghost" onClick={function() { setPlayerAccountView(null); }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {gameEntry ? (
        <div className="ql-modal-bg" onMouseDown={function(event) { if (event.target === event.currentTarget) setGameEntry(null); }}>
          <div className="ql-modal" style={{ maxWidth: 720 }}>
            <div className="ql-space">
              <div>
                <h3 style={{ margin: 0 }}>{gameEntry.session.game_type === "QCHASE_RUMMY" && gameEntry.session.payment_rule === "PER_PLAYER" ? "Start Next QChase / Rummy Game" : "Complete Frame / Game"}</h3>
                <div className="ql-muted">{String(gameEntry.session.game_type || "").replaceAll("_"," ")} • {String(gameEntry.session.payment_rule || "").replaceAll("_"," ")}</div>
              </div>
              <button className="ql-btn ghost" aria-label="Close popup" onClick={function() { setGameEntry(null); }}>✕</button>
            </div>

            <div className="ql-section">{gameEntry.session.game_type === "QCHASE_RUMMY" && gameEntry.session.payment_rule === "PER_PLAYER" ? "Who is starting this game?" : "Who played this game?"}</div>
            {gameEntry.session.game_type === "QCHASE_RUMMY" && gameEntry.session.payment_rule === "PER_PLAYER" ? (
              <div className="ql-line" style={{ marginBottom: 10 }}>
                <strong>Charge first, then play.</strong>
                <div className="ql-muted" style={{ marginTop: 4 }}>Each selected player is charged the per-player game rate now. The finish time does not affect the charge. A player who joins later is charged immediately on joining.</div>
              </div>
            ) : null}
            <div className="ql-list">
              {(gameEntry.people || []).map(function(person) {
                const checked = (gameEntry.selectedIds || []).includes(person.person_id);
                return (
                  <label className="ql-line ql-space" key={person.person_id}>
                    <span><strong>{person.name}</strong>{person.team_no ? " • Team " + person.team_no : ""}</span>
                    <input type="checkbox" checked={checked} onChange={function(e) {
                      const ids = e.target.checked ? [...gameEntry.selectedIds, person.person_id] : gameEntry.selectedIds.filter(function(id) { return id !== person.person_id; });
                      setGameEntry({ ...gameEntry, selectedIds: ids });
                    }} />
                  </label>
                );
              })}
            </div>

            {gameEntry.session.payment_rule === "LOSER_PAYS" ? (
              <>
                <div className="ql-section">Who won?</div>
                {gameEntry.session.match_format === "DOUBLES" ? (
                  <div className="ql-row">
                    <button className={"ql-btn " + (gameEntry.winningTeam === "1" ? "primary" : "")} onClick={function() { setGameEntry({ ...gameEntry, winningTeam: "1", payerPersonId: "" }); }}>✓ TEAM 1 WON</button>
                    <button className={"ql-btn " + (gameEntry.winningTeam === "2" ? "primary" : "")} onClick={function() { setGameEntry({ ...gameEntry, winningTeam: "2", payerPersonId: "" }); }}>✓ TEAM 2 WON</button>
                  </div>
                ) : (
                  <div className="ql-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {(gameEntry.people || []).filter(function(p) { return gameEntry.selectedIds.includes(p.person_id); }).map(function(person) {
                      const active = gameEntry.winnerPersonId === person.person_id;
                      return (
                        <button
                          key={person.person_id}
                          type="button"
                          className={"ql-btn " + (active ? "primary" : "")}
                          onClick={function() { setGameEntry({ ...gameEntry, winnerPersonId: person.person_id, payerPersonId: "" }); }}
                        >
                          ✓ {person.name} WON
                        </button>
                      );
                    })}
                  </div>
                )}

                {gameEntry.session.game_type === "NORMAL_SNOOKER" ? (() => {
                  const detail = sessionDetails[gameEntry.session.session_id] || gameEntry.session;
                  const frameSeconds = currentLoserPaysFrameSeconds(detail, liveClock);
                  const table = tables.find(function(row) { return row.table_id === gameEntry.session.table_id; }) || {};
                  let losingPeople = [];
                  if (gameEntry.session.match_format === "DOUBLES" && gameEntry.winningTeam) {
                    const losingTeam = String(gameEntry.winningTeam) === "1" ? "2" : "1";
                    losingPeople = (gameEntry.people || []).filter(function(person) { return String(person.team_no) === losingTeam && gameEntry.selectedIds.includes(person.person_id); });
                  } else if (gameEntry.winnerPersonId) {
                    losingPeople = (gameEntry.people || []).filter(function(person) { return gameEntry.selectedIds.includes(person.person_id) && person.person_id !== gameEntry.winnerPersonId; });
                  }
                  const needsPayer = gameEntry.session.match_format === "DOUBLES" && gameEntry.payerMode === "ONE";
                  const estimated = needsPayer && !gameEntry.payerPersonId ? 0 : losingPeople.reduce(function(sum, person) {
                    const rate = Number(person.is_member ? table.member_price_per_hour_inr : table.price_per_hour_inr);
                    const fraction = gameEntry.session.match_format === "DOUBLES" && gameEntry.payerMode !== "ONE" ? 0.5 : 1;
                    if (gameEntry.payerMode === "ONE" && person.person_id !== gameEntry.payerPersonId) return sum;
                    return sum + (frameSeconds / 3600) * rate * fraction;
                  }, 0);
                  const estimateLabel = !losingPeople.length
                    ? "Tap winner"
                    : (needsPayer && !gameEntry.payerPersonId ? "Select payer" : "≈ " + money(estimated));
                  return (
                    <div className="ql-line" style={{ marginTop: 12 }}>
                      <div className="ql-space">
                        <div><strong>Frame time {clockLabel(frameSeconds)}</strong><div className="ql-muted">Paused time excluded • server recalculates before posting.</div></div>
                        <strong>{estimateLabel}</strong>
                      </div>
                    </div>
                  );
                })() : null}

                {gameEntry.session.match_format === "DOUBLES" ? (
                  <>
                    <div className="ql-section">Losing-team payment</div>
                    <div className="ql-row">
                      <button className={"ql-btn " + (gameEntry.payerMode === "SPLIT" ? "primary" : "")} onClick={function() { setGameEntry({ ...gameEntry, payerMode: "SPLIT", payerPersonId: "" }); }}>Split between losing players</button>
                      <button className={"ql-btn " + (gameEntry.payerMode === "ONE" ? "primary" : "")} onClick={function() { setGameEntry({ ...gameEntry, payerMode: "ONE" }); }}>One losing player pays all</button>
                    </div>
                    {gameEntry.payerMode === "ONE" && gameEntry.winningTeam ? (
                      <select className="ql-select" style={{ marginTop: 8 }} value={gameEntry.payerPersonId} onChange={function(e) { setGameEntry({ ...gameEntry, payerPersonId: e.target.value }); }}>
                        <option value="">Select payer</option>
                        {(gameEntry.people || []).filter(function(person) {
                          const losingTeam = String(gameEntry.winningTeam) === "1" ? "2" : "1";
                          return String(person.team_no) === losingTeam;
                        }).map(function(person) { return <option key={person.person_id} value={person.person_id}>{person.name} • {person.is_member ? "Member rate" : "Walk-in rate"}</option>; })}
                      </select>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            <div className="ql-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="ql-btn" onClick={function() { setGameEntry(null); }}>Cancel</button>
              <button className="ql-btn primary" disabled={busy} onClick={submitGameEntry}>{gameEntry.session.game_type === "QCHASE_RUMMY" && gameEntry.session.payment_rule === "PER_PLAYER" ? "Charge & Start Game" : "Confirm Completed Game"}</button>
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
              <button className="ql-btn ghost" aria-label="Close popup" onClick={function() { setShowUpiQrModal(false); }}>✕</button>
            </div>

            <div className="ql-pay-amount">{money(upiOrder.amount_inr)}</div>
            <div className="ql-muted">
              {upiOrder.scope === "CLUB_TAB" ? ((clubTabDetail && clubTabDetail.customer && clubTabDetail.customer.name) ? clubTabDetail.customer.name + " • CLUB TAB" : "CLUB TAB") : ((billDetail && billDetail.bill_no) ? billDetail.bill_no : "Bill")} • Cashfree
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
