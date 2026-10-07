import {websiteStateTransport} from './security/website-state.js';
import {SecurityError as WebsiteSecurityError} from './security/errors.js';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicContent as cmsPublicContent, saveContent as saveCmsContent } from "./security/foundation.js";
import { cancelStaffShift, clockStaffAttendance, createStaffExpense, createStaffShift, staffOpsSnapshot, voidStaffExpense } from "./security/staff-operations.js";

const API_VERSION = "snooker-v1";
const CURRENCY = "INR";
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2022-09-01";

function env(name = "") {
  return String(process.env[name] || "").trim();
}

function safeText(value = "", max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(value) {
  return Math.round((number(value, 0) + Number.EPSILON) * 100) / 100;
}

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function getSupabaseAdmin() {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("QCLUB_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Snooker backend requires Supabase service-role credentials");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function normalizeWhatsappPhone(value = "") {
  const phone = normalizePhone(value);
  return phone ? `91${phone}` : "";
}

function bearer(req) {
  const raw = safeText(req.headers?.authorization || req.headers?.Authorization || "", 400);
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
}

function hashToken(token = "") {
  return createHash("sha256").update(token).digest("hex");
}

function secureEqual(a = "", b = "") {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

async function authenticate(req, roles = ["STAFF", "ADMIN"]) {
  const token = bearer(req);
  if (!token) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("snooker_auth_sessions")
    .select("*")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data || !roles.includes(data.role)) return null;
  return data;
}

async function requireAuth(req, res, roles = ["STAFF", "ADMIN"]) {
  const auth = await authenticate(req, roles);
  if (!auth) {
    json(res, 401, { ok: false, error: "AUTH_REQUIRED", message: "Valid staff login required." });
    return null;
  }
  return auth;
}

async function legacyAdminConfig(supabase) {
  const { data, error } = await supabase
    .from("qclub_state")
    .select("state")
    .eq("key", "main")
    .maybeSingle();
  if (error) throw error;
  return data?.state?.admin || {};
}

async function login(req, res) {
  const pin = safeText(req.body?.pin || "", 100);
  if (!pin) return json(res, 400, { ok: false, error: "PIN_REQUIRED" });

  const supabase = getSupabaseAdmin();
  const deviceId = safeText(req.body?.device_id || "", 200);
  const forwarded = safeText(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "", 300)
    .split(",")[0].trim();
  if (!forwarded) return json(res, 503, { ok: false, error: "LOGIN_UNAVAILABLE" });
  const networkHash = hashToken("ip:" + forwarded);

  const { data: verified, error: verifyError } = await supabase.rpc("qclub_security_login_pin", {
    p_network_hash: networkHash,
    p_pin: pin,
  });
  if (verifyError) return json(res, 503, { ok: false, error: "LOGIN_UNAVAILABLE" });
  if (verified?.rate_limited) return json(res, 429, { ok: false, error: "LOGIN_RATE_LIMITED", retry_after_seconds: 900 });
  if (!verified?.ok) return json(res, 401, { ok: false, error: "INVALID_PIN" });

  const identities = {
    main: { role: "ADMIN", staffId: "admin-main", displayName: "Q Club Admin" },
    staff: { role: "STAFF", staffId: "staff-game-marshall", displayName: "Game Marshall" },
    committee: { role: "COMMITTEE", staffId: "admin-committee", displayName: "Committee Admin" },
  };
  const matched = identities[verified.credential_id];
  if (!matched) return json(res, 503, { ok: false, error: "LOGIN_UNAVAILABLE" });

  const rawToken = "snk_" + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
  const { data: stored, error: storeError } = await supabase.rpc("qclub_security_create_session", {
    p_credential_id: verified.credential_id,
    p_version: Number(verified.version),
    p_token_hash: hashToken(rawToken),
    p_expires_at: expiresAt,
    p_device_id: deviceId || null,
    p_client_version: safeText(req.body?.client_version || req.headers?.["x-qclub-client-version"] || "", 100) || null,
  });
  if (storeError || stored !== true) return json(res, 503, { ok: false, error: "LOGIN_UNAVAILABLE" });

  return json(res, 200, {
    access_token: rawToken,
    expires_at: expiresAt,
    role: matched.role,
    staff_id: matched.staffId,
    display_name: matched.displayName,
  });
}

async function logout(req, res) {
  const auth = await requireAuth(req, res, ["STAFF", "ADMIN", "COMMITTEE"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("snooker_auth_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", auth.id);
  if (error) throw error;
  return json(res, 200, { ok: true, revoked: true });
}

function indiaDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function indiaDayBounds(value = new Date()) {
  const day = indiaDateString(value);
  const [year, month, date] = day.split("-").map(Number);
  const startMs = Date.UTC(year, month - 1, date, 0, 0, 0) - (330 * 60_000);
  return {
    day,
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 60 * 60_000).toISOString(),
  };
}

function indiaMonthBounds(value = new Date()) {
  const day = indiaDateString(value);
  const [year, month, date] = day.split("-").map(Number);
  const startMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - (330 * 60_000);
  const nextMonthMs = Date.UTC(year, month, 1, 0, 0, 0) - (330 * 60_000);
  return {
    day,
    year,
    month,
    date,
    start: new Date(startMs).toISOString(),
    end: new Date(nextMonthMs).toISOString(),
  };
}

async function memberRegistry(supabase) {
  const { data, error } = await supabase
    .from("qclub_state")
    .select("state")
    .eq("key", "main")
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.state?.memberRegistry) ? data.state.memberRegistry : [];
}

async function legacyOperationalState(supabase) {
  const { data, error } = await supabase
    .from("qclub_state")
    .select("state, updated_at")
    .eq("key", "main")
    .maybeSingle();
  if (error) throw error;
  return {
    state: data?.state && typeof data.state === "object" ? data.state : {},
    updatedAt: data?.updated_at || null,
  };
}

function operationalItems(items) {
  return Array.isArray(items)
    ? items.slice(0, 100).map((item) => ({
        id: safeText(item?.id || item?.itemId || "", 160) || null,
        name: safeText(item?.name || item?.displayName || "", 220) || null,
        display_name: safeText(item?.displayName || item?.name || "", 220) || null,
        quantity: Math.max(0, number(item?.qty ?? item?.quantity, 0)),
        price_inr: money(item?.price || 0),
        line_total_inr: money(item?.lineTotal ?? (number(item?.price, 0) * number(item?.qty ?? item?.quantity, 0))),
      }))
    : [];
}

async function operationalInbox(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();

  const { data: records, error } = await supabase
    .from("qclub_operational_records")
    .select("record_type,record_key,payload,status,source,created_at,updated_at")
    .in("record_type", ["booking_request", "q_lounge_order", "qshop_receipt"])
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  const rows = Array.isArray(records) ? records : [];
  const bookingRows = rows.filter((row) => row.record_type === "booking_request");
  const foodRows = rows.filter((row) => row.record_type === "q_lounge_order");
  const shopRows = rows.filter((row) => row.record_type === "qshop_receipt");

  const bookings = bookingRows.slice(0, 100).map((record) => {
    const row = record?.payload || {};
    return {
      id: safeText(row?.id || record.record_key || "", 160) || null,
      gateway_order_id: safeText(row?.gatewayOrderId || "", 180) || null,
      customer_name: safeText(row?.name || row?.customerName || "", 160) || null,
      customer_phone: normalizePhone(row?.mobile || row?.customerMobile || "") || null,
      item_id: safeText(row?.itemId || "", 120) || null,
      item_label: safeText(row?.itemLabel || row?.tableLabel || "", 220) || null,
      booking_date: safeText(row?.bookingDate || "", 20) || null,
      time_slot: safeText(row?.timeSlot || "", 40) || null,
      slot_label: safeText(row?.slotLabel || "", 120) || null,
      duration_hours: number(row?.durationHours, 0),
      end_time: safeText(row?.endTime || "", 40) || null,
      amount_inr: money(row?.amount || row?.total || 0),
      payment_status: safeText(row?.paymentStatus || "", 80) || null,
      status: safeText(row?.status || record.status || "pending", 40).toUpperCase(),
      note: safeText(row?.note || "", 500) || null,
      created_at: row?.createdAt || record.created_at || null,
      updated_at: row?.updatedAt || record.updated_at || null,
      source: safeText(record.source || "", 80) || null,
    };
  });

  const foodOrders = foodRows.slice(0, 100).map((record) => {
    const row = record?.payload || {};
    return {
      id: safeText(row?.id || row?.orderNo || record.record_key || "", 160) || null,
      order_no: safeText(row?.orderNo || row?.id || record.record_key || "", 160) || null,
      gateway_order_id: safeText(row?.gatewayOrderId || "", 180) || null,
      customer_name: safeText(row?.customerName || row?.name || "", 160) || null,
      customer_phone: normalizePhone(row?.customerMobile || row?.mobile || "") || null,
      table_label: safeText(row?.tableLabel || "", 120) || null,
      total_inr: money(row?.total || 0),
      payment_status: safeText(row?.paymentStatus || row?.status || record.status || "", 80) || null,
      print_status: safeText(row?.printStatus || row?.printMeta?.status || "", 80) || null,
      created_at: row?.createdAt || row?.time || record.created_at || null,
      items: operationalItems(row?.items),
      source: safeText(record.source || "", 80) || null,
    };
  });

  const shopReceipts = shopRows.slice(0, 100).map((record) => {
    const row = record?.payload || {};
    return {
      id: safeText(row?.id || row?.receiptId || row?.orderNo || record.record_key || "", 160) || null,
      order_no: safeText(row?.orderNo || row?.id || record.record_key || "", 160) || null,
      gateway_order_id: safeText(row?.gatewayOrderId || "", 180) || null,
      customer_name: safeText(row?.customerName || row?.name || "", 160) || null,
      customer_phone: normalizePhone(row?.customerMobile || row?.mobile || "") || null,
      total_inr: money(row?.total || 0),
      payment_status: safeText(row?.paymentStatus || record.status || "", 80) || null,
      pickup_status: safeText(row?.pickupStatus || "", 80) || null,
      created_at: row?.createdAt || record.created_at || null,
      updated_at: row?.updatedAt || record.updated_at || null,
      items: operationalItems(row?.items),
      source: safeText(record.source || "", 80) || null,
    };
  });

  return json(res, 200, {
    source: "qclub_operational_records",
    updated_at: rows[0]?.updated_at || null,
    counts: {
      bookings: bookings.length,
      food_orders: foodOrders.length,
      shop_receipts: shopReceipts.length,
    },
    bookings,
    food_orders: foodOrders,
    shop_receipts: shopReceipts,
  });
}

async function verifyMemberRecord(supabase, { phone = "", name = "" } = {}) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedName = safeText(name, 160).toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalizedPhone && !normalizedName) return { verified: false, reason: "MEMBER_IDENTITY_REQUIRED", member: null };

  const registry = await memberRegistry(supabase);
  const member = registry.find((entry) => {
    const entryPhone = normalizePhone(entry?.mobile || entry?.phone || "");
    const entryName = safeText(entry?.name || entry?.full_name || "", 160).toLowerCase().replace(/\s+/g, " ").trim();
    if (normalizedPhone && entryPhone) return normalizedPhone === entryPhone;
    return Boolean(normalizedName && entryName && normalizedName === entryName);
  }) || null;

  if (!member) return { verified: false, reason: "MEMBER_NOT_FOUND", member: null };
  const status = safeText(member.status || "active", 40).toLowerCase();
  const validUntil = safeText(member.validUntil || member.valid_until || "", 20);
  const validFrom = safeText(member.validFrom || member.valid_from || member.joinedOn || "", 20);
  const today = indiaDateString();
  const active = status === "active" && (!validFrom || validFrom <= today) && (!validUntil || validUntil >= today);
  return {
    verified: active,
    reason: active ? null : "MEMBERSHIP_INACTIVE_OR_EXPIRED",
    member: {
      id: safeText(member.id || member.member_number || "", 100) || null,
      name: safeText(member.name || member.full_name || "", 160) || null,
      mobile: normalizePhone(member.mobile || member.phone || "") || null,
      tier: safeText(member.tier || member.tier_name || "", 80) || null,
      status,
      valid_until: validUntil || null,
    },
  };
}

async function verifyMember(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const result = await verifyMemberRecord(getSupabaseAdmin(), {
    phone: req.query?.phone,
    name: req.query?.name,
  });
  return json(res, 200, result);
}

function paymentLinkSecret() {
  return env("QCLUB_PAYMENT_LINK_SECRET") || env("CASHFREE_SECRET_KEY");
}

function paymentLinkSignature(payment) {
  const secret = paymentLinkSecret();
  if (!secret || !payment) return "";
  return createHmac("sha256", secret)
    .update(`${payment.id}|${payment.bill_id}|${payment.expires_at || ""}`)
    .digest("base64url");
}

function paymentLinkUrl(payment) {
  const signature = paymentLinkSignature(payment);
  if (!signature) return "";
  const siteUrl = safeText(env("QCLUB_SITE_URL") || "https://www.theqclubpasighat.com", 240).replace(/\/$/, "");
  return `${siteUrl}/QclubPay?payment_id=${encodeURIComponent(payment.id)}&sig=${encodeURIComponent(signature)}`;
}

function qrElementUrl(payment) {
  const signature = paymentLinkSignature(payment);
  if (!signature) return "";
  const siteUrl = safeText(env("QCLUB_SITE_URL") || "https://www.theqclubpasighat.com", 240).replace(/\/$/, "");
  return `${siteUrl}/QclubQr?payment_id=${encodeURIComponent(payment.id)}&sig=${encodeURIComponent(signature)}`;
}

async function publicPaymentSession(req, res, paymentId) {
  const supabase = getSupabaseAdmin();
  const signature = safeText(req.query?.sig || "", 500);
  const { data } = await supabase.from("snooker_bill_payments").select("*").eq("id", paymentId).maybeSingle();
  if (!data || data.method !== "UPI" || !signature || !secureEqual(signature, paymentLinkSignature(data))) {
    return json(res, 404, { ok: false, error: "PAYMENT_LINK_NOT_FOUND" });
  }

  let payment = data;
  if (payment.status === "PENDING") payment = await syncCashfreePayment(supabase, payment);
  const expired = payment.expires_at && Date.parse(payment.expires_at) <= Date.now();
  if (expired && payment.status === "PENDING") {
    const { data: updated } = await supabase
      .from("snooker_bill_payments")
      .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
      .eq("id", payment.id)
      .select("*")
      .single();
    payment = updated || payment;
  }

  const { data: bill } = await supabase.from("snooker_bills").select("bill_no,status,due_inr").eq("id", payment.bill_id).maybeSingle();
  return json(res, 200, {
    ok: true,
    payment_id: payment.id,
    bill_no: bill?.bill_no || null,
    bill_status: bill?.status || null,
    amount_inr: money(payment.amount_inr),
    status: payment.status,
    expires_at: payment.expires_at,
    order_id: payment.cashfree_order_id,
    payment_session_id: payment.status === "PENDING" && !expired ? payment.payment_session_id : null,
  });
}


async function publicTableDisplay(req, res, tableKey) {
  const match = /^T([1-4])$/i.exec(safeText(tableKey || "", 10));
  if (!match) return json(res, 404, { ok: false, error: "TABLE_DISPLAY_NOT_FOUND" });
  const tableNo = Number(match[1]);
  const supabase = getSupabaseAdmin();
  const { data: table, error: tableError } = await supabase.from("snooker_tables").select("*").eq("table_no", tableNo).eq("active", true).maybeSingle();
  if (tableError) throw tableError;
  if (!table) return json(res, 404, { ok: false, error: "TABLE_NOT_FOUND" });

  const { data: session } = await supabase.from("snooker_sessions").select("*").eq("table_id", table.id).in("status", ["ACTIVE","PAUSED","ENDED"]).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const rules = [];
  if (table.table_type === "FULL_SIZE_SNOOKER") {
    rules.push(
      { title: "Normal Snooker", value: "Member ₹500/hr • Non-member ₹600/hr" },
      { title: "6-Ball Snooker", value: "₹100/player or ₹200/game" },
      { title: "10-Ball Snooker", value: "₹200/player" },
      { title: "15-Ball Snooker", value: "₹300/player or ₹600/game" },
      { title: "QChase / Rummy", value: "₹100 per game per player" },
      { title: "Kitty", value: "₹600/hr • winner pays • minimum ₹100" },
      { title: "Kitty carry", value: "No-winner time carries to the next game until a winner" }
    );
  } else if (table.table_type === "MINI_SNOOKER") {
    rules.push(
      { title: "Normal Mini Snooker", value: "Member ₹400/hr • Non-member ₹500/hr" },
      { title: "QChase / Rummy", value: "₹100 per game per player" },
      { title: "6-Ball Snooker", value: "₹100/player or ₹200/game" },
      { title: "10-Ball Snooker", value: "₹200/player" },
      { title: "Kitty", value: "₹500/hr • winner pays • minimum ₹100" },
      { title: "Kitty carry", value: "No-winner time carries to the next game until a winner" }
    );
  } else {
    rules.push({ title: "American Pool", value: "Member ₹300/hr • Non-member ₹400/hr" });
  }

  if (!session) return json(res, 200, { ok: true, state: "STANDBY", table: tableDto(table), standby_rules: rules });

  const [{ data: rule }, { data: fnb }, { data: games }] = await Promise.all([
    supabase.from("snooker_game_rules").select("*").eq("game_type", session.game_type).maybeSingle(),
    supabase.from("snooker_fnb_lines").select("line_total_inr,status").eq("session_id", session.id),
    supabase.from("snooker_completed_games").select("*").eq("session_id", session.id).eq("status","COMPLETED").order("completed_at"),
  ]);
  const fnbTotal = money((fnb || []).filter((x) => x.status !== "VOIDED").reduce((sum,x)=>sum+number(x.line_total_inr),0));
  const gameCharges = money((games || []).reduce((sum,x)=>sum+number(x.calculated_charge_inr),0));
  const rate = session.game_type === "KITTY"
    ? money(table.price_per_hour_inr)
    : money(session.is_member ? table.member_price_per_hour_inr : table.price_per_hour_inr);

  let kittyChainSeconds = null;
  if (session.game_type === "KITTY") {
    const lastWinner = [...(games || [])].reverse().find((g) => Array.isArray(g.winner_person_ids) && g.winner_person_ids.length);
    const chainStart = Date.parse(lastWinner?.completed_at || session.started_at || "");
    kittyChainSeconds = Number.isFinite(chainStart) ? Math.max(0, Math.floor((Date.now() - chainStart) / 1000)) : 0;
  }

  const sessionPayload = {
    ...sessionDto(session),
    game_label: rule?.display_name || session.game_type,
    billing_mode: rule?.billing_mode || null,
    hourly_rate_inr: rate,
    fnb_total_inr: fnbTotal,
    game_charges_inr: gameCharges,
    kitty_chain_seconds_live: kittyChainSeconds,
  };

  if (session.status !== "ENDED") return json(res, 200, { ok: true, state: "PLAYING", table: tableDto(table), standby_rules: rules, session: sessionPayload });

  let bill = null;
  if (session.account_mode === "LEGACY") {
    const { data } = await supabase.from("snooker_bills").select("*").eq("session_id", session.id).neq("status","CANCELLED").order("finalized_at",{ascending:false}).limit(1).maybeSingle();
    bill = data || null;
  }
  if (!bill) return json(res, 200, { ok: true, state: "PLAYING", table: tableDto(table), standby_rules: rules, session: sessionPayload });

  let payment = null;
  if (number(bill.due_inr) > 0) {
    const { data } = await supabase.from("snooker_bill_payments").select("*").eq("bill_id", bill.id).in("method",["ONLINE","UPI"]).eq("status","PENDING").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if (data) payment = { payment_id: data.id, status: data.status, amount_inr: money(data.amount_inr), qr_url: qrElementUrl(data) };
  }
  const billPayload = { bill_id: bill.id, bill_no: bill.bill_no, game_total_inr: money(bill.game_total_inr), fnb_total_inr: money(bill.fnb_total_inr), total_inr: money(bill.total_inr), due_inr: money(bill.due_inr), status: bill.status };
  return json(res, 200, { ok: true, state: bill.status === "PAID" ? "PAID" : "PAYMENT", table: tableDto(table), standby_rules: rules, session: sessionPayload, bill: billPayload, payment });
}

async function dashboardSummary(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const bounds = indiaDayBounds();

  const [
    { data: todayBills, error: billError },
    { data: cashPayments, error: cashError },
    { data: upiPayments, error: upiError },
    { data: outstandingBills, error: outstandingError },
  ] = await Promise.all([
    supabase.from("snooker_bills").select("id").eq("accounting_excluded", false).gte("finalized_at", bounds.start).lt("finalized_at", bounds.end),
    supabase.from("snooker_bill_payments").select("bill_id,amount_inr").eq("method", "CASH").eq("status", "RECEIVED").gte("created_at", bounds.start).lt("created_at", bounds.end),
    supabase.from("snooker_bill_payments").select("bill_id,amount_inr").in("method", ["UPI","ONLINE"]).in("status", ["RECEIVED","VERIFIED"]).gte("updated_at", bounds.start).lt("updated_at", bounds.end),
    supabase.from("snooker_bills").select("due_inr").eq("accounting_excluded", false).gt("due_inr", 0),
  ]);
  if (billError || cashError || upiError || outstandingError) throw billError || cashError || upiError || outstandingError;

  const paymentBillIds = [...new Set([...(cashPayments || []), ...(upiPayments || [])].map((row) => row.bill_id).filter(Boolean))];
  let excludedPaymentBillIds = new Set();
  if (paymentBillIds.length) {
    const { data: excludedRows, error: excludedError } = await supabase
      .from("snooker_bills")
      .select("id")
      .in("id", paymentBillIds)
      .eq("accounting_excluded", true);
    if (excludedError) throw excludedError;
    excludedPaymentBillIds = new Set((excludedRows || []).map((row) => row.id));
  }
  const cash = (cashPayments || []).filter((row) => !excludedPaymentBillIds.has(row.bill_id)).reduce((sum, row) => sum + number(row.amount_inr), 0);
  const upi = (upiPayments || []).filter((row) => !excludedPaymentBillIds.has(row.bill_id)).reduce((sum, row) => sum + number(row.amount_inr), 0);
  const outstanding = (outstandingBills || []).reduce((sum, row) => sum + number(row.due_inr), 0);
  return json(res, 200, {
    business_date: bounds.day,
    today_finalized_bills: (todayBills || []).length,
    today_cash_inr: money(cash),
    today_upi_inr: money(upi),
    today_realized_sales_inr: money(cash + upi),
    outstanding_all_inr: money(outstanding),
  });
}

async function loadFinanceReserveSummary(supabase) {
  const { data: plan, error: planError } = await supabase
    .from("qclub_finance_plan")
    .select("*")
    .eq("id", "default")
    .eq("active", true)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw Object.assign(new Error("Finance reserve plan is not configured."), { status: 409, code: "FINANCE_PLAN_NOT_CONFIGURED" });

  const bounds = indiaMonthBounds();

  const [
    { data: monthCashPayments, error: monthCashError },
    { data: monthUpiPayments, error: monthUpiError },
    { data: monthFnbLines, error: monthFnbError },
    { data: fnbCatalogue, error: fnbCatalogueError },
  ] = await Promise.all([
    supabase
      .from("snooker_bill_payments")
      .select("id,bill_id,method,amount_inr,status,created_at,verified_at")
      .eq("method", "CASH")
      .eq("status", "RECEIVED")
      .gte("created_at", bounds.start)
      .lt("created_at", bounds.end),
    supabase
      .from("snooker_bill_payments")
      .select("id,bill_id,method,amount_inr,status,created_at,verified_at")
      .in("method", ["UPI","ONLINE"])
      .in("status", ["RECEIVED","VERIFIED"])
      .gte("updated_at", bounds.start)
      .lt("updated_at", bounds.end),
    supabase
      .from("snooker_fnb_lines")
      .select("bill_id,item_id,item_name_snapshot,unit_price_snapshot_inr,quantity,line_total_inr,status,added_at")
      .neq("status", "VOIDED")
      .gte("added_at", bounds.start)
      .lt("added_at", bounds.end),
    supabase
      .from("snooker_catalogue_items")
      .select("id,name,category,selling_price_inr,cost_price_inr,active")
      .eq("active", true)
      .order("category")
      .order("name"),
  ]);
  if (monthCashError || monthUpiError || monthFnbError || fnbCatalogueError) {
    throw monthCashError || monthUpiError || monthFnbError || fnbCatalogueError;
  }

  const fnbBillIds = [...new Set((monthFnbLines || []).map((row) => row.bill_id).filter(Boolean))];
  let excludedFnbBillIds = new Set();
  if (fnbBillIds.length) {
    const { data: excludedFnbBills, error: excludedFnbError } = await supabase
      .from("snooker_bills")
      .select("id")
      .in("id", fnbBillIds)
      .eq("accounting_excluded", true);
    if (excludedFnbError) throw excludedFnbError;
    excludedFnbBillIds = new Set((excludedFnbBills || []).map((row) => row.id));
  }

  const monthPayments = [...(monthCashPayments || []), ...(monthUpiPayments || [])];
  const billIds = [...new Set(monthPayments.map((row) => row.bill_id).filter(Boolean))];

  let bills = [];
  let allSuccessfulPayments = [];
  if (billIds.length) {
    const [
      { data: billRows, error: billError },
      { data: paymentRows, error: paymentError },
    ] = await Promise.all([
      supabase
        .from("snooker_bills")
        .select("id,bill_no,game_total_inr,fnb_total_inr,discount_inr,total_inr,paid_inr,due_inr,status,finalized_at,accounting_excluded")
        .in("id", billIds)
        .eq("accounting_excluded", false),
      supabase
        .from("snooker_bill_payments")
        .select("id,bill_id,method,amount_inr,status,created_at,verified_at")
        .in("bill_id", billIds)
        .in("status", ["RECEIVED", "VERIFIED"]),
    ]);
    if (billError || paymentError) throw billError || paymentError;
    bills = billRows || [];
    allSuccessfulPayments = paymentRows || [];
  }

  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const paymentsByBill = new Map();
  for (const payment of allSuccessfulPayments) {
    if (!payment?.bill_id) continue;
    const effectiveAt = ["UPI","ONLINE"].includes(payment.method)
      ? (payment.verified_at || payment.updated_at || payment.created_at)
      : payment.created_at;
    const effectiveMs = Date.parse(effectiveAt || "");
    if (!Number.isFinite(effectiveMs)) continue;
    if (!paymentsByBill.has(payment.bill_id)) paymentsByBill.set(payment.bill_id, []);
    paymentsByBill.get(payment.bill_id).push({ ...payment, effective_ms: effectiveMs });
  }

  const monthStartMs = Date.parse(bounds.start);
  const monthEndMs = Date.parse(bounds.end);
  let tableCash = 0;
  let tableUpi = 0;
  let monthGrossTableCharges = 0;
  let monthGrossFnbCharges = 0;
  let monthDiscount = 0;
  let monthOutstandingTable = 0;

  for (const bill of bills) {
    const payableTotal = Math.max(0, number(bill.total_inr, 0));
    const grossFnb = Math.max(0, number(bill.fnb_total_inr, 0));
    // Protect inventory cash first. Discounts reduce table/game revenue first;
    // only if the discount exceeds table charges can it reduce the F&B portion.
    const protectedFnb = Math.min(grossFnb, payableTotal);
    const payableTable = Math.max(0, payableTotal - protectedFnb);

    const finalizedMs = Date.parse(bill.finalized_at || "");
    if (Number.isFinite(finalizedMs) && finalizedMs >= monthStartMs && finalizedMs < monthEndMs) {
      monthGrossTableCharges += Math.max(0, number(bill.game_total_inr, 0));
      monthGrossFnbCharges += grossFnb;
      monthDiscount += Math.max(0, number(bill.discount_inr, 0));
    }

    const rows = (paymentsByBill.get(bill.id) || []).sort((a, b) => a.effective_ms - b.effective_ms);
    let cumulativePaid = 0;
    let tablePaidTotal = 0;

    for (const payment of rows) {
      const amount = Math.max(0, number(payment.amount_inr, 0));
      const beforeApplied = Math.min(payableTotal, cumulativePaid);
      const afterApplied = Math.min(payableTotal, cumulativePaid + amount);
      const tableBefore = Math.max(0, beforeApplied - protectedFnb);
      const tableAfter = Math.max(0, afterApplied - protectedFnb);
      const tablePortion = Math.max(0, Math.min(payableTable, tableAfter) - Math.min(payableTable, tableBefore));

      cumulativePaid += amount;
      tablePaidTotal += tablePortion;

      if (payment.effective_ms >= monthStartMs && payment.effective_ms < monthEndMs && tablePortion > 0) {
        if (payment.method === "CASH") tableCash += tablePortion;
        else if (["UPI","ONLINE"].includes(payment.method)) tableUpi += tablePortion;
      }
    }

    if (Number.isFinite(finalizedMs) && finalizedMs >= monthStartMs && finalizedMs < monthEndMs) {
      monthOutstandingTable += Math.max(0, payableTable - Math.min(payableTable, tablePaidTotal));
    }
  }

  const realizedTableRevenue = tableCash + tableUpi;

  const regularCommitments =
    number(plan.loan_service_inr) +
    number(plan.electricity_inr) +
    number(plan.staff_salary_inr) +
    number(plan.supabase_inr) +
    number(plan.msg91_inr) +
    number(plan.misc_inr) +
    number(plan.personal_inr);

  const collectionTarget = number(plan.monthly_collection_target_inr);
  const dueDay = Math.max(1, Math.min(31, Number(plan.due_day || 30)));
  const elapsedPlanDays = Math.max(0, Math.min(bounds.date, dueDay));
  const liabilityRemaining = Math.max(
    0,
    number(plan.legacy_liability_inr) - number(plan.legacy_liability_paid_inr)
  );
  const plannedMonthlyLiabilityAllocation = Math.min(
    liabilityRemaining,
    Math.max(0, collectionTarget - regularCommitments)
  );

  const dailyRegularReserve = regularCommitments / dueDay;
  const dailyLiabilityReserve = plannedMonthlyLiabilityAllocation / dueDay;
  const dailyCollectionTarget = collectionTarget / dueDay;

  const regularReserveTargetToDate = Math.min(
    regularCommitments,
    dailyRegularReserve * elapsedPlanDays
  );
  const liabilityReserveTargetToDate = Math.min(
    plannedMonthlyLiabilityAllocation,
    dailyLiabilityReserve * elapsedPlanDays
  );
  const totalProtectedTargetToDate = regularReserveTargetToDate + liabilityReserveTargetToDate;

  const safeToSpend = Math.max(0, realizedTableRevenue - totalProtectedTargetToDate);
  const reserveShortfall = Math.max(0, totalProtectedTargetToDate - realizedTableRevenue);
  const monthTargetRemaining = Math.max(0, collectionTarget - realizedTableRevenue);

  const regularRatio = collectionTarget > 0
    ? Math.min(1, regularCommitments / collectionTarget)
    : 0;
  const liabilityRatio = collectionTarget > 0
    ? Math.min(1, plannedMonthlyLiabilityAllocation / collectionTarget)
    : 0;

  const fnbItemById = new Map((fnbCatalogue || []).map((item) => [item.id, item]));
  const fnbSoldById = new Map();
  let fnbSales = 0;
  let fnbRestockReserve = 0;
  let fnbFallbackReserve = 0;

  for (const line of monthFnbLines || []) {
    if (line.bill_id && excludedFnbBillIds.has(line.bill_id)) continue;
    const quantity = Math.max(0, number(line.quantity, 0));
    const lineTotal = Math.max(0, number(line.line_total_inr, 0));
    const sellUnit = quantity > 0
      ? Math.max(0, number(line.unit_price_snapshot_inr, lineTotal / quantity))
      : 0;
    const item = fnbItemById.get(line.item_id);
    const configuredCost = item?.cost_price_inr != null && Number.isFinite(Number(item.cost_price_inr))
      ? Math.max(0, number(item.cost_price_inr, 0))
      : null;
    const reserveUnit = configuredCost == null ? sellUnit : configuredCost;
    const reserve = quantity * reserveUnit;

    fnbSales += lineTotal;
    fnbRestockReserve += reserve;
    if (configuredCost == null) fnbFallbackReserve += lineTotal;

    const current = fnbSoldById.get(line.item_id) || { quantity: 0, sales: 0 };
    current.quantity += quantity;
    current.sales += lineTotal;
    fnbSoldById.set(line.item_id, current);
  }

  const fnbCostItems = (fnbCatalogue || [])
    .filter((item) => number(item.selling_price_inr, 0) > 0)
    .map((item) => {
      const sold = fnbSoldById.get(item.id) || { quantity: 0, sales: 0 };
      const configured = item.cost_price_inr != null && Number.isFinite(Number(item.cost_price_inr));
      return {
        item_id: item.id,
        name: item.name,
        category: item.category,
        selling_price_inr: money(item.selling_price_inr),
        cost_price_inr: configured ? money(item.cost_price_inr) : null,
        cost_configured: configured,
        month_quantity_sold: number(sold.quantity, 0),
        month_sales_inr: money(sold.sales),
      };
    });

  const fnbMissingCostCount = fnbCostItems.filter((item) => !item.cost_configured).length;
  const fnbSoldMissingCostCount = fnbCostItems.filter((item) => !item.cost_configured && item.month_quantity_sold > 0).length;
  const fnbProfitLeft = fnbSales - fnbRestockReserve;

  return {
    admin_only: true,
    revenue_scope: "TABLE_ONLY",
    source_note: "Finance Reserve uses only realized table/game revenue. F&B, Q Lounge, QShop and website-order revenue are excluded. On mixed bills, F&B is treated as funded first so inventory-replenishment cash cannot inflate Safe to Spend.",
    business_date: bounds.day,
    period_start: bounds.start,
    period_end: bounds.end,
    plan: {
      monthly_collection_target_inr: money(collectionTarget),
      daily_collection_target_inr: money(dailyCollectionTarget),
      due_day: dueDay,
      regular_commitments_inr: money(regularCommitments),
      planned_monthly_liability_allocation_inr: money(plannedMonthlyLiabilityAllocation),
      legacy_liability_inr: money(plan.legacy_liability_inr),
      legacy_liability_paid_inr: money(plan.legacy_liability_paid_inr),
      legacy_liability_remaining_inr: money(liabilityRemaining),
      categories: {
        loan_service_inr: money(plan.loan_service_inr),
        electricity_inr: money(plan.electricity_inr),
        staff_salary_inr: money(plan.staff_salary_inr),
        supabase_inr: money(plan.supabase_inr),
        msg91_inr: money(plan.msg91_inr),
        misc_inr: money(plan.misc_inr),
        personal_inr: money(plan.personal_inr),
      },
    },
    actuals: {
      month_table_cash_inr: money(tableCash),
      month_table_upi_inr: money(tableUpi),
      month_realized_table_revenue_inr: money(realizedTableRevenue),
      month_gross_table_charges_inr: money(monthGrossTableCharges),
      month_fnb_charges_excluded_inr: money(monthGrossFnbCharges),
      month_discount_inr: money(monthDiscount),
      month_outstanding_table_inr: money(monthOutstandingTable),
      month_cash_inr: money(tableCash),
      month_upi_inr: money(tableUpi),
      month_website_paid_inr: 0,
      month_collections_inr: money(realizedTableRevenue),
    },
    reserve: {
      elapsed_plan_days: elapsedPlanDays,
      daily_regular_reserve_inr: money(dailyRegularReserve),
      daily_liability_reserve_inr: money(dailyLiabilityReserve),
      daily_total_protected_inr: money(dailyRegularReserve + dailyLiabilityReserve),
      regular_target_to_date_inr: money(regularReserveTargetToDate),
      liability_target_to_date_inr: money(liabilityReserveTargetToDate),
      protected_target_to_date_inr: money(totalProtectedTargetToDate),
      reserve_shortfall_inr: money(reserveShortfall),
      safe_to_spend_inr: money(safeToSpend),
      month_target_remaining_inr: money(monthTargetRemaining),
      per_100_regular_inr: money(regularRatio * 100),
      per_100_liability_inr: money(liabilityRatio * 100),
    },
    fnb_stock_wallet: {
      admin_only: true,
      scope: "LEDGER_FNB",
      month_sales_inr: money(fnbSales),
      keep_for_restock_inr: money(fnbRestockReserve),
      profit_left_inr: money(fnbProfitLeft),
      fallback_full_sale_reserve_inr: money(fnbFallbackReserve),
      missing_cost_count: fnbMissingCostCount,
      sold_missing_cost_count: fnbSoldMissingCostCount,
      setup_complete: fnbMissingCostCount === 0,
      note: "If cost is missing, 100% of that item's selling price is protected for restocking. Profit left is F&B sales minus replacement cost only.",
      items: fnbCostItems,
    },
  };
}

async function updateFnbCostPrices(req, res) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const rows = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rows.length || rows.length > 200) {
    return json(res, 400, { ok: false, error: "FNB_COST_ITEMS_REQUIRED" });
  }

  const normalized = [];
  for (const row of rows) {
    const itemId = safeText(row?.item_id || row?.itemId || "", 160);
    const value = Number(row?.cost_price_inr ?? row?.costPriceInr);
    if (!itemId || !Number.isFinite(value) || value < 0) {
      return json(res, 400, { ok: false, error: "INVALID_FNB_COST", item_id: itemId || null });
    }
    normalized.push({ item_id: itemId, cost_price_inr: money(value) });
  }

  const uniqueIds = [...new Set(normalized.map((row) => row.item_id))];
  const { data: existing, error: existingError } = await supabase
    .from("snooker_catalogue_items")
    .select("id,active,selling_price_inr")
    .in("id", uniqueIds);
  if (existingError) throw existingError;

  const validIds = new Set((existing || []).filter((item) => item.active).map((item) => item.id));
  if (validIds.size !== uniqueIds.length) {
    return json(res, 400, { ok: false, error: "FNB_COST_ITEM_NOT_FOUND" });
  }

  for (const row of normalized) {
    const { error } = await supabase
      .from("snooker_catalogue_items")
      .update({ cost_price_inr: row.cost_price_inr, updated_at: new Date().toISOString() })
      .eq("id", row.item_id);
    if (error) throw error;
  }

  return json(res, 200, await loadFinanceReserveSummary(supabase));
}

async function financeReserve(req, res) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const payload = await loadFinanceReserveSummary(getSupabaseAdmin());
  return json(res, 200, payload);
}

async function updateFinanceReserve(req, res) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();

  const numericFields = [
    "monthly_collection_target_inr",
    "loan_service_inr",
    "electricity_inr",
    "staff_salary_inr",
    "supabase_inr",
    "msg91_inr",
    "misc_inr",
    "personal_inr",
    "legacy_liability_inr",
    "legacy_liability_paid_inr",
  ];

  const update = {};
  for (const field of numericFields) {
    if (req.body?.[field] == null) continue;
    const value = Number(req.body[field]);
    if (!Number.isFinite(value) || value < 0) {
      return json(res, 400, { ok: false, error: "INVALID_FINANCE_VALUE", field });
    }
    update[field] = money(value);
  }

  if (req.body?.due_day != null) {
    const dueDay = Number(req.body.due_day);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      return json(res, 400, { ok: false, error: "INVALID_DUE_DAY" });
    }
    update.due_day = dueDay;
  }

  if (!Object.keys(update).length) {
    return json(res, 400, { ok: false, error: "NO_FINANCE_CHANGES" });
  }

  update.updated_at = new Date().toISOString();
  update.updated_by = auth.staff_id;

  const { error } = await supabase
    .from("qclub_finance_plan")
    .update(update)
    .eq("id", "default");
  if (error) throw error;

  return json(res, 200, await loadFinanceReserveSummary(supabase));
}


async function health(req, res) {
  let databaseReady = false;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("snooker_tables").select("id", { head: true, count: "exact" });
    databaseReady = !error;
  } catch {
    databaseReady = false;
  }

  const cashfreeReady = Boolean(env("CASHFREE_APP_ID") && env("CASHFREE_SECRET_KEY"));
  const msg91Ready = Boolean(env("MSG91_AUTH_KEY") && env("MSG91_SENDER_NUMBER"));
  return json(res, 200, {
    ok: databaseReady,
    api_version: API_VERSION,
    environment: env("VERCEL_ENV") || "production",
    cashfree_ready: cashfreeReady,
    msg91_ready: msg91Ready,
    database_ready: databaseReady,
    server_time: new Date().toISOString(),
  });
}

async function getTables(supabase) {
  const { data, error } = await supabase
    .from("snooker_tables")
    .select("*")
    .eq("active", true)
    .order("table_no");
  if (error) throw error;
  return data || [];
}

async function getRules(supabase) {
  const { data, error } = await supabase
    .from("snooker_game_rules")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

function tableDto(row) {
  return {
    id: row.id,
    table_id: row.id,
    table_no: row.table_no,
    display_name: row.display_name,
    table_type: row.table_type,
    price_per_hour_inr: row.price_per_hour_inr == null ? null : money(row.price_per_hour_inr),
    member_price_per_hour_inr: row.member_price_per_hour_inr == null ? null : money(row.member_price_per_hour_inr),
    active: row.active,
  };
}

function ruleDto(row) {
  return {
    game_type: row.game_type,
    display_name: row.display_name,
    billing_mode: row.billing_mode,
    rate_inr: row.rate_inr == null ? null : money(row.rate_inr),
    min_players: row.min_players,
    max_players: row.max_players,
    timer_required: row.timer_required,
    active: row.active,
    sort_order: row.sort_order,
  };
}

function personElapsedSeconds(person, at = new Date()) {
  let seconds = number(person.accumulated_seconds);
  if (person.timer_running && person.timer_started_at) {
    const start = Date.parse(person.timer_started_at);
    const end = at.getTime();
    if (Number.isFinite(start) && end > start) seconds += Math.floor((end - start) / 1000);
  }
  return Math.max(0, seconds);
}

async function individualSessionSnapshot(supabase, sessionId) {
  const [{ data: people }, { data: charges }, { data: bills }] = await Promise.all([
    supabase.from("snooker_session_people").select("*").eq("session_id", sessionId).order("joined_at"),
    supabase.from("snooker_person_charges").select("*").eq("session_id", sessionId).order("created_at"),
    supabase.from("snooker_bills").select("*").eq("source_session_id", sessionId).eq("bill_source", "PLAYER_ACCOUNT").order("finalized_at"),
  ]);
  const activeCharges = (charges || []).filter((x) => x.status === "ACTIVE");
  const now = new Date();
  return (people || []).map((person) => {
    const own = activeCharges.filter((x) => x.person_id === person.id);
    const ownBills = (bills || []).filter((x) => x.person_id === person.id && x.status !== "CANCELLED");
    const billById = new Map(ownBills.map((bill) => [bill.id, bill]));
    const unbilled = own.filter((x) => !x.bill_id);
    const sumType = (type) => money(own.filter((x) => x.charge_type === type).reduce((s,x)=>s+number(x.amount_inr),0));
    const unbilledTotal = money(unbilled.reduce((s,x)=>s+number(x.amount_inr),0));
    const billedDue = money(ownBills.reduce((s,x)=>s+number(x.due_inr),0));
    const billedPaid = money(ownBills.reduce((s,x)=>s+number(x.paid_inr),0));
    const accountEntries = own.map((charge) => {
      const linkedBill = charge.bill_id ? billById.get(charge.bill_id) : null;
      const settlement = !charge.bill_id
        ? "RUNNING"
        : linkedBill?.status === "PAID"
          ? "PAID"
          : "BILLED";
      return {
        charge_id: charge.id,
        charge_type: charge.charge_type,
        description: charge.description,
        amount_inr: money(charge.amount_inr),
        created_at: charge.created_at,
        bill_id: charge.bill_id || null,
        bill_no: linkedBill?.bill_no || null,
        settlement_status: settlement,
      };
    });
    return {
      id: person.id,
      person_id: person.id,
      customer_id: person.customer_id || null,
      name: person.name,
      phone: person.phone,
      is_member: person.is_member,
      team_no: person.team_no,
      status: person.status,
      joined_at: person.joined_at,
      left_at: person.left_at,
      settled_at: person.settled_at,
      play_seconds: personElapsedSeconds(person, now),
      game_charges_inr: sumType("GAME"),
      fnb_charges_inr: sumType("FNB"),
      table_charges_inr: sumType("TABLE"),
      unbilled_inr: unbilledTotal,
      billed_due_inr: billedDue,
      paid_inr: billedPaid,
      current_due_inr: money(unbilledTotal + billedDue),
      account_entries: accountEntries,
      bills: ownBills.map((b)=>({bill_id:b.id,bill_no:b.bill_no,status:b.status,total_inr:money(b.total_inr),paid_inr:money(b.paid_inr),due_inr:money(b.due_inr)})),
    };
  });
}

async function createPersonCharge(supabase, { sessionId, personId, type, referenceId, description, amount, staffId, metadata = {} }) {
  const { data, error } = await supabase.from("snooker_person_charges").insert({
    session_id: sessionId,
    person_id: personId,
    charge_type: type,
    reference_id: referenceId || null,
    description,
    amount_inr: money(amount),
    metadata,
    created_by: staffId || null,
  }).select("*").single();
  if (error) throw error;
  return data;
}

async function qchaseNextGameNumber(supabase, sessionId) {
  const { data: last, error } = await supabase
    .from("snooker_completed_games")
    .select("game_number")
    .eq("session_id", sessionId)
    .eq("game_type", "QCHASE_RUMMY")
    .eq("status", "COMPLETED")
    .order("game_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return number(last?.game_number, 0) + 1;
}

async function ensureQchasePrepaidEntryCharge(supabase, { sessionId, person, gameNumber, rate, staffId, reason = "JOIN" }) {
  const { data: existingRows, error: existingError } = await supabase
    .from("snooker_person_charges")
    .select("*")
    .eq("session_id", sessionId)
    .eq("person_id", person.id)
    .eq("charge_type", "GAME")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false });
  if (existingError) throw existingError;
  const existing = (existingRows || []).find((row) =>
    Boolean(row.metadata?.qchase_prepaid) &&
    number(row.metadata?.game_number, 0) === number(gameNumber, 0)
  );
  if (existing) return existing;

  return createPersonCharge(supabase, {
    sessionId,
    personId: person.id,
    type: "GAME",
    referenceId: null,
    description: `QChase / Rummy — Game ${gameNumber} entry • charged on ${reason.toLowerCase()}`,
    amount: rate,
    staffId,
    metadata: {
      game_number: gameNumber,
      settlement_rule: "PER_PLAYER",
      qchase_prepaid: true,
      qchase_entry_reason: reason,
      charged_at_entry: true,
      person_name: person.name,
    },
  });
}

async function createQchaseGameStart(supabase, { sessionId, playerRows, rate, staffId, gameNumber, key = null }) {
  const selected = (playerRows || []).filter(Boolean);
  if (selected.length < 2 || selected.length > 6) {
    const err = new Error("QChase/Rummy requires 2 to 6 players.");
    err.status = 400;
    err.code = "QCHASE_GAME_REQUIRES_TWO_TO_SIX_PLAYERS";
    throw err;
  }
  const ids = selected.map((person) => person.id);
  const names = selected.map((person) => person.name);
  const allocations = ids.map((id) => ({ person_id: id, amount_inr: money(rate) }));
  const total = money(money(rate) * selected.length);

  const { data: game, error: gameError } = await supabase.from("snooker_completed_games").insert({
    session_id: sessionId,
    game_number: gameNumber,
    game_type: "QCHASE_RUMMY",
    billing_mode: "PER_PLAYER_PER_GAME",
    rate_snapshot_inr: money(rate),
    player_ids: ids,
    player_names: names,
    player_count_snapshot: selected.length,
    calculated_charge_inr: total,
    settlement_rule: "PER_PLAYER",
    match_format: "FLEX",
    winner_person_ids: [],
    loser_person_ids: [],
    charge_allocations: allocations,
    pricing_snapshot: {
      mode: "PER_PLAYER_CHARGED_AT_GAME_START",
      charged_before_finish: true,
      rate_inr: money(rate),
    },
    completed_by: staffId,
    idempotency_key: key || null,
  }).select("*").single();
  if (gameError) throw gameError;

  try {
    const { data: existingCharges, error: chargeReadError } = await supabase
      .from("snooker_person_charges")
      .select("*")
      .eq("session_id", sessionId)
      .in("person_id", ids)
      .eq("charge_type", "GAME")
      .eq("status", "ACTIVE")
      .order("created_at");
    if (chargeReadError) throw chargeReadError;

    for (const person of selected) {
      const prepaid = (existingCharges || []).find((row) =>
        row.person_id === person.id &&
        Boolean(row.metadata?.qchase_prepaid) &&
        number(row.metadata?.game_number, 0) === number(gameNumber, 0)
      );
      if (prepaid) {
        const metadata = {
          ...(prepaid.metadata || {}),
          qchase_prepaid: false,
          qchase_applied_to_game: true,
          game_number: gameNumber,
          settlement_rule: "PER_PLAYER",
          person_name: person.name,
        };
        const { error: updateError } = await supabase.from("snooker_person_charges").update({
          reference_id: game.id,
          description: `QChase / Rummy — Game ${gameNumber} entry`,
          metadata,
        }).eq("id", prepaid.id);
        if (updateError) throw updateError;
      } else {
        await createPersonCharge(supabase, {
          sessionId,
          personId: person.id,
          type: "GAME",
          referenceId: game.id,
          description: `QChase / Rummy — Game ${gameNumber} entry`,
          amount: rate,
          staffId,
          metadata: {
            game_number: gameNumber,
            settlement_rule: "PER_PLAYER",
            qchase_applied_to_game: true,
            charged_at_game_start: true,
            person_name: person.name,
          },
        });
      }
    }
  } catch (error) {
    await supabase.from("snooker_person_charges").delete().eq("reference_id", game.id).is("bill_id", null);
    await supabase.from("snooker_completed_games").delete().eq("id", game.id);
    throw error;
  }

  return { ...game, game_id: game.id, charge_allocations: allocations };
}

async function syncActivePersonTimers(supabase, sessionId, action, at = new Date()) {
  const { data: people } = await supabase.from("snooker_session_people").select("*").eq("session_id", sessionId).eq("status", "ACTIVE");
  for (const person of people || []) {
    if (action === "PAUSE" && person.timer_running) {
      await supabase.from("snooker_session_people").update({
        accumulated_seconds: personElapsedSeconds(person, at),
        timer_running: false,
        timer_started_at: null,
        updated_at: at.toISOString(),
      }).eq("id", person.id);
    } else if (action === "RESUME" && !person.timer_running) {
      await supabase.from("snooker_session_people").update({
        timer_running: true,
        timer_started_at: at.toISOString(),
        updated_at: at.toISOString(),
      }).eq("id", person.id);
    }
  }
}


async function settleSharedHourlySlice(supabase, session, at, staffId, reason) {
  if (!session || session.payment_rule !== "HOURLY_SHARED") return null;
  const endedAt = at instanceof Date ? at.toISOString() : new Date(at || Date.now()).toISOString();
  const { data, error } = await supabase.rpc("settle_shared_hourly_slice", {
    p_session_id: session.id,
    p_at: endedAt,
    p_staff_id: staffId || null,
    p_reason: reason || "ROSTER_CHANGE",
  });
  if (error) throw error;
  return data || null;
}

function canonicalCustomerName(value = "") {
  return safeText(value, 160).trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeCustomerName(value = "") {
  return canonicalCustomerName(value).toLowerCase();
}

function customerDto(row) {
  return {
    customer_id: row.id,
    id: row.id,
    name: row.name,
    phone: row.phone || null,
    is_member: Boolean(row.is_member),
    member_tier: row.member_tier || null,
    visit_count: number(row.visit_count),
    last_seen_at: row.last_seen_at || null,
    source: row.source || null,
    balance_inr: money(row.balance_inr || 0),
  };
}

async function rememberCustomer(supabase, { name, phone, isMember = false, memberTier = null, source = "qclub_ledger" } = {}) {
  const cleanName = canonicalCustomerName(name || "");
  if (!cleanName) return null;
  const normalizedName = normalizeCustomerName(cleanName);
  const normalizedPhone = normalizePhone(phone || "") || null;

  const { data: existing, error: readError } = await supabase
    .from("snooker_customers")
    .select("*")
    .eq("normalized_name", normalizedName)
    .maybeSingle();
  if (readError) throw readError;

  const now = new Date().toISOString();
  if (existing) {
    const patch = {
      name: cleanName,
      phone: normalizedPhone || existing.phone || null,
      normalized_phone: normalizedPhone || existing.normalized_phone || null,
      is_member: Boolean(existing.is_member || isMember),
      member_tier: memberTier || existing.member_tier || null,
      source: safeText(source || existing.source || "qclub_ledger", 80),
      visit_count: Math.max(1, number(existing.visit_count, 0) + 1),
      last_seen_at: now,
      active: true,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from("snooker_customers")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("snooker_customers")
    .insert({
      name: cleanName,
      normalized_name: normalizedName,
      phone: normalizedPhone,
      normalized_phone: normalizedPhone,
      is_member: Boolean(isMember),
      member_tier: memberTier || null,
      source: safeText(source || "qclub_ledger", 80),
      visit_count: 1,
      last_seen_at: now,
      active: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function listCustomers(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const requestedLimit = Math.floor(number(req.query?.limit, 200));
  const limit = Math.min(500, Math.max(1, requestedLimit || 200));
  const { data, error } = await supabase
    .from("snooker_customers")
    .select("*")
    .eq("active", true)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("name")
    .limit(limit);
  if (error) throw error;
  return json(res, 200, { customers: (data || []).map(customerDto) });
}

async function upsertCustomer(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const customer = await rememberCustomer(getSupabaseAdmin(), {
    name: req.body?.name,
    phone: req.body?.phone,
    isMember: Boolean(req.body?.is_member),
    memberTier: req.body?.member_tier || null,
    source: "manual_ledger",
  });
  if (!customer) return json(res, 400, { ok: false, error: "CUSTOMER_NAME_REQUIRED" });
  return json(res, 200, customerDto(customer));
}


async function listPlayerTabs(req,res){
  const auth=await requireAuth(req,res); if(!auth)return;
  const supabase=getSupabaseAdmin();

  const [{data:people,error:peopleError},{data:openFnbTabs,error:fnbTabError}] = await Promise.all([
    supabase.from("snooker_session_people").select("id,customer_id,session_id,name,phone,status,joined_at,left_at").not("customer_id","is",null).order("updated_at",{ascending:false}).limit(1000),
    supabase.from("snooker_fnb_tabs").select("*").eq("status","OPEN").not("customer_id","is",null).order("last_order_at",{ascending:false}).limit(500),
  ]);
  if(peopleError||fnbTabError)throw peopleError||fnbTabError;

  const personIds=(people||[]).map(p=>p.id);
  let charges=[];
  if(personIds.length){
    const q=await supabase.from("snooker_person_charges").select("*").in("person_id",personIds).eq("status","ACTIVE").is("bill_id",null);
    if(q.error)throw q.error;charges=q.data||[];
  }

  const fnbTabIds=(openFnbTabs||[]).map(t=>t.id);
  let runningFnbLines=[];
  if(fnbTabIds.length){
    const q=await supabase.from("snooker_fnb_lines").select("*").in("tab_id",fnbTabIds).eq("status","ACTIVE").is("bill_id",null);
    if(q.error)throw q.error;runningFnbLines=q.data||[];
  }

  const customerIds=[...new Set([
    ...(people||[]).map(p=>p.customer_id),
    ...(openFnbTabs||[]).map(t=>t.customer_id),
  ].filter(Boolean))];

  let customers=[],bills=[],sessions=[];
  if(customerIds.length){
    const [cq,bq]=await Promise.all([
      supabase.from("snooker_customers").select("*").in("id",customerIds),
      supabase.from("snooker_bills").select("*").in("customer_id",customerIds).neq("status","CANCELLED")
    ]);
    if(cq.error||bq.error)throw cq.error||bq.error;customers=cq.data||[];bills=bq.data||[];
  }
  const sessionIds=[...new Set((people||[]).map(p=>p.session_id).filter(Boolean))];
  if(sessionIds.length){
    const sq=await supabase.from("snooker_sessions").select("id,table_id,game_type,status").in("id",sessionIds);
    if(sq.error)throw sq.error;sessions=sq.data||[];
  }

  const customerMap=new Map(customers.map(c=>[c.id,c]));
  const sessionMap=new Map(sessions.map(x=>[x.id,x]));
  const tabs=customerIds.map(customerId=>{
    const customer=customerMap.get(customerId);
    const ownPeople=(people||[]).filter(p=>p.customer_id===customerId);
    const ownIds=new Set(ownPeople.map(p=>p.id));
    const ownCharges=charges.filter(c=>ownIds.has(c.person_id));
    const ownBills=bills.filter(b=>b.customer_id===customerId);
    const ownFnbTabs=(openFnbTabs||[]).filter(t=>t.customer_id===customerId);
    const ownFnbTabIds=new Set(ownFnbTabs.map(t=>t.id));
    const ownRunningFnb=runningFnbLines.filter(line=>ownFnbTabIds.has(line.tab_id));

    const playerUnbilled=money(ownCharges.reduce((sum,c)=>sum+number(c.amount_inr),0));
    const runningFnbUnbilled=money(ownRunningFnb.reduce((sum,line)=>sum+number(line.line_total_inr),0));
    const unbilled=money(playerUnbilled+runningFnbUnbilled);
    const billedDue=money(ownBills.reduce((sum,b)=>sum+number(b.due_inr),0));
    const activeLocations=ownPeople.filter(p=>p.status==="ACTIVE").map(p=>{
      const x=sessionMap.get(p.session_id);
      return x&&["ACTIVE","PAUSED"].includes(x.status)?{session_id:x.id,table_id:x.table_id,game_type:x.game_type}:null;
    }).filter(Boolean);

    return {
      customer_id:customerId,
      name:customer?.name||ownFnbTabs[0]?.customer_name||ownPeople[0]?.name||"CUSTOMER",
      phone:customer?.phone||ownFnbTabs[0]?.customer_phone||ownPeople[0]?.phone||null,
      is_member:Boolean(customer?.is_member),
      player_unbilled_inr:playerUnbilled,
      fnb_unbilled_inr:runningFnbUnbilled,
      unbilled_inr:unbilled,
      billed_due_inr:billedDue,
      current_due_inr:money(unbilled+billedDue),
      active_locations:activeLocations,
      open_fnb_tab_ids:ownFnbTabs.map(t=>t.id),
      charge_count:ownCharges.length+ownRunningFnb.length,
    };
  }).filter(t=>t.current_due_inr>0.009||t.active_locations.length||t.open_fnb_tab_ids.length).sort((a,b)=>b.current_due_inr-a.current_due_inr);

  return json(res,200,{tabs});
}

async function finalizePlayerTab(req,res,customerId){
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=getSupabaseAdmin();
  const key=idempotencyKey(req);
  const old=await previousIdempotent(supabase,key,"finalize_club_tab");
  if(old)return json(res,200,old);

  const {data:customer,error:customerError}=await supabase.from("snooker_customers").select("*").eq("id",customerId).maybeSingle();
  if(customerError)throw customerError;
  if(!customer)return json(res,404,{ok:false,error:"CUSTOMER_NOT_FOUND"});

  const [{data:people,error:pe},{data:openFnbTabs,error:fte}] = await Promise.all([
    supabase.from("snooker_session_people").select("id,session_id").eq("customer_id",customerId),
    supabase.from("snooker_fnb_tabs").select("*").eq("customer_id",customerId).eq("status","OPEN").order("opened_at"),
  ]);
  if(pe||fte)throw pe||fte;

  const personIds=(people||[]).map(p=>p.id);
  let charges=[];
  if(personIds.length){
    const q=await supabase.from("snooker_person_charges").select("*").in("person_id",personIds).eq("status","ACTIVE").is("bill_id",null).order("created_at");
    if(q.error)throw q.error;charges=q.data||[];
  }

  const fnbTabIds=(openFnbTabs||[]).map(t=>t.id);
  let runningFnbLines=[];
  if(fnbTabIds.length){
    const q=await supabase.from("snooker_fnb_lines").select("*").in("tab_id",fnbTabIds).eq("status","ACTIVE").is("bill_id",null).order("added_at");
    if(q.error)throw q.error;runningFnbLines=q.data||[];
  }

  if(!(charges||[]).length && !runningFnbLines.length)return json(res,409,{ok:false,error:"NOTHING_TO_BILL"});

  const gameTotal=money((charges||[]).filter(x=>x.charge_type!=="FNB").reduce((sum,x)=>sum+number(x.amount_inr),0));
  const playerFnb=money((charges||[]).filter(x=>x.charge_type==="FNB").reduce((sum,x)=>sum+number(x.amount_inr),0));
  const runningFnb=money(runningFnbLines.reduce((sum,x)=>sum+number(x.line_total_inr),0));
  const fnbTotal=money(playerFnb+runningFnb);
  const total=money(gameTotal+fnbTotal);

  const billId=randomUUID();
  const suffix=billId.replace(/-/g,"").slice(-6).toUpperCase();
  const datePart=new Date().toISOString().slice(2,10).replace(/-/g,"");
  const billNo=`QC-${datePart}-${suffix}`;

  const {data:bill,error}=await supabase.from("snooker_bills").insert({
    id:billId,bill_no:billNo,session_id:null,source_session_id:null,person_id:null,customer_id:customerId,
    bill_source:"PLAYER_ACCOUNT",customer_name:customer.name,customer_phone:customer.phone,
    game_total_inr:gameTotal,fnb_total_inr:fnbTotal,discount_inr:0,total_inr:total,paid_inr:0,due_inr:total,
    status:total<=0?"PAID":"UNPAID",revision:"1",finalized_by:auth.staff_id,idempotency_key:key||null
  }).select("*").single();
  if(error)throw error;

  const chargeItems=(charges||[]).map(ch=>({
    bill_id:billId,
    item_type:ch.charge_type==="FNB"?"FNB":ch.charge_type==="TABLE"?"TABLE_TIME":"GAME",
    reference_id:ch.reference_id,
    description:ch.description,
    quantity:1,
    unit_price_inr:money(ch.amount_inr),
    line_total_inr:money(ch.amount_inr),
    metadata:{person_id:ch.person_id,session_id:ch.session_id,charge_id:ch.id,...(ch.metadata||{})}
  }));
  const runningItems=runningFnbLines.map(line=>({
    bill_id:billId,
    item_type:"FNB",
    reference_id:line.id,
    description:line.item_name_snapshot,
    quantity:number(line.quantity),
    unit_price_inr:money(line.unit_price_snapshot_inr),
    line_total_inr:money(line.line_total_inr),
    metadata:{item_id:line.item_id,source:"RUNNING_FNB_TAB",tab_id:line.tab_id}
  }));
  const items=[...chargeItems,...runningItems];
  if(items.length){
    const ie=await supabase.from("snooker_bill_items").insert(items);
    if(ie.error)throw ie.error;
  }

  const chargeIds=(charges||[]).map(x=>x.id);
  if(chargeIds.length)await supabase.from("snooker_person_charges").update({bill_id:billId}).in("id",chargeIds);

  const playerFnbIds=(charges||[]).filter(x=>x.charge_type==="FNB"&&x.reference_id).map(x=>x.reference_id);
  const runningFnbIds=runningFnbLines.map(x=>x.id);
  const allFnbIds=[...new Set([...playerFnbIds,...runningFnbIds])];
  if(allFnbIds.length)await supabase.from("snooker_fnb_lines").update({bill_id:billId}).in("id",allFnbIds);

  if(fnbTabIds.length){
    const now=new Date().toISOString();
    await supabase.from("snooker_fnb_tabs").update({
      status:"CLOSED",linked_bill_id:billId,closed_at:now,closed_by:auth.staff_id,updated_at:now
    }).in("id",fnbTabIds);
  }

  const response=await billDetailPayload(supabase,billId);
  await rememberIdempotent(supabase,key,"finalize_club_tab",billId,response);
  return json(res,201,response);
}

async function bootstrap(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const [tables, rules] = await Promise.all([getTables(supabase), getRules(supabase)]);
  return json(res, 200, {
    api_version: API_VERSION,
    club: {
      id: "the-q-club-pasighat",
      name: "The Q Club Pasighat",
      currency: CURRENCY,
    },
    tables: tables.map(tableDto),
    active_game_types: rules.map((r) => r.game_type),
    game_rules: rules.map(ruleDto),
    rules_version: "2026-09-21-1",
    catalogue_version: "2026-09-21-1",
    role: auth.role,
  });
}

async function gameRules(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const rules = await getRules(getSupabaseAdmin());
  return json(res, 200, { rules: rules.map(ruleDto), game_rules: rules.map(ruleDto), version: "2026-09-21-1" });
}

function catalogueDto(row) {
  const price = row.selling_price_inr == null ? null : money(row.selling_price_inr);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    selling_price_inr: price,
    cost_price_inr: row.cost_price_inr == null ? null : money(row.cost_price_inr),
    track_inventory: row.track_inventory,
    current_stock: row.current_stock == null ? null : number(row.current_stock),
    low_stock_threshold: row.low_stock_threshold == null ? null : number(row.low_stock_threshold),
    active: row.active,
    description: row.description || "",
    image_url: row.image_url || "",
    image_path: row.image_path || "",
    qlounge_category_key: row.qlounge_category_key || "",
    show_on_qlounge: Boolean(row.show_on_qlounge),
    online_order_enabled: Boolean(row.online_order_enabled),
    sell_in_ledger: row.sell_in_ledger !== false,
    display_order: number(row.display_order),
    requires_price_configuration: price == null || price <= 0,
    is_unpriced: price == null || price <= 0,
  };
}

async function catalogue(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("snooker_catalogue_items")
    .select("*")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  const items = (data || []).map(catalogueDto);
  return json(res, 200, { items, catalogue: items, version: "2026-09-21-1" });
}

async function publicCatalogue(req, res) {
  const supabase = getSupabaseAdmin();
  const [{ data: categories, error: categoryError }, { data: rows, error: itemError }] = await Promise.all([
    supabase
      .from("qclub_fnb_categories")
      .select("*")
      .eq("active", true)
      .order("sort_order")
      .order("title"),
    supabase
      .from("snooker_catalogue_items")
      .select("*")
      .eq("active", true)
      .eq("show_on_qlounge", true)
      .order("display_order")
      .order("name"),
  ]);
  if (categoryError || itemError) throw categoryError || itemError;

  const menuCatalog = {};
  for (const category of categories || []) {
    menuCatalog[category.category_key] = {
      title: category.title,
      image: category.image_url || "",
      imagePath: category.image_path || "",
      items: [],
    };
  }

  for (const row of rows || []) {
    const key = row.qlounge_category_key;
    if (!key || !menuCatalog[key]) continue;
    const price = row.selling_price_inr == null ? null : money(row.selling_price_inr);
    if (price == null || price <= 0) continue;
    const inStock = !row.track_inventory || number(row.current_stock) > 0;
    menuCatalog[key].items.push({
      id: row.id,
      name: row.name,
      description: row.description || "",
      price,
      image: row.image_url || "",
      imagePath: row.image_path || "",
      onlineOrderEnabled: Boolean(row.online_order_enabled),
      inStock,
      stockTracked: Boolean(row.track_inventory),
    });
  }

  // Drop empty categories so the public UI never shows blank tabs.
  for (const key of Object.keys(menuCatalog)) {
    if (!menuCatalog[key].items.length) delete menuCatalog[key];
  }

  return json(res, 200, {
    ok: true,
    source: "qclub_fnb_master",
    menuCatalog,
    updated_at: new Date().toISOString(),
  });
}

async function catalogueCategories(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { data, error } = await getSupabaseAdmin()
    .from("qclub_fnb_categories")
    .select("*")
    .eq("active", true)
    .order("sort_order")
    .order("title");
  if (error) throw error;
  return json(res, 200, {
    categories: (data || []).map((row) => ({
      category_key: row.category_key,
      title: row.title,
      image_url: row.image_url || "",
      image_path: row.image_path || "",
      sort_order: number(row.sort_order),
      active: row.active,
    })),
  });
}

async function createCatalogueItem(req, res) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();

  const name = safeText(req.body?.name || "", 160).trim();
  const category = safeText(req.body?.category || "OTHER", 80).trim().toUpperCase() || "OTHER";
  const unit = safeText(req.body?.unit || "unit", 40).trim() || "unit";
  const sellingPrice = Number(req.body?.selling_price_inr ?? req.body?.sellingPriceInr);
  const rawCost = req.body?.cost_price_inr ?? req.body?.costPriceInr;
  const costPrice = rawCost == null || String(rawCost).trim() === "" ? null : Number(rawCost);
  const trackInventory = Boolean(req.body?.track_inventory ?? req.body?.trackInventory ?? false);
  const openingStock = trackInventory ? Number(req.body?.opening_stock ?? req.body?.openingStock ?? 0) : null;
  const lowStockThreshold = trackInventory ? Number(req.body?.low_stock_threshold ?? req.body?.lowStockThreshold ?? 5) : null;

  if (!name) return json(res, 400, { ok: false, error: "ITEM_NAME_REQUIRED" });
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return json(res, 400, { ok: false, error: "VALID_SELLING_PRICE_REQUIRED" });
  }
  if (costPrice != null && (!Number.isFinite(costPrice) || costPrice < 0)) {
    return json(res, 400, { ok: false, error: "INVALID_COST_PRICE" });
  }
  if (trackInventory && (!Number.isFinite(openingStock) || openingStock < 0)) {
    return json(res, 400, { ok: false, error: "INVALID_OPENING_STOCK" });
  }
  if (trackInventory && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
    return json(res, 400, { ok: false, error: "INVALID_LOW_STOCK_THRESHOLD" });
  }

  const { data: existingByName, error: existingError } = await supabase
    .from("snooker_catalogue_items")
    .select("*")
    .eq("name", name)
    .maybeSingle();
  if (existingError) throw existingError;

  const showOnQlounge = Boolean(req.body?.show_on_qlounge ?? req.body?.showOnQlounge ?? false);
  const onlineOrderEnabled = showOnQlounge && Boolean(req.body?.online_order_enabled ?? req.body?.onlineOrderEnabled ?? false);
  const sellInLedger = req.body?.sell_in_ledger == null && req.body?.sellInLedger == null
    ? true
    : Boolean(req.body?.sell_in_ledger ?? req.body?.sellInLedger);
  const qloungeCategoryKey = safeText(req.body?.qlounge_category_key || req.body?.qloungeCategoryKey || "", 120) || null;
  const description = safeText(req.body?.description || "", 1200);
  const imageUrl = safeText(req.body?.image_url || req.body?.imageUrl || "", 2000);
  const imagePath = safeText(req.body?.image_path || req.body?.imagePath || "", 1000);

  if (showOnQlounge && !qloungeCategoryKey) {
    return json(res, 400, { ok: false, error: "QLOUNGE_CATEGORY_REQUIRED" });
  }

  const values = {
    name,
    category,
    unit,
    selling_price_inr: money(sellingPrice),
    cost_price_inr: costPrice == null ? null : money(costPrice),
    track_inventory: trackInventory,
    current_stock: trackInventory ? openingStock : null,
    low_stock_threshold: trackInventory ? lowStockThreshold : null,
    description,
    image_url: imageUrl || null,
    image_path: imagePath || null,
    qlounge_category_key: qloungeCategoryKey,
    show_on_qlounge: showOnQlounge,
    online_order_enabled: onlineOrderEnabled,
    sell_in_ledger: sellInLedger,
    display_order: Math.max(0, Math.floor(number(req.body?.display_order ?? req.body?.displayOrder, 100))),
    active: true,
    source: "qclub_ledger_admin",
    updated_at: new Date().toISOString(),
  };

  let saved = null;
  if (existingByName) {
    if (existingByName.active) {
      return json(res, 409, { ok: false, error: "ITEM_NAME_EXISTS", item_id: existingByName.id });
    }
    const { data, error } = await supabase
      .from("snooker_catalogue_items")
      .update(values)
      .eq("id", existingByName.id)
      .select("*")
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const itemId = `ledger_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const { data, error } = await supabase
      .from("snooker_catalogue_items")
      .insert({
        id: itemId,
        ...values,
        sort_order: 100,
        source_ref: null,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return json(res, 409, { ok: false, error: "ITEM_NAME_EXISTS" });
      }
      throw error;
    }
    saved = data;
  }

  return json(res, 201, { ok: true, item: catalogueDto(saved) });
}

async function updateCatalogueItem(req, res, itemId) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const safeItemId = safeText(itemId || "", 160);
  if (!safeItemId) return json(res, 400, { ok: false, error: "ITEM_ID_REQUIRED" });

  const { data: existing, error: fetchError } = await supabase
    .from("snooker_catalogue_items")
    .select("*")
    .eq("id", safeItemId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json(res, 404, { ok: false, error: "ITEM_NOT_FOUND" });

  const next = {};
  if (req.body?.name != null) {
    const name = safeText(req.body.name, 160).trim();
    if (!name) return json(res, 400, { ok: false, error: "ITEM_NAME_REQUIRED" });
    next.name = name;
  }
  if (req.body?.category != null) next.category = safeText(req.body.category, 80).trim().toUpperCase() || "OTHER";
  if (req.body?.unit != null) next.unit = safeText(req.body.unit, 40).trim() || "unit";
  if (req.body?.selling_price_inr != null) {
    const price = Number(req.body.selling_price_inr);
    if (!Number.isFinite(price) || price <= 0) return json(res, 400, { ok: false, error: "VALID_SELLING_PRICE_REQUIRED" });
    next.selling_price_inr = money(price);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "cost_price_inr")) {
    const raw = req.body.cost_price_inr;
    if (raw == null || String(raw).trim() === "") next.cost_price_inr = null;
    else {
      const cost = Number(raw);
      if (!Number.isFinite(cost) || cost < 0) return json(res, 400, { ok: false, error: "INVALID_COST_PRICE" });
      next.cost_price_inr = money(cost);
    }
  }
  if (req.body?.description != null) next.description = safeText(req.body.description, 1200);
  if (req.body?.image_url != null) next.image_url = safeText(req.body.image_url, 2000) || null;
  if (req.body?.image_path != null) next.image_path = safeText(req.body.image_path, 1000) || null;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "qlounge_category_key")) {
    next.qlounge_category_key = safeText(req.body.qlounge_category_key || "", 120) || null;
  }
  if (req.body?.show_on_qlounge != null) next.show_on_qlounge = Boolean(req.body.show_on_qlounge);
  if (req.body?.online_order_enabled != null) next.online_order_enabled = Boolean(req.body.online_order_enabled);
  if (req.body?.sell_in_ledger != null) next.sell_in_ledger = Boolean(req.body.sell_in_ledger);
  if (req.body?.display_order != null) next.display_order = Math.max(0, Math.floor(number(req.body.display_order, 0)));

  const showOnQlounge = Object.prototype.hasOwnProperty.call(next, "show_on_qlounge")
    ? next.show_on_qlounge
    : Boolean(existing.show_on_qlounge);
  const categoryKey = Object.prototype.hasOwnProperty.call(next, "qlounge_category_key")
    ? next.qlounge_category_key
    : existing.qlounge_category_key;
  if (showOnQlounge && !categoryKey) {
    return json(res, 400, { ok: false, error: "QLOUNGE_CATEGORY_REQUIRED" });
  }
  if (!showOnQlounge) next.online_order_enabled = false;
  next.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("snooker_catalogue_items")
    .update(next)
    .eq("id", safeItemId)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return json(res, 409, { ok: false, error: "ITEM_NAME_EXISTS" });
    throw error;
  }
  return json(res, 200, { ok: true, item: catalogueDto(data) });
}

async function removeCatalogueItem(req, res, itemId) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const safeItemId = safeText(itemId || "", 160);
  if (!safeItemId) return json(res, 400, { ok: false, error: "ITEM_ID_REQUIRED" });

  const { data: existing, error: fetchError } = await supabase
    .from("snooker_catalogue_items")
    .select("*")
    .eq("id", safeItemId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json(res, 404, { ok: false, error: "ITEM_NOT_FOUND" });
  if (!existing.active) {
    return json(res, 200, { ok: true, removed: true, item_id: safeItemId, already_inactive: true });
  }

  const { error } = await supabase
    .from("snooker_catalogue_items")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", safeItemId);
  if (error) throw error;

  return json(res, 200, {
    ok: true,
    removed: true,
    item_id: safeItemId,
    message: "Item removed from the active Ledger catalogue. Historical bills remain unchanged.",
  });
}

async function inventory(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("snooker_catalogue_items")
    .select("*")
    .eq("active", true)
    .eq("track_inventory", true)
    .order("name");
  if (error) throw error;
  const items = (data || []).map((row) => ({
    item_id: row.id,
    id: row.id,
    name: row.name,
    current_stock: number(row.current_stock),
    low_stock_threshold: row.low_stock_threshold == null ? null : number(row.low_stock_threshold),
    is_low_stock: row.low_stock_threshold != null && number(row.current_stock) <= number(row.low_stock_threshold),
    is_out_of_stock: number(row.current_stock) <= 0,
  }));
  return json(res, 200, { items, inventory: items });
}

function idempotencyKey(req) {
  return safeText(req.body?.idempotency_key || req.headers?.["x-idempotency-key"] || "", 200);
}

async function previousIdempotent(supabase, key, scope) {
  if (!key) return null;
  const { data } = await supabase
    .from("snooker_idempotency")
    .select("*")
    .eq("idempotency_key", key)
    .eq("scope", scope)
    .maybeSingle();
  return data?.response_body || null;
}

async function rememberIdempotent(supabase, key, scope, resourceId, responseBody) {
  if (!key) return;
  const { error } = await supabase.from("snooker_idempotency").upsert({
    idempotency_key: key,
    scope,
    resource_id: resourceId ? String(resourceId) : null,
    response_body: responseBody,
  }, { onConflict: "idempotency_key" });
  if (error && error.code !== "23505") throw error;
}

function compatibleGame(tableType, gameType) {
  if (tableType === "POOL") return gameType === "NORMAL_POOL";
  if (tableType === "MINI_SNOOKER") return ["NORMAL_SNOOKER", "QCHASE_RUMMY", "SIX_BALL_SNOOKER", "TEN_BALL_SNOOKER", "KITTY"].includes(gameType);
  if (tableType === "FULL_SIZE_SNOOKER") {
    return ["NORMAL_SNOOKER", "QCHASE_RUMMY", "SIX_BALL_SNOOKER", "TEN_BALL_SNOOKER", "KITTY"].includes(gameType);
  }
  return false;
}

function sessionDto(row) {
  return {
    id: row.id,
    session_id: row.id,
    table_id: row.table_id,
    game_type: row.game_type,
    status: row.status,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    is_member: row.is_member,
    participant_ids: row.participant_ids || [],
    participant_names: row.participant_names || [],
    account_mode: row.account_mode || "LEGACY",
    match_format: row.match_format || null,
    payment_rule: row.payment_rule || null,
    frame_rate_override_inr: row.frame_rate_override_inr == null ? null : money(row.frame_rate_override_inr),
    shared_hourly_rate_inr: row.shared_hourly_rate_inr == null ? null : money(row.shared_hourly_rate_inr),
    shared_hourly_last_at: row.shared_hourly_last_at || null,
    started_at: row.started_at,
    ended_at: row.ended_at,
    timer_running: row.timer_running,
    timer_started_at: row.timer_started_at || null,
    accumulated_seconds: number(row.accumulated_seconds),
    revision: row.client_revision || row.updated_at,
    updated_at: row.updated_at,
  };
}

async function listSessions(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const scope = safeText(req.query?.scope || "", 30).toLowerCase();
  const requestedLimit = Math.floor(number(req.query?.limit, 100));
  const limit = Math.min(500, Math.max(1, requestedLimit || 100));

  let query = supabase
    .from("snooker_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (scope === "active") {
    query = query.in("status", ["ACTIVE", "PAUSED", "ENDED"]);
  } else if (scope === "open") {
    query = query.in("status", ["ACTIVE", "PAUSED"]);
  }

  const { data, error } = await query;
  if (error) throw error;
  return json(res, 200, { sessions: (data || []).map(sessionDto) });
}

async function createSession(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "create_session");
  if (old) return json(res, 200, old);

  const tableId = safeText(req.body?.table_id || req.body?.tableId || "", 80);
  const gameType = safeText(req.body?.game_type || req.body?.gameType || "", 80).toUpperCase();
  const { data: table } = await supabase.from("snooker_tables").select("*").eq("id", tableId).eq("active", true).maybeSingle();
  const { data: rule } = await supabase.from("snooker_game_rules").select("*").eq("game_type", gameType).eq("active", true).maybeSingle();
  if (!table || !rule) return json(res, 400, { ok: false, error: "INVALID_TABLE_OR_GAME" });
  if (!compatibleGame(table.table_type, gameType)) return json(res, 400, { ok: false, error: "GAME_NOT_ALLOWED_ON_TABLE" });

  const { data: active } = await supabase.from("snooker_sessions").select("id").eq("table_id", tableId).in("status", ["ACTIVE","PAUSED"]).maybeSingle();
  if (active) return json(res,409,{ok:false,error:"TABLE_ALREADY_ACTIVE",session_id:active.id});

  const rawPeople = Array.isArray(req.body?.people) ? req.body.people : [];
  const individual = rawPeople.length > 0 || safeText(req.body?.account_mode || "",30).toUpperCase()==="INDIVIDUAL";
  let people = rawPeople.map((p)=>({
    name:canonicalCustomerName(p?.name || ""),
    phone:normalizePhone(p?.phone || "") || null,
    is_member:Boolean(p?.is_member),
    customer_id:safeText(p?.customer_id || "",100) || null,
    team_no:p?.team_no==null?null:number(p.team_no),
  })).filter((p)=>p.name);
  if(individual && !people.length) return json(res,400,{ok:false,error:"PLAYERS_REQUIRED"});
  if(people.length>6) return json(res,400,{ok:false,error:"MAX_SIX_PLAYERS"});

  let matchFormat=safeText(req.body?.match_format || "",30).toUpperCase() || "FLEX";
  let paymentRule=safeText(req.body?.payment_rule || "",30).toUpperCase();
  if(gameType==="QCHASE_RUMMY"){
    matchFormat="FLEX";
    if(!["PER_PLAYER","HOURLY_SHARED"].includes(paymentRule)) paymentRule="PER_PLAYER";
  }
  if(!paymentRule) paymentRule = rule.billing_mode==="HOURLY" ? "HOURLY" : "PER_PLAYER";
  if(!["FLEX","SINGLES","DOUBLES"].includes(matchFormat)) return json(res,400,{ok:false,error:"INVALID_MATCH_FORMAT"});
  if(!["HOURLY","HOURLY_SHARED","PER_PLAYER","LOSER_PAYS"].includes(paymentRule)) return json(res,400,{ok:false,error:"INVALID_PAYMENT_RULE"});
  if(matchFormat==="SINGLES" && people.length!==2) return json(res,400,{ok:false,error:"SINGLES_REQUIRES_TWO_PLAYERS"});
  if(matchFormat==="DOUBLES" && people.length!==4) return json(res,400,{ok:false,error:"DOUBLES_REQUIRES_FOUR_PLAYERS"});
  if(matchFormat==="DOUBLES"){
    const t1=people.filter((p)=>p.team_no===1).length,t2=people.filter((p)=>p.team_no===2).length;
    if(t1!==2||t2!==2) return json(res,400,{ok:false,error:"DOUBLES_REQUIRES_TWO_PLAYERS_PER_TEAM"});
  }
  if(gameType==="QCHASE_RUMMY" && (people.length<2||people.length>6)) return json(res,400,{ok:false,error:"QCHASE_REQUIRES_TWO_TO_SIX_PLAYERS"});

  if (individual) {
    for (const person of people) {
      try {
        const verified = await verifyMemberRecord(supabase, { phone: person.phone, name: person.name });
        person.is_member = Boolean(verified?.verified);
      } catch {
        person.is_member = false;
      }
    }
  }
  const first=people[0] || null;
  const customerName=individual ? first?.name : (canonicalCustomerName(req.body?.customer_name || req.body?.customerName || "")||null);
  const customerPhone=individual ? first?.phone : (normalizePhone(req.body?.customer_phone || req.body?.customerPhone || "")||null);
  const isMember=Boolean(first?.is_member ?? req.body?.is_member ?? false);

  const sharedHourly = paymentRule === "HOURLY_SHARED";
  const sessionRunsOnTime = rule.billing_mode === "HOURLY" || sharedHourly;
  const sharedHourlyRate = sharedHourly
    ? money(isMember ? table.member_price_per_hour_inr : table.price_per_hour_inr)
    : null;
  if (sharedHourly && !(sharedHourlyRate > 0)) {
    return json(res,409,{ok:false,error:"TABLE_RATE_NOT_CONFIGURED"});
  }

  // Legacy fixed frame_rate_override_inr is intentionally ignored for Normal Snooker
  // LOSER_PAYS. That mode is server-priced from actual active frame time and the
  // losing player's verified member/non-member hourly table rate.
  const frameRate = gameType==="NORMAL_SNOOKER" && paymentRule==="LOSER_PAYS"
    ? null
    : (req.body?.frame_rate_override_inr==null ? null : money(req.body.frame_rate_override_inr));

  const now=new Date().toISOString();
  const {data,error}=await supabase.from("snooker_sessions").insert({
    table_id:tableId,game_type:gameType,customer_name:customerName,customer_phone:customerPhone,is_member:isMember,
    participant_names:individual?people.map((p)=>p.name):(Array.isArray(req.body?.participant_names)?req.body.participant_names:[]),
    participant_ids:[],
    account_mode:individual?"INDIVIDUAL":"LEGACY",
    match_format:individual?matchFormat:null,
    payment_rule:individual?paymentRule:null,
    frame_rate_override_inr:frameRate,
    shared_hourly_rate_inr:sharedHourlyRate,
    shared_hourly_last_at:sharedHourly?now:null,
    started_at:now,timer_started_at:now,timer_running:sessionRunsOnTime,
    created_by:auth.staff_id,updated_by:auth.staff_id,client_revision:safeText(req.body?.client_revision||"",120)||null,idempotency_key:key||null,
  }).select("*").single();
  if(error) throw error;

  let insertedPeople=[];
  if(individual){
    const customerRows=[];
    for (const p of people) {
      try {
        if (p.customer_id) {
          const { data: linked } = await supabase.from("snooker_customers").select("*").eq("id",p.customer_id).eq("active",true).maybeSingle();
          if (linked) { customerRows.push(linked); continue; }
        }
        customerRows.push(await rememberCustomer(supabase,{name:p.name,phone:p.phone,isMember:p.is_member,source:"table_session"}));
      }
      catch { customerRows.push(null); }
    }
    const activeCustomerIds=customerRows.map(c=>c?.id).filter(Boolean);
    if (activeCustomerIds.length) {
      const { data: alreadyActive } = await supabase.from("snooker_session_people").select("customer_id,session_id,status").in("customer_id",activeCustomerIds).eq("status","ACTIVE");
      const other=(alreadyActive||[]).filter(p=>p.session_id!==data.id);
      if(other.length){ await supabase.from("snooker_sessions").delete().eq("id",data.id); return json(res,409,{ok:false,error:"PLAYER_ALREADY_ACTIVE",message:"A selected player is still active on another table. Use Leave Game/Table there before moving the player."}); }
    }
    const rows=people.map((p,index)=>({
      session_id:data.id,customer_id:customerRows[index]?.id||null,name:p.name,phone:p.phone,is_member:p.is_member,team_no:p.team_no,
      status:"ACTIVE",joined_at:now,timer_running:sessionRunsOnTime,timer_started_at:sessionRunsOnTime?now:null,
      created_by:auth.staff_id,updated_by:auth.staff_id,
    }));
    const {data:inserted,error:pe}=await supabase.from("snooker_session_people").insert(rows).select("*");
    if(pe){ await supabase.from("snooker_sessions").delete().eq("id",data.id); throw pe; }
    insertedPeople=inserted||[];
    await supabase.from("snooker_sessions").update({
      participant_ids:insertedPeople.map((p)=>p.id),participant_names:insertedPeople.map((p)=>p.name)
    }).eq("id",data.id);
    data.participant_ids=insertedPeople.map((p)=>p.id);
    data.participant_names=insertedPeople.map((p)=>p.name);

    if(gameType==="QCHASE_RUMMY" && paymentRule==="PER_PLAYER"){
      const rate=money(rule.rate_inr);
      if(!(rate>0)){
        await supabase.from("snooker_session_people").delete().eq("session_id",data.id);
        await supabase.from("snooker_sessions").delete().eq("id",data.id);
        return json(res,409,{ok:false,error:"GAME_RATE_NOT_CONFIGURED"});
      }
      try {
        await createQchaseGameStart(supabase,{
          sessionId:data.id,
          playerRows:insertedPeople,
          rate,
          staffId:auth.staff_id,
          gameNumber:1,
          key:key ? key+":qchase-game-1" : null,
        });
      } catch (chargeError) {
        await supabase.from("snooker_person_charges").delete().eq("session_id",data.id).is("bill_id",null);
        await supabase.from("snooker_completed_games").delete().eq("session_id",data.id);
        await supabase.from("snooker_session_people").delete().eq("session_id",data.id);
        await supabase.from("snooker_sessions").delete().eq("id",data.id);
        throw chargeError;
      }
    }
  }
  if (individual) {
    for (const person of people) {
      try {
        await rememberCustomer(supabase, {
          name: person.name,
          phone: person.phone,
          isMember: person.is_member,
          source: "table_session",
        });
      } catch (customerError) {
        console.error("customer directory remember failed", { source: "table_session", name: person.name, message: customerError?.message });
      }
    }
  } else if (customerName) {
    try {
      await rememberCustomer(supabase, { name: customerName, phone: customerPhone, isMember, source: "table_session" });
    } catch (customerError) {
      console.error("customer directory remember failed", { source: "table_session", name: customerName, message: customerError?.message });
    }
  }

  const response=sessionDto(data);
  await rememberIdempotent(supabase,key,"create_session",data.id,response);
  return json(res,201,response);
}
async function sessionDetail(req,res,sessionId){
  const auth=await requireAuth(req,res); if(!auth)return;
  const supabase=getSupabaseAdmin();
  const {data:session,error}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(error)throw error; if(!session)return json(res,404,{ok:false,error:"SESSION_NOT_FOUND"});
  const [{data:games},{data:fnb},{data:bill},people]=await Promise.all([
    supabase.from("snooker_completed_games").select("*").eq("session_id",sessionId).order("game_number"),
    supabase.from("snooker_fnb_lines").select("*").eq("session_id",sessionId).order("added_at"),
    supabase.from("snooker_bills").select("*").eq("session_id",sessionId).maybeSingle(),
    session.account_mode==="INDIVIDUAL"?individualSessionSnapshot(supabase,sessionId):Promise.resolve([]),
  ]);
  let loserPaysFrameBaseSeconds = 0;
  if (session.game_type === "NORMAL_SNOOKER" && session.payment_rule === "LOSER_PAYS") {
    const lastValidFrame = [...(games || [])].reverse().find((game) =>
      game.status === "COMPLETED" &&
      game.game_type === "NORMAL_SNOOKER" &&
      game.settlement_rule === "LOSER_PAYS"
    );
    loserPaysFrameBaseSeconds = number(lastValidFrame?.session_elapsed_seconds_snapshot, 0);
  }
  return json(res,200,{
    ...sessionDto(session),
    games:games||[],
    fnb_lines:fnb||[],
    bill:bill||null,
    people,
    loser_pays_frame_base_session_seconds:loserPaysFrameBaseSeconds,
  });
}
async function addSessionPerson(req,res,sessionId){
  const auth=await requireAuth(req,res); if(!auth)return;
  const supabase=getSupabaseAdmin();
  const {data:session}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(!session||session.account_mode!=="INDIVIDUAL"||!["ACTIVE","PAUSED"].includes(session.status)) return json(res,409,{ok:false,error:"INDIVIDUAL_SESSION_NOT_ACTIVE"});
  const {count}=await supabase.from("snooker_session_people").select("*",{count:"exact",head:true}).eq("session_id",sessionId).eq("status","ACTIVE");
  if(number(count)>=6)return json(res,409,{ok:false,error:"MAX_SIX_ACTIVE_PLAYERS"});
  const name=canonicalCustomerName(req.body?.name||""); if(!name)return json(res,400,{ok:false,error:"PLAYER_NAME_REQUIRED"});
  const phone=normalizePhone(req.body?.phone||"")||null;
  const teamNo=req.body?.team_no==null?null:number(req.body.team_no);
  if(teamNo!=null && ![1,2].includes(teamNo))return json(res,400,{ok:false,error:"INVALID_TEAM"});
  const now=new Date().toISOString();
  if(session.payment_rule==="HOURLY_SHARED") await settleSharedHourlySlice(supabase,session,now,auth.staff_id,"PLAYER_JOIN");
  let linkedCustomer=null;
  const requestedCustomerId=safeText(req.body?.customer_id || "",100) || null;
  try {
    if(requestedCustomerId){
      const {data:known}=await supabase.from("snooker_customers").select("*").eq("id",requestedCustomerId).eq("active",true).maybeSingle();
      if(known) linkedCustomer=known;
    }
    if(!linkedCustomer) linkedCustomer=await rememberCustomer(supabase,{name,phone,source:"joined_player"});
  } catch {}
  if(linkedCustomer?.id){
    const {data:activeElsewhere}=await supabase.from("snooker_session_people").select("id,session_id").eq("customer_id",linkedCustomer.id).eq("status","ACTIVE").neq("session_id",sessionId).limit(1);
    if((activeElsewhere||[]).length)return json(res,409,{ok:false,error:"PLAYER_ALREADY_ACTIVE",message:"This player is still active on another table. Use Leave Game/Table there first."});
  }
  const {data,error}=await supabase.from("snooker_session_people").insert({
    session_id:sessionId,customer_id:linkedCustomer?.id||null,name,phone,is_member:false,team_no:teamNo,status:"ACTIVE",joined_at:now,
    timer_running:Boolean(session.timer_running),timer_started_at:session.timer_running?now:null,
    created_by:auth.staff_id,updated_by:auth.staff_id
  }).select("*").single();
  if(error)throw error;

  let entryCharge=null;
  let entryGameNumber=null;
  if(session.game_type==="QCHASE_RUMMY" && session.payment_rule==="PER_PLAYER"){
    try {
      const {data:rule}=await supabase.from("snooker_game_rules").select("*").eq("game_type","QCHASE_RUMMY").eq("active",true).maybeSingle();
      const rate=money(rule?.rate_inr);
      if(!(rate>0)) throw Object.assign(new Error("QChase/Rummy rate is not configured."),{status:409,code:"GAME_RATE_NOT_CONFIGURED"});
      entryGameNumber=await qchaseNextGameNumber(supabase,sessionId);
      entryCharge=await ensureQchasePrepaidEntryCharge(supabase,{
        sessionId,
        person:data,
        gameNumber:entryGameNumber,
        rate,
        staffId:auth.staff_id,
        reason:"JOIN",
      });
    } catch (chargeError) {
      await supabase.from("snooker_session_people").delete().eq("id",data.id);
      throw chargeError;
    }
  }

  const {data:all}=await supabase.from("snooker_session_people").select("id,name").eq("session_id",sessionId).order("joined_at");
  await supabase.from("snooker_sessions").update({participant_ids:(all||[]).map(p=>p.id),participant_names:(all||[]).map(p=>p.name),updated_at:now}).eq("id",sessionId);
  try {
    await rememberCustomer(supabase, { name, phone, source: "joined_player" });
  } catch (customerError) {
    console.error("customer directory remember failed", { source: "joined_player", name, message: customerError?.message });
  }
  return json(res,201,{
    ...data,
    entry_charge_inr: entryCharge ? money(entryCharge.amount_inr) : 0,
    entry_game_number: entryGameNumber,
    qchase_charged_on_join: Boolean(entryCharge),
  });
}

async function updateSessionPerson(req,res,sessionId,personId){
  const auth=await requireAuth(req,res); if(!auth)return;
  const supabase=getSupabaseAdmin();
  const {data:person}=await supabase.from("snooker_session_people").select("*").eq("id",personId).eq("session_id",sessionId).maybeSingle();
  if(!person)return json(res,404,{ok:false,error:"PLAYER_NOT_FOUND"});
  const {data:session}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  const action=safeText(req.body?.action||"",30).toUpperCase();
  const now=new Date();
  if(session?.payment_rule==="HOURLY_SHARED" && (action==="LEAVE" || action==="REJOIN")){
    await settleSharedHourlySlice(supabase,session,now,auth.staff_id,action==="LEAVE"?"PLAYER_LEAVE":"PLAYER_REJOIN");
    session.shared_hourly_last_at=now.toISOString();
  }
  const patch={updated_by:auth.staff_id,updated_at:now.toISOString()};
  if(req.body?.name!==undefined)patch.name=canonicalCustomerName(req.body.name)||person.name;
  if(req.body?.phone!==undefined)patch.phone=normalizePhone(req.body.phone)||null;
  if(req.body?.team_no!==undefined)patch.team_no=req.body.team_no==null?null:number(req.body.team_no);
  if(action==="LEAVE"){
    patch.accumulated_seconds=personElapsedSeconds(person,now);patch.timer_running=false;patch.timer_started_at=null;patch.status="LEFT";patch.left_at=now.toISOString();
  }else if(action==="REJOIN"){
    patch.status="ACTIVE";patch.left_at=null;patch.timer_running=Boolean(session?.timer_running);patch.timer_started_at=session?.timer_running?now.toISOString():null;
  }
  const {data,error}=await supabase.from("snooker_session_people").update(patch).eq("id",personId).select("*").single();
  if(error)throw error;
  let rejoinCharge=null;
  let rejoinGameNumber=null;
  if(action==="REJOIN" && session?.game_type==="QCHASE_RUMMY" && session?.payment_rule==="PER_PLAYER"){
    try {
      const {data:rule}=await supabase.from("snooker_game_rules").select("*").eq("game_type","QCHASE_RUMMY").eq("active",true).maybeSingle();
      const rate=money(rule?.rate_inr);
      if(!(rate>0)) throw Object.assign(new Error("QChase/Rummy rate is not configured."),{status:409,code:"GAME_RATE_NOT_CONFIGURED"});
      rejoinGameNumber=await qchaseNextGameNumber(supabase,sessionId);
      rejoinCharge=await ensureQchasePrepaidEntryCharge(supabase,{
        sessionId,
        person:data,
        gameNumber:rejoinGameNumber,
        rate,
        staffId:auth.staff_id,
        reason:"REJOIN",
      });
    } catch (chargeError) {
      await supabase.from("snooker_session_people").update({
        status: person.status,
        left_at: person.left_at,
        accumulated_seconds: person.accumulated_seconds,
        timer_running: person.timer_running,
        timer_started_at: person.timer_started_at,
        updated_at: new Date().toISOString(),
        updated_by: auth.staff_id,
      }).eq("id",personId);
      throw chargeError;
    }
  }
  try {
    await rememberCustomer(supabase, { name: data.name, phone: data.phone, isMember: data.is_member, source: "player_update" });
  } catch (customerError) {
    console.error("customer directory remember failed", { source: "player_update", name: data.name, message: customerError?.message });
  }
  return json(res,200,{
    ...data,
    entry_charge_inr: rejoinCharge ? money(rejoinCharge.amount_inr) : 0,
    entry_game_number: rejoinGameNumber,
    qchase_charged_on_rejoin: Boolean(rejoinCharge),
  });
}

async function allocateHourlySession(req,res,sessionId){
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=getSupabaseAdmin();
  const {data:session}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(!session||session.account_mode!=="INDIVIDUAL"||session.payment_rule!=="HOURLY")return json(res,409,{ok:false,error:"HOURLY_INDIVIDUAL_SESSION_REQUIRED"});
  const {data:already}=await supabase.from("snooker_person_charges").select("id,bill_id").eq("session_id",sessionId).eq("charge_type","TABLE").eq("status","ACTIVE");
  if((already||[]).some(x=>x.bill_id))return json(res,409,{ok:false,error:"TABLE_CHARGE_ALREADY_BILLED"});
  if((already||[]).length)await supabase.from("snooker_person_charges").delete().eq("session_id",sessionId).eq("charge_type","TABLE").is("bill_id",null);
  const [{data:table},{data:people}]=await Promise.all([
    supabase.from("snooker_tables").select("*").eq("id",session.table_id).maybeSingle(),
    supabase.from("snooker_session_people").select("*").eq("session_id",sessionId).order("joined_at"),
  ]);
  const seconds=elapsedSeconds(session),rate=money(session.is_member?table?.member_price_per_hour_inr:table?.price_per_hour_inr);
  if(!(rate>0))return json(res,409,{ok:false,error:"TABLE_RATE_NOT_CONFIGURED"});
  const total=money(seconds/3600*rate);
  const eligible=(people||[]).filter(p=>personElapsedSeconds(p)>0);
  if(!eligible.length)return json(res,409,{ok:false,error:"NO_PLAYERS_TO_ALLOCATE"});
  const strategy=safeText(req.body?.strategy||"BY_TIME",30).toUpperCase();
  let weights=[];
  if(strategy==="ONE"){
    const payer=safeText(req.body?.payer_person_id||"",100);const p=eligible.find(x=>x.id===payer);if(!p)return json(res,400,{ok:false,error:"PAYER_REQUIRED"});
    weights=eligible.map(x=>x.id===payer?1:0);
  }else if(strategy==="EQUAL"){weights=eligible.map(()=>1);}
  else {weights=eligible.map(p=>Math.max(1,personElapsedSeconds(p)));}
  const weightTotal=weights.reduce((a,b)=>a+b,0);let allocated=0;const rows=[];
  for(let i=0;i<eligible.length;i++){
    let amount=i===eligible.length-1?money(total-allocated):money(total*weights[i]/weightTotal);
    if(weights[i]===0)amount=0;
    allocated=money(allocated+amount);
    if(amount>0)rows.push({person:eligible[i],amount});
  }
  for(const row of rows)await createPersonCharge(supabase,{sessionId,personId:row.person.id,type:"TABLE",referenceId:sessionId,description:"Table time — "+Math.round(seconds/60)+" min",amount:row.amount,staffId:auth.staff_id,metadata:{strategy,hourly_rate_inr:rate,elapsed_seconds:seconds}});
  return json(res,200,{ok:true,total_inr:total,strategy,allocations:rows.map(r=>({person_id:r.person.id,name:r.person.name,amount_inr:r.amount}))});
}

async function finalizePersonBill(req,res,sessionId,personId){
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=getSupabaseAdmin();const key=idempotencyKey(req);
  const old=await previousIdempotent(supabase,key,"finalize_person_bill");if(old)return json(res,200,old);
  const [{data:person},{data:session},{data:charges}]=await Promise.all([
    supabase.from("snooker_session_people").select("*").eq("id",personId).eq("session_id",sessionId).maybeSingle(),
    supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle(),
    supabase.from("snooker_person_charges").select("*").eq("session_id",sessionId).eq("person_id",personId).eq("status","ACTIVE").is("bill_id",null).order("created_at"),
  ]);
  if(!person||!session)return json(res,404,{ok:false,error:"PLAYER_OR_SESSION_NOT_FOUND"});
  if(!(charges||[]).length)return json(res,409,{ok:false,error:"NOTHING_TO_BILL"});
  const gameTotal=money((charges||[]).filter(x=>x.charge_type!=="FNB").reduce((s,x)=>s+number(x.amount_inr),0));
  const fnbTotal=money((charges||[]).filter(x=>x.charge_type==="FNB").reduce((s,x)=>s+number(x.amount_inr),0));
  const total=money(gameTotal+fnbTotal);
  const billId=randomUUID(),suffix=billId.replace(/-/g,"").slice(-6).toUpperCase(),datePart=new Date().toISOString().slice(2,10).replace(/-/g,"");
  const billNo=`QP-${datePart}-${suffix}`;
  const {data:bill,error}=await supabase.from("snooker_bills").insert({
    id:billId,bill_no:billNo,session_id:null,source_session_id:sessionId,person_id:personId,customer_id:person.customer_id||null,bill_source:"PLAYER_ACCOUNT",
    customer_name:canonicalCustomerName(person.name),customer_phone:person.phone,game_total_inr:gameTotal,fnb_total_inr:fnbTotal,discount_inr:0,total_inr:total,paid_inr:0,due_inr:total,status:total<=0?"PAID":"UNPAID",revision:"1",finalized_by:auth.staff_id,idempotency_key:key||null
  }).select("*").single();if(error)throw error;
  const items=(charges||[]).map(ch=>({bill_id:billId,item_type:ch.charge_type==="FNB"?"FNB":ch.charge_type==="TABLE"?"TABLE_TIME":"GAME",reference_id:ch.reference_id,description:ch.description,quantity:1,unit_price_inr:money(ch.amount_inr),line_total_inr:money(ch.amount_inr),metadata:{person_id:personId,charge_id:ch.id,...(ch.metadata||{})}}));
  if(items.length){const {error:ie}=await supabase.from("snooker_bill_items").insert(items);if(ie)throw ie;}
  const ids=(charges||[]).map(x=>x.id);await supabase.from("snooker_person_charges").update({bill_id:billId}).in("id",ids);
  const fnbIds=(charges||[]).filter(x=>x.charge_type==="FNB"&&x.reference_id).map(x=>x.reference_id);if(fnbIds.length)await supabase.from("snooker_fnb_lines").update({bill_id:billId}).in("id",fnbIds);
  const response=await billDetailPayload(supabase,billId);await rememberIdempotent(supabase,key,"finalize_person_bill",billId,response);return json(res,201,response);
}

function elapsedSeconds(session, at = new Date()) {
  let seconds = number(session.accumulated_seconds);
  if (session.timer_running && session.timer_started_at) {
    const start = Date.parse(session.timer_started_at);
    const end = at.getTime();
    if (Number.isFinite(start) && end > start) seconds += Math.floor((end - start) / 1000);
  }
  return Math.max(0, seconds);
}

async function updateSession(req,res,sessionId){
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=getSupabaseAdmin();const {data:current}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(!current)return json(res,404,{ok:false,error:"SESSION_NOT_FOUND"});
  const action=safeText(req.body?.action||"",50).toUpperCase(),patch={updated_by:auth.staff_id,updated_at:new Date().toISOString()};
  if(Array.isArray(req.body?.participant_ids))patch.participant_ids=req.body.participant_ids;
  if(Array.isArray(req.body?.participant_names))patch.participant_names=req.body.participant_names;
  if(req.body?.customer_name!==undefined)patch.customer_name=safeText(req.body.customer_name,160)||null;
  if(req.body?.customer_phone!==undefined)patch.customer_phone=normalizePhone(req.body.customer_phone)||null;
  const now=new Date();
  if(current.payment_rule==="HOURLY_SHARED" && current.timer_running && (action==="PAUSE" || action==="END" || safeText(req.body?.status||"").toUpperCase()==="ENDED")){
    await settleSharedHourlySlice(supabase,current,now,auth.staff_id,action==="PAUSE"?"TABLE_PAUSE":"TABLE_END");
    current.shared_hourly_last_at=now.toISOString();
  }
  if(action==="PAUSE"&&current.timer_running){patch.accumulated_seconds=elapsedSeconds(current,now);patch.timer_running=false;patch.status="PAUSED";if(current.account_mode==="INDIVIDUAL")await syncActivePersonTimers(supabase,sessionId,"PAUSE",now);}
  else if(action==="RESUME"&&!current.timer_running){patch.timer_started_at=now.toISOString();patch.timer_running=true;patch.status="ACTIVE";if(current.payment_rule==="HOURLY_SHARED")patch.shared_hourly_last_at=now.toISOString();if(current.account_mode==="INDIVIDUAL")await syncActivePersonTimers(supabase,sessionId,"RESUME",now);}
  else if(action==="END"||safeText(req.body?.status||"").toUpperCase()==="ENDED"){patch.accumulated_seconds=elapsedSeconds(current,now);patch.timer_running=false;patch.status="ENDED";patch.ended_at=now.toISOString();if(current.account_mode==="INDIVIDUAL")await syncActivePersonTimers(supabase,sessionId,"PAUSE",now);}
  else if(action==="CLOSE" && current.account_mode==="INDIVIDUAL"){
    const people=await individualSessionSnapshot(supabase,sessionId);
    const due=people.filter(p=>number(p.current_due_inr)>0.009);
    if(due.length)return json(res,409,{ok:false,error:"PLAYER_BALANCES_DUE",players:due.map(p=>({person_id:p.person_id,name:p.name,due_inr:p.current_due_inr}))});
    patch.timer_running=false;patch.status="FINALIZED";patch.ended_at=current.ended_at||now.toISOString();
  }
  const {data,error}=await supabase.from("snooker_sessions").update(patch).eq("id",sessionId).select("*").single();if(error)throw error;return json(res,200,sessionDto(data));
}
async function recordGame(req,res,sessionId){
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=getSupabaseAdmin();const key=idempotencyKey(req);const old=await previousIdempotent(supabase,key,"record_game");if(old)return json(res,200,old);
  const {data:session}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(!session||!["ACTIVE","PAUSED"].includes(session.status))return json(res,409,{ok:false,error:"SESSION_NOT_ACTIVE"});
  const {data:rule}=await supabase.from("snooker_game_rules").select("*").eq("game_type",session.game_type).maybeSingle();
  if(session.account_mode!=="INDIVIDUAL"){
    if(!rule||rule.billing_mode!=="PER_PLAYER_PER_GAME")return json(res,400,{ok:false,error:"GAME_COMPLETION_NOT_USED_FOR_THIS_MODE"});
    const playerIds=Array.isArray(req.body?.player_ids)?req.body.player_ids:(session.participant_ids||[]);
    const playerNames=Array.isArray(req.body?.player_names)?req.body.player_names:(session.participant_names||[]);
    const count=Math.max(playerIds.length,playerNames.length,number(req.body?.player_count,0));if(count<=0)return json(res,400,{ok:false,error:"PLAYERS_REQUIRED"});
    const {data:last}=await supabase.from("snooker_completed_games").select("game_number").eq("session_id",sessionId).order("game_number",{ascending:false}).limit(1).maybeSingle();
    const gameNumber=number(last?.game_number,0)+1,rate=money(rule.rate_inr),charge=money(rate*count);
    const {data,error}=await supabase.from("snooker_completed_games").insert({session_id:sessionId,game_number:gameNumber,game_type:session.game_type,billing_mode:rule.billing_mode,rate_snapshot_inr:rate,player_ids:playerIds,player_names:playerNames,player_count_snapshot:count,calculated_charge_inr:charge,completed_by:auth.staff_id,idempotency_key:key||null}).select("*").single();if(error)throw error;
    const response={...data,game_id:data.id};await rememberIdempotent(supabase,key,"record_game",data.id,response);return json(res,201,response);
  }
  if (session.game_type === "KITTY") {
    const selectedIds = Array.isArray(req.body?.player_ids) ? req.body.player_ids.map(String) : [];
    if (selectedIds.length < 2 || selectedIds.length > 6) return json(res,400,{ok:false,error:"KITTY_REQUIRES_TWO_TO_SIX_PLAYERS"});
    const { data: people } = await supabase.from("snooker_session_people").select("*").eq("session_id",sessionId).in("id",selectedIds).eq("status","ACTIVE");
    if ((people || []).length !== selectedIds.length) return json(res,400,{ok:false,error:"INVALID_PLAYER_SELECTION"});
    const noWinner = Boolean(req.body?.kitty_no_winner);
    const winnerId = safeText(req.body?.winner_person_id || "",100);
    if (!noWinner && (!winnerId || !selectedIds.includes(winnerId))) return json(res,400,{ok:false,error:"KITTY_WINNER_REQUIRED"});
    const [{ data: priorGames }, { data: table }] = await Promise.all([
      supabase.from("snooker_completed_games").select("*").eq("session_id",sessionId).eq("status","COMPLETED").order("completed_at"),
      supabase.from("snooker_tables").select("*").eq("id",session.table_id).maybeSingle(),
    ]);
    const lastWinner = [...(priorGames || [])].reverse().find((g)=>Array.isArray(g.winner_person_ids)&&g.winner_person_ids.length);
    const chainStartMs = Date.parse(lastWinner?.completed_at || session.started_at || "");
    const now = new Date();
    const chainSeconds = Number.isFinite(chainStartMs) ? Math.max(0,Math.floor((now.getTime()-chainStartMs)/1000)) : 0;
    const rate = money(table?.price_per_hour_inr);
    if (!(rate > 0)) return json(res,409,{ok:false,error:"KITTY_RATE_NOT_CONFIGURED"});
    const rawWinnerCharge = Math.max(100,(chainSeconds/3600)*rate);
    const winnerCharge = noWinner ? 0 : Math.max(100, Math.round(rawWinnerCharge / 10) * 10);
    const gameNumber = number((priorGames || []).slice(-1)[0]?.game_number,0)+1;
    const names = selectedIds.map((id)=>(people||[]).find((p)=>p.id===id)?.name||"Player");
    const allocations = noWinner ? [] : [{person_id:winnerId,amount_inr:winnerCharge}];
    const { data: game, error } = await supabase.from("snooker_completed_games").insert({
      session_id:sessionId,game_number:gameNumber,game_type:"KITTY",billing_mode:"HOURLY",rate_snapshot_inr:rate,
      player_ids:selectedIds,player_names:names,player_count_snapshot:selectedIds.length,calculated_charge_inr:winnerCharge,
      settlement_rule:"WINNER_PAYS_TIME",match_format:"FLEX",winner_person_ids:noWinner?[]:[winnerId],loser_person_ids:[],
      charge_allocations:allocations,completed_at:now.toISOString(),completed_by:auth.staff_id,idempotency_key:key||null
    }).select("*").single();
    if (error) throw error;
    if (!noWinner) {
      const winner=(people||[]).find((p)=>p.id===winnerId);
      await createPersonCharge(supabase,{sessionId,personId:winnerId,type:"GAME",referenceId:game.id,description:"Kitty — winner pays "+Math.round(chainSeconds/60)+" min",amount:winnerCharge,staffId:auth.staff_id,metadata:{game_number:gameNumber,kitty:true,chain_seconds:chainSeconds,hourly_rate_inr:rate,minimum_inr:100,rounding:"NEAREST_10",raw_charge_inr:money(rawWinnerCharge),person_name:winner?.name}});
    }
    const response={...game,game_id:game.id,kitty_no_winner:noWinner,kitty_chain_seconds:chainSeconds,winner_charge_inr:winnerCharge,charge_allocations:allocations};
    await rememberIdempotent(supabase,key,"record_game",game.id,response);
    return json(res,201,response);
  }
  if(session.game_type==="QCHASE_RUMMY" && session.payment_rule==="PER_PLAYER"){
    const selectedIds=Array.isArray(req.body?.player_ids)?req.body.player_ids.map(String):[];
    if(selectedIds.length<2 || selectedIds.length>6)return json(res,400,{ok:false,error:"QCHASE_GAME_REQUIRES_TWO_TO_SIX_PLAYERS"});
    const {data:people,error:peopleError}=await supabase.from("snooker_session_people").select("*").eq("session_id",sessionId).in("id",selectedIds).eq("status","ACTIVE");
    if(peopleError)throw peopleError;
    if((people||[]).length!==selectedIds.length)return json(res,400,{ok:false,error:"INVALID_PLAYER_SELECTION"});
    const rate=money(rule?.rate_inr);
    if(!(rate>0))return json(res,409,{ok:false,error:"GAME_RATE_NOT_CONFIGURED"});
    const gameNumber=await qchaseNextGameNumber(supabase,sessionId);
    const response=await createQchaseGameStart(supabase,{
      sessionId,
      playerRows:people||[],
      rate,
      staffId:auth.staff_id,
      gameNumber,
      key:key||null,
    });
    await rememberIdempotent(supabase,key,"record_game",response.game_id,response);
    return json(res,201,response);
  }

  const selectedIds=Array.isArray(req.body?.player_ids)?req.body.player_ids.map(String):[];
  if(!selectedIds.length)return json(res,400,{ok:false,error:"PLAYERS_REQUIRED"});
  const {data:people}=await supabase.from("snooker_session_people").select("*").eq("session_id",sessionId).in("id",selectedIds).eq("status","ACTIVE");
  if((people||[]).length!==selectedIds.length)return json(res,400,{ok:false,error:"INVALID_PLAYER_SELECTION"});
  if(session.match_format==="SINGLES" && selectedIds.length!==2)return json(res,400,{ok:false,error:"SINGLES_FRAME_REQUIRES_TWO_PLAYERS"});
  if(session.match_format==="DOUBLES"){
    if(selectedIds.length!==4)return json(res,400,{ok:false,error:"DOUBLES_FRAME_REQUIRES_FOUR_PLAYERS"});
    const selectedPeople=(people||[]).filter(p=>selectedIds.includes(p.id));
    if(selectedPeople.filter(p=>p.team_no===1).length!==2 || selectedPeople.filter(p=>p.team_no===2).length!==2) return json(res,400,{ok:false,error:"DOUBLES_FRAME_REQUIRES_TWO_PER_TEAM"});
  }
  if(session.game_type==="QCHASE_RUMMY" && (selectedIds.length<2 || selectedIds.length>6))return json(res,400,{ok:false,error:"QCHASE_GAME_REQUIRES_TWO_TO_SIX_PLAYERS"});
  const {data:last}=await supabase.from("snooker_completed_games").select("game_number").eq("session_id",sessionId).order("game_number",{ascending:false}).limit(1).maybeSingle();
  const gameNumber=number(last?.game_number,0)+1,count=people.length;
  const settlement=session.payment_rule||"PER_PLAYER";
  const normalTimedLoserPays=session.game_type==="NORMAL_SNOOKER"&&settlement==="LOSER_PAYS";
  let allocations=[],loserIds=[],winnerIds=[];
  if(settlement==="LOSER_PAYS"){
    loserIds=Array.isArray(req.body?.loser_person_ids)?req.body.loser_person_ids.map(String):[];
    if(!loserIds.length||loserIds.some(id=>!selectedIds.includes(id)))return json(res,400,{ok:false,error:"LOSER_SELECTION_REQUIRED"});
    winnerIds=selectedIds.filter(id=>!loserIds.includes(id));
  }else{
    winnerIds=Array.isArray(req.body?.winner_person_ids)?req.body.winner_person_ids.map(String):[];
  }

  let rate=0,total=0,frameElapsedSeconds=0,sessionElapsedSnapshot=0,pricingSnapshot={};
  if(normalTimedLoserPays){
    const now=new Date();
    sessionElapsedSnapshot=elapsedSeconds(session,now);
    const {data:lastValidFrame}=await supabase
      .from("snooker_completed_games")
      .select("session_elapsed_seconds_snapshot")
      .eq("session_id",sessionId)
      .eq("status","COMPLETED")
      .eq("game_type","NORMAL_SNOOKER")
      .eq("settlement_rule","LOSER_PAYS")
      .order("game_number",{ascending:false})
      .limit(1)
      .maybeSingle();
    const previousSnapshot=number(lastValidFrame?.session_elapsed_seconds_snapshot,0);
    frameElapsedSeconds=Math.max(0,sessionElapsedSnapshot-previousSnapshot);
    if(frameElapsedSeconds<=0)return json(res,409,{ok:false,error:"FRAME_TIME_NOT_AVAILABLE",message:"No active frame time has elapsed yet."});

    const {data:table}=await supabase.from("snooker_tables").select("*").eq("id",session.table_id).maybeSingle();
    const walkInRate=money(table?.price_per_hour_inr);
    const memberRate=money(table?.member_price_per_hour_inr);
    if(!(walkInRate>0)||!(memberRate>0))return json(res,409,{ok:false,error:"TABLE_RATE_NOT_CONFIGURED"});

    const loserPeople=loserIds.map((id)=>(people||[]).find((person)=>person.id===id)).filter(Boolean);
    if(loserPeople.length!==loserIds.length)return json(res,400,{ok:false,error:"LOSER_SELECTION_REQUIRED"});
    const payer=safeText(req.body?.payer_person_id||"",100);
    if(payer&&!loserIds.includes(payer))return json(res,400,{ok:false,error:"PAYER_MUST_BE_ON_LOSING_SIDE"});

    const chargeRows=[];
    if(payer){
      const person=loserPeople.find((row)=>row.id===payer);
      const hourlyRate=money(person?.is_member?memberRate:walkInRate);
      const amount=money((frameElapsedSeconds/3600)*hourlyRate);
      allocations=[{person_id:payer,amount_inr:amount}];
      chargeRows.push({person_id:payer,is_member:Boolean(person?.is_member),hourly_rate_inr:hourlyRate,share_fraction:1,amount_inr:amount});
      rate=hourlyRate;
    }else{
      const shareFraction=1/loserPeople.length;
      allocations=loserPeople.map((person)=>{
        const hourlyRate=money(person.is_member?memberRate:walkInRate);
        const amount=money((frameElapsedSeconds/3600)*hourlyRate*shareFraction);
        chargeRows.push({person_id:person.id,is_member:Boolean(person.is_member),hourly_rate_inr:hourlyRate,share_fraction:shareFraction,amount_inr:amount});
        return {person_id:person.id,amount_inr:amount};
      });
      rate=loserPeople.length===1?chargeRows[0].hourly_rate_inr:walkInRate;
    }
    total=money(allocations.reduce((sum,row)=>sum+number(row.amount_inr),0));
    pricingSnapshot={
      mode:"LOSER_PAYS_BY_ACTIVE_FRAME_TIME",
      frame_elapsed_seconds:frameElapsedSeconds,
      table_walkin_rate_inr:walkInRate,
      table_member_rate_inr:memberRate,
      allocations:chargeRows,
    };
  }else{
    rate=settlement==="HOURLY_SHARED"?money(session.shared_hourly_rate_inr):money(rule?.rate_inr);
    if(settlement!=="HOURLY_SHARED"&&!(rate>0))return json(res,409,{ok:false,error:"GAME_RATE_NOT_CONFIGURED"});
    total=settlement==="HOURLY_SHARED"?0:money(rate*count);
    if(settlement==="HOURLY_SHARED"){
      allocations=[];
    }else if(settlement==="LOSER_PAYS"){
      const payer=safeText(req.body?.payer_person_id||"",100);
      if(payer){
        if(!loserIds.includes(payer))return json(res,400,{ok:false,error:"PAYER_MUST_BE_ON_LOSING_SIDE"});
        allocations=[{person_id:payer,amount_inr:total}];
      }else{
        let used=0;
        allocations=loserIds.map((id,i)=>{
          const amt=i===loserIds.length-1?money(total-used):money(total/loserIds.length);
          used=money(used+amt);
          return{person_id:id,amount_inr:amt};
        });
      }
    }else{
      allocations=selectedIds.map(id=>({person_id:id,amount_inr:rate}));
    }
  }
  const names=selectedIds.map(id=>(people||[]).find(p=>p.id===id)?.name||"Player");
  const {data:game,error}=await supabase.from("snooker_completed_games").insert({
    session_id:sessionId,game_number:gameNumber,game_type:session.game_type,billing_mode:settlement==="HOURLY_SHARED"?"HOURLY_SHARED":(rule?.billing_mode||"PER_PLAYER_PER_GAME"),rate_snapshot_inr:rate,
    player_ids:selectedIds,player_names:names,player_count_snapshot:count,calculated_charge_inr:total,settlement_rule:settlement,match_format:session.match_format,
    winner_person_ids:winnerIds,loser_person_ids:loserIds,charge_allocations:allocations,
    frame_elapsed_seconds:frameElapsedSeconds,session_elapsed_seconds_snapshot:sessionElapsedSnapshot,pricing_snapshot:pricingSnapshot,
    completed_by:auth.staff_id,idempotency_key:key||null
  }).select("*").single();if(error)throw error;
  const label=rule?.display_name||session.game_type;
  for(const a of allocations){
    const person=(people||[]).find(p=>p.id===a.person_id);
    const priceRow=Array.isArray(pricingSnapshot.allocations)?pricingSnapshot.allocations.find((row)=>row.person_id===a.person_id):null;
    const description=normalTimedLoserPays
      ? `${label} — Frame ${gameNumber} • ${Math.max(1,Math.round(frameElapsedSeconds/60))} min (Loser pays by time)`
      : `${label} — Frame/Game ${gameNumber}${settlement==="LOSER_PAYS"?" (Loser pays)":""}`;
    await createPersonCharge(supabase,{
      sessionId,personId:a.person_id,type:normalTimedLoserPays?"TABLE":"GAME",referenceId:game.id,description,amount:a.amount_inr,staffId:auth.staff_id,
      metadata:{
        game_number:gameNumber,settlement_rule:settlement,person_name:person?.name,
        frame_elapsed_seconds:frameElapsedSeconds||undefined,
        hourly_rate_inr:priceRow?.hourly_rate_inr,
        member_rate_applied:priceRow?.is_member,
      }
    });
  }
  const response={...game,game_id:game.id,charge_allocations:allocations,frame_elapsed_seconds:frameElapsedSeconds,pricing_snapshot:pricingSnapshot};
  await rememberIdempotent(supabase,key,"record_game",game.id,response);return json(res,201,response);
}
async function voidGame(req, res, gameId, roles = ["STAFF", "ADMIN"]) {
  const auth = await requireAuth(req, res, roles);
  if (!auth) return;
  const reason = safeText(req.body?.reason || req.body?.void_reason || "", 500);
  if (!reason) return json(res, 400, { ok: false, error: "VOID_REASON_REQUIRED" });
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from("snooker_completed_games").select("*").eq("id", gameId).maybeSingle();
  if (!existing) return json(res, 404, { ok: false, error: "GAME_NOT_FOUND" });
  if (existing.status === "VOIDED") return json(res, 200, existing);
  const { data: billedCharges } = await supabase.from("snooker_person_charges").select("id,bill_id").eq("reference_id", gameId).in("charge_type",["GAME","TABLE"]).eq("status","ACTIVE");
  if ((billedCharges || []).some((x) => x.bill_id)) return json(res,409,{ok:false,error:"GAME_ALREADY_BILLED"});
  const voidedAt = new Date().toISOString();
  const { data, error } = await supabase.from("snooker_completed_games").update({
    status: "VOIDED", voided_at: voidedAt, voided_by: auth.staff_id, void_reason: reason,
  }).eq("id", gameId).select("*").single();
  if (error) throw error;
  const { error: chargeVoidError } = await supabase.from("snooker_person_charges").update({
    status: "VOIDED", voided_at: voidedAt, voided_by: auth.staff_id, void_reason: reason,
  }).eq("reference_id", gameId).in("charge_type",["GAME","TABLE"]).eq("status","ACTIVE").is("bill_id",null);
  if (chargeVoidError) throw chargeVoidError;
  return json(res, 200, data);
}

async function applyStockMovement(supabase, { item, delta, type, referenceType, referenceId, reason, staffId, key }) {
  if (!item.track_inventory) return { before: null, after: null };
  const before = number(item.current_stock);
  const after = before + number(delta);
  if (after < 0) {
    const err = new Error(`Only ${before} ${item.name} available.`);
    err.status = 409;
    err.code = "INSUFFICIENT_STOCK";
    throw err;
  }

  const movementKey = key || `${type}:${item.id}:${referenceId || randomUUID()}`;
  const { data: existing } = await supabase
    .from("snooker_inventory_movements")
    .select("*")
    .eq("idempotency_key", movementKey)
    .maybeSingle();
  if (existing) return { before: existing.quantity_before, after: existing.quantity_after, duplicate: true };

  const { data: updated, error: updateError } = await supabase
    .from("snooker_catalogue_items")
    .update({ current_stock: after, updated_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("current_stock", before)
    .select("*")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    const err = new Error("Stock changed; retry with refreshed inventory.");
    err.status = 409;
    err.code = "STOCK_CHANGED";
    throw err;
  }

  const { error: movementError } = await supabase.from("snooker_inventory_movements").insert({
    item_id: item.id,
    movement_type: type,
    quantity_delta: delta,
    quantity_before: before,
    quantity_after: after,
    reference_type: referenceType,
    reference_id: referenceId ? String(referenceId) : null,
    reason: reason || null,
    staff_id: staffId || null,
    idempotency_key: movementKey,
  });
  if (movementError) {
    await supabase.from("snooker_catalogue_items").update({ current_stock: before, updated_at: new Date().toISOString() }).eq("id", item.id).eq("current_stock", after);
    throw movementError;
  }
  return { before, after };
}

async function addFnb(req,res,sessionId){
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=getSupabaseAdmin();const key=idempotencyKey(req);const old=await previousIdempotent(supabase,key,"add_fnb");if(old)return json(res,200,old);
  const {data:session}=await supabase.from("snooker_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(!session||!["ACTIVE","PAUSED","ENDED"].includes(session.status))return json(res,409,{ok:false,error:"SESSION_NOT_AVAILABLE"});
  const rawLines=Array.isArray(req.body?.lines)?req.body.lines:[req.body||{}];if(!rawLines.length)return json(res,400,{ok:false,error:"FNB_LINES_REQUIRED"});
  const defaultPerson=safeText(req.body?.person_id||"",100)||null;
  if(session.account_mode==="INDIVIDUAL"&&!defaultPerson&&!rawLines.every(x=>x.person_id))return json(res,400,{ok:false,error:"FNB_PERSON_REQUIRED"});
  const created=[];
  for(let i=0;i<rawLines.length;i++){
    const line=rawLines[i]||{},itemId=safeText(line.item_id||line.itemId||"",160),qty=number(line.quantity??line.qty,0),personId=safeText(line.person_id||defaultPerson||"",100)||null;
    if(!itemId||qty<=0)return json(res,400,{ok:false,error:"INVALID_FNB_LINE"});
    if(personId){const {data:p}=await supabase.from("snooker_session_people").select("id").eq("id",personId).eq("session_id",sessionId).maybeSingle();if(!p)return json(res,400,{ok:false,error:"INVALID_FNB_PERSON"});}
    const {data:item}=await supabase.from("snooker_catalogue_items").select("*").eq("id",itemId).eq("active",true).maybeSingle();if(!item)return json(res,404,{ok:false,error:"ITEM_NOT_FOUND"});
    if(item.selling_price_inr==null||number(item.selling_price_inr)<=0)return json(res,409,{ok:false,error:"PRICE_NOT_CONFIGURED",item_id:itemId,name:item.name});
    if(item.track_inventory&&number(item.current_stock)<qty)return json(res,409,{ok:false,error:"INSUFFICIENT_STOCK",item_id:itemId,available:number(item.current_stock)});
    const lineKey=key?`${key}:${i}`:null,lineTotal=money(number(item.selling_price_inr)*qty);
    const {data:inserted,error}=await supabase.from("snooker_fnb_lines").insert({session_id:sessionId,person_id:personId,item_id:item.id,item_name_snapshot:item.name,unit_price_snapshot_inr:money(item.selling_price_inr),quantity:qty,line_total_inr:lineTotal,added_by:auth.staff_id,idempotency_key:lineKey}).select("*").single();if(error)throw error;
    try{
      if(personId)await createPersonCharge(supabase,{sessionId,personId,type:"FNB",referenceId:inserted.id,description:item.name+" x "+qty,amount:lineTotal,staffId:auth.staff_id,metadata:{item_id:item.id,quantity:qty}});
      if(item.track_inventory)await applyStockMovement(supabase,{item,delta:-qty,type:"SALE",referenceType:"FNB_LINE",referenceId:inserted.id,reason:"F&B sale",staffId:auth.staff_id,key:`sale:${inserted.id}`});
    }catch(error){await supabase.from("snooker_person_charges").delete().eq("reference_id",inserted.id).eq("charge_type","FNB");await supabase.from("snooker_fnb_lines").delete().eq("id",inserted.id);throw error;}
    created.push(inserted);
  }
  const response={session_id:sessionId,lines:created};await rememberIdempotent(supabase,key,"add_fnb",sessionId,response);return json(res,201,response);
}
async function fnbTabPayload(supabase, tabId) {
  const { data: tab, error: tabError } = await supabase
    .from("snooker_fnb_tabs")
    .select("*")
    .eq("id", tabId)
    .maybeSingle();
  if (tabError) throw tabError;
  if (!tab) return null;

  const { data: lines, error: lineError } = await supabase
    .from("snooker_fnb_lines")
    .select("*")
    .eq("tab_id", tabId)
    .order("added_at");
  if (lineError) throw lineError;

  const activeLines = (lines || []).filter((line) => line.status === "ACTIVE");
  const total = money(activeLines.reduce((sum, line) => sum + number(line.line_total_inr), 0));
  const itemCount = activeLines.reduce((sum, line) => sum + number(line.quantity), 0);

  return {
    tab_id: tab.id,
    id: tab.id,
    tab_no: tab.tab_no,
    customer_id: tab.customer_id || null,
    customer_name: tab.customer_name,
    customer_phone: tab.customer_phone || null,
    status: tab.status,
    linked_bill_id: tab.linked_bill_id || null,
    opened_at: tab.opened_at,
    last_order_at: tab.last_order_at,
    closed_at: tab.closed_at || null,
    opened_by: tab.opened_by || null,
    closed_by: tab.closed_by || null,
    notes: tab.notes || null,
    total_inr: total,
    item_count: itemCount,
    lines: lines || [],
  };
}

async function listFnbTabs(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const scope = safeText(req.query?.scope || "open", 30).toLowerCase();
  let query = supabase.from("snooker_fnb_tabs").select("*").order("last_order_at", { ascending: false }).limit(200);
  if (scope !== "all") query = query.eq("status", "OPEN");
  const { data: tabs, error } = await query;
  if (error) throw error;

  const payloads = [];
  for (const tab of tabs || []) {
    const detail = await fnbTabPayload(supabase, tab.id);
    if (detail) payloads.push(detail);
  }
  return json(res, 200, { tabs: payloads });
}

async function createFnbTab(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "create_fnb_tab");
  if (old) return json(res, 200, old);

  const customerName = canonicalCustomerName(req.body?.customer_name || req.body?.customerName || "");
  const customerPhone = normalizePhone(req.body?.customer_phone || req.body?.customerPhone || "") || null;
  const requestedCustomerId = safeText(req.body?.customer_id || req.body?.customerId || "", 100) || null;
  const notes = safeText(req.body?.notes || "", 500).trim() || null;
  if (!customerName) return json(res, 400, { ok: false, error: "TAB_CUSTOMER_NAME_REQUIRED" });

  let customer = null;
  if (requestedCustomerId) {
    const { data, error } = await supabase.from("snooker_customers").select("*").eq("id", requestedCustomerId).eq("active", true).maybeSingle();
    if (error) throw error;
    customer = data || null;
  }
  if (!customer) {
    customer = await rememberCustomer(supabase, { name: customerName, phone: customerPhone, source: "fnb_running_tab" });
  }
  if (!customer) return json(res, 400, { ok: false, error: "CUSTOMER_REQUIRED" });

  const { data: existing, error: existingError } = await supabase
    .from("snooker_fnb_tabs")
    .select("*")
    .eq("customer_id", customer.id)
    .eq("status", "OPEN")
    .order("last_order_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const response = await fnbTabPayload(supabase, existing.id);
    await rememberIdempotent(supabase, key, "create_fnb_tab", existing.id, response);
    return json(res, 200, { ...response, reused: true });
  }

  const id = randomUUID();
  const suffix = id.replace(/-/g, "").slice(-6).toUpperCase();
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const tabNo = `QT-${datePart}-${suffix}`;

  const { data: tab, error } = await supabase.from("snooker_fnb_tabs").insert({
    id,
    tab_no: tabNo,
    customer_id: customer.id,
    customer_name: customer.name || customerName,
    customer_phone: customer.phone || customerPhone,
    status: "OPEN",
    opened_by: auth.staff_id,
    notes,
  }).select("*").single();
  if (error) throw error;

  const response = await fnbTabPayload(supabase, tab.id);
  await rememberIdempotent(supabase, key, "create_fnb_tab", tab.id, response);
  return json(res, 201, response);
}

async function updateFnbTab(req, res, tabId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();

  const { data: current, error: readError } = await supabase
    .from("snooker_fnb_tabs")
    .select("*")
    .eq("id", tabId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return json(res, 404, { ok: false, error: "FNB_TAB_NOT_FOUND" });
  if (current.status !== "OPEN") return json(res, 409, { ok: false, error: "FNB_TAB_NOT_OPEN" });

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.customer_name !== undefined) {
    const name = canonicalCustomerName(req.body.customer_name || "");
    if (!name) return json(res, 400, { ok: false, error: "TAB_CUSTOMER_NAME_REQUIRED" });
    patch.customer_name = name;
  }
  if (req.body?.customer_phone !== undefined) patch.customer_phone = normalizePhone(req.body.customer_phone || "") || null;
  if (req.body?.notes !== undefined) patch.notes = safeText(req.body.notes || "", 500).trim() || null;

  const { error } = await supabase.from("snooker_fnb_tabs").update(patch).eq("id", tabId);
  if (error) throw error;
  const updated = await fnbTabPayload(supabase, tabId);
  try {
    await rememberCustomer(supabase, { name: updated?.customer_name, phone: updated?.customer_phone, source: "fnb_running_tab" });
  } catch (customerError) {
    console.error("customer directory remember failed", { source: "fnb_running_tab_update", name: updated?.customer_name, message: customerError?.message });
  }
  return json(res, 200, updated);
}

async function addFnbToTab(req, res, tabId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "add_fnb_tab");
  if (old) return json(res, 200, old);

  const { data: tab, error: tabError } = await supabase
    .from("snooker_fnb_tabs")
    .select("*")
    .eq("id", tabId)
    .maybeSingle();
  if (tabError) throw tabError;
  if (!tab) return json(res, 404, { ok: false, error: "FNB_TAB_NOT_FOUND" });
  if (tab.status !== "OPEN") return json(res, 409, { ok: false, error: "FNB_TAB_NOT_OPEN" });

  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!rawLines.length) return json(res, 400, { ok: false, error: "FNB_LINES_REQUIRED" });

  const prepared = [];
  const requestedByItem = new Map();

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] || {};
    const itemId = safeText(line.item_id || line.itemId || "", 160);
    const qty = number(line.quantity ?? line.qty, 0);
    if (!itemId || qty <= 0) return json(res, 400, { ok: false, error: "INVALID_FNB_LINE" });

    const { data: item, error: itemError } = await supabase
      .from("snooker_catalogue_items")
      .select("*")
      .eq("id", itemId)
      .eq("active", true)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return json(res, 404, { ok: false, error: "ITEM_NOT_FOUND", item_id: itemId });
    if (item.selling_price_inr == null || number(item.selling_price_inr) <= 0) {
      return json(res, 409, { ok: false, error: "PRICE_NOT_CONFIGURED", item_id: itemId, name: item.name });
    }

    const cumulativeQty = number(requestedByItem.get(item.id), 0) + qty;
    requestedByItem.set(item.id, cumulativeQty);
    if (item.track_inventory && number(item.current_stock) < cumulativeQty) {
      return json(res, 409, {
        ok: false,
        error: "INSUFFICIENT_STOCK",
        item_id: item.id,
        available: number(item.current_stock),
        requested: cumulativeQty,
      });
    }

    prepared.push({
      item,
      qty,
      lineTotal: money(number(item.selling_price_inr) * qty),
      lineKey: key ? `${key}:${i}` : null,
    });
  }

  const created = [];
  const stockApplied = [];
  try {
    for (const row of prepared) {
      const { item, qty, lineTotal, lineKey } = row;
      const { data: inserted, error } = await supabase.from("snooker_fnb_lines").insert({
        session_id: null,
        bill_id: null,
        tab_id: tabId,
        person_id: null,
        item_id: item.id,
        item_name_snapshot: item.name,
        unit_price_snapshot_inr: money(item.selling_price_inr),
        quantity: qty,
        line_total_inr: lineTotal,
        added_by: auth.staff_id,
        idempotency_key: lineKey,
      }).select("*").single();
      if (error) throw error;
      created.push(inserted);

      if (item.track_inventory) {
        await applyStockMovement(supabase, {
          item,
          delta: -qty,
          type: "SALE",
          referenceType: "FNB_TAB_LINE",
          referenceId: inserted.id,
          reason: `Running tab ${tab.tab_no}`,
          staffId: auth.staff_id,
          key: `sale:${inserted.id}`,
        });
        stockApplied.push({ item, qty, lineId: inserted.id });
      }
    }

    await supabase.from("snooker_fnb_tabs").update({
      last_order_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", tabId);
  } catch (error) {
    for (const applied of stockApplied.reverse()) {
      try {
        const { data: latestItem } = await supabase
          .from("snooker_catalogue_items")
          .select("*")
          .eq("id", applied.item.id)
          .maybeSingle();
        if (latestItem) {
          await applyStockMovement(supabase, {
            item: latestItem,
            delta: applied.qty,
            type: "CORRECTION",
            referenceType: "FNB_TAB_ROLLBACK",
            referenceId: applied.lineId,
            reason: "Rollback failed running-tab order",
            staffId: auth.staff_id,
            key: `rollback-sale:${applied.lineId}`,
          });
        }
      } catch (rollbackError) {
        console.error("running tab stock rollback failed", { line_id: applied.lineId, message: rollbackError?.message });
      }
    }
    if (created.length) await supabase.from("snooker_fnb_lines").delete().in("id", created.map((line) => line.id));
    throw error;
  }

  const response = await fnbTabPayload(supabase, tabId);
  await rememberIdempotent(supabase, key, "add_fnb_tab", tabId, response);
  return json(res, 201, response);
}

async function closeFnbTab(req, res, tabId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "close_fnb_tab");
  if (old) return json(res, 200, old);

  const { data: current, error: readError } = await supabase
    .from("snooker_fnb_tabs")
    .select("*")
    .eq("id", tabId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return json(res, 404, { ok: false, error: "FNB_TAB_NOT_FOUND" });
  if (current.status === "CLOSED" && current.linked_bill_id) {
    const response = await billDetailPayload(supabase, current.linked_bill_id);
    await rememberIdempotent(supabase, key, "close_fnb_tab", current.linked_bill_id, response);
    return json(res, 200, response);
  }
  if (current.status !== "OPEN") return json(res, 409, { ok: false, error: "FNB_TAB_NOT_OPEN" });
  if (current.customer_id) {
    // A customer-linked F&B tab is part of the same Club Tab as game/table charges.
    // Finalizing from the F&B screen must therefore reconcile all unbilled activity together.
    return await finalizePlayerTab(req, res, current.customer_id);
  }

  const { data: claimed, error: claimError } = await supabase
    .from("snooker_fnb_tabs")
    .update({ status: "CLOSING", updated_at: new Date().toISOString() })
    .eq("id", tabId)
    .eq("status", "OPEN")
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return json(res, 409, { ok: false, error: "FNB_TAB_CLOSE_IN_PROGRESS" });

  let bill = null;
  try {
    const { data: lines, error: lineError } = await supabase
      .from("snooker_fnb_lines")
      .select("*")
      .eq("tab_id", tabId)
      .eq("status", "ACTIVE")
      .order("added_at");
    if (lineError) throw lineError;
    if (!(lines || []).length) {
      await supabase.from("snooker_fnb_tabs").update({ status: "OPEN", updated_at: new Date().toISOString() }).eq("id", tabId);
      return json(res, 409, { ok: false, error: "FNB_TAB_EMPTY" });
    }

    const total = money((lines || []).reduce((sum, line) => sum + number(line.line_total_inr), 0));
    const billId = randomUUID();
    const suffix = billId.replace(/-/g, "").slice(-6).toUpperCase();
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const billNo = `QF-${datePart}-${suffix}`;

    const { data: createdBill, error: billError } = await supabase.from("snooker_bills").insert({
      id: billId,
      bill_no: billNo,
      session_id: null,
      bill_source: "WALK_IN_FNB",
      customer_name: claimed.customer_name,
      customer_phone: claimed.customer_phone,
      game_total_inr: 0,
      fnb_total_inr: total,
      discount_inr: 0,
      total_inr: total,
      paid_inr: 0,
      due_inr: total,
      status: "UNPAID",
      revision: "1",
      finalized_by: auth.staff_id,
      idempotency_key: key || null,
    }).select("*").single();
    if (billError) throw billError;
    bill = createdBill;

    const lineIds = (lines || []).map((line) => line.id);
    const { error: linkError } = await supabase.from("snooker_fnb_lines").update({ bill_id: bill.id }).in("id", lineIds);
    if (linkError) throw linkError;

    const items = (lines || []).map((line) => ({
      bill_id: bill.id,
      item_type: "FNB",
      reference_id: line.id,
      description: line.item_name_snapshot,
      quantity: number(line.quantity),
      unit_price_inr: money(line.unit_price_snapshot_inr),
      line_total_inr: money(line.line_total_inr),
      metadata: { item_id: line.item_id, source: "RUNNING_FNB_TAB", tab_id: tabId, tab_no: claimed.tab_no },
    }));
    const { error: itemError } = await supabase.from("snooker_bill_items").insert(items);
    if (itemError) throw itemError;

    const { error: closeError } = await supabase.from("snooker_fnb_tabs").update({
      status: "CLOSED",
      linked_bill_id: bill.id,
      closed_at: new Date().toISOString(),
      closed_by: auth.staff_id,
      updated_at: new Date().toISOString(),
    }).eq("id", tabId);
    if (closeError) throw closeError;

    const response = await billDetailPayload(supabase, bill.id);
    await rememberIdempotent(supabase, key, "close_fnb_tab", bill.id, response);
    return json(res, 201, response);
  } catch (error) {
    if (bill?.id) {
      await supabase.from("snooker_fnb_lines").update({ bill_id: null }).eq("tab_id", tabId).eq("bill_id", bill.id);
      await supabase.from("snooker_bills").delete().eq("id", bill.id);
    }
    await supabase.from("snooker_fnb_tabs").update({ status: "OPEN", updated_at: new Date().toISOString() }).eq("id", tabId);
    throw error;
  }
}

async function cancelEmptyFnbTab(req, res, tabId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { data: tab } = await supabase.from("snooker_fnb_tabs").select("*").eq("id", tabId).maybeSingle();
  if (!tab) return json(res, 404, { ok: false, error: "FNB_TAB_NOT_FOUND" });
  if (tab.status !== "OPEN") return json(res, 409, { ok: false, error: "FNB_TAB_NOT_OPEN" });

  const { count, error: countError } = await supabase
    .from("snooker_fnb_lines")
    .select("*", { count: "exact", head: true })
    .eq("tab_id", tabId)
    .eq("status", "ACTIVE");
  if (countError) throw countError;
  if (number(count) > 0) return json(res, 409, { ok: false, error: "FNB_TAB_HAS_ITEMS", message: "Void the tab items first or close the tab into a bill." });

  const { error } = await supabase.from("snooker_fnb_tabs").update({
    status: "CANCELLED",
    closed_at: new Date().toISOString(),
    closed_by: auth.staff_id,
    updated_at: new Date().toISOString(),
  }).eq("id", tabId);
  if (error) throw error;
  return json(res, 200, { ok: true, tab_id: tabId, status: "CANCELLED" });
}

async function createWalkInFnbBill(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "walkin_fnb_bill");
  if (old) return json(res, 200, old);

  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!rawLines.length) return json(res, 400, { ok: false, error: "FNB_LINES_REQUIRED" });

  const customerName = canonicalCustomerName(req.body?.customer_name || req.body?.customerName || "") || null;
  const customerPhone = normalizePhone(req.body?.customer_phone || req.body?.customerPhone || "") || null;

  // Validate every requested line before creating any bill or stock movement.
  // This prevents half-created walk-in bills when an item/price/stock check fails.
  const prepared = [];
  const requestedByItem = new Map();

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] || {};
    const itemId = safeText(line.item_id || line.itemId || "", 160);
    const qty = number(line.quantity ?? line.qty, 0);
    if (!itemId || qty <= 0) return json(res, 400, { ok: false, error: "INVALID_FNB_LINE" });

    const { data: item, error: itemError } = await supabase
      .from("snooker_catalogue_items")
      .select("*")
      .eq("id", itemId)
      .eq("active", true)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return json(res, 404, { ok: false, error: "ITEM_NOT_FOUND", item_id: itemId });
    if (item.selling_price_inr == null || number(item.selling_price_inr) <= 0) {
      return json(res, 409, { ok: false, error: "PRICE_NOT_CONFIGURED", item_id: itemId, name: item.name });
    }

    const cumulativeQty = number(requestedByItem.get(item.id), 0) + qty;
    requestedByItem.set(item.id, cumulativeQty);
    if (item.track_inventory && number(item.current_stock) < cumulativeQty) {
      return json(res, 409, {
        ok: false,
        error: "INSUFFICIENT_STOCK",
        item_id: item.id,
        available: number(item.current_stock),
        requested: cumulativeQty,
      });
    }

    prepared.push({
      item,
      qty,
      lineTotal: money(number(item.selling_price_inr) * qty),
      lineKey: key ? `${key}:${i}` : null,
    });
  }

  const fnbTotal = money(prepared.reduce((sum, row) => sum + row.lineTotal, 0));
  const billId = randomUUID();
  const suffix = billId.replace(/-/g, "").slice(-6).toUpperCase();
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const billNo = `QF-${datePart}-${suffix}`;

  // The bill MUST exist before snooker_fnb_lines.bill_id can reference it.
  const { data: bill, error: billError } = await supabase.from("snooker_bills").insert({
    id: billId,
    bill_no: billNo,
    session_id: null,
    bill_source: "WALK_IN_FNB",
    customer_name: customerName,
    customer_phone: customerPhone,
    game_total_inr: 0,
    fnb_total_inr: fnbTotal,
    discount_inr: 0,
    total_inr: fnbTotal,
    paid_inr: 0,
    due_inr: fnbTotal,
    status: fnbTotal <= 0 ? "PAID" : "UNPAID",
    revision: "1",
    finalized_by: auth.staff_id,
    idempotency_key: key || null,
  }).select("*").single();
  if (billError) throw billError;

  const created = [];
  const stockApplied = [];

  try {
    for (let i = 0; i < prepared.length; i += 1) {
      const row = prepared[i];
      const { item, qty, lineTotal, lineKey } = row;

      const { data: inserted, error } = await supabase.from("snooker_fnb_lines").insert({
        session_id: null,
        bill_id: bill.id,
        item_id: item.id,
        item_name_snapshot: item.name,
        unit_price_snapshot_inr: money(item.selling_price_inr),
        quantity: qty,
        line_total_inr: lineTotal,
        added_by: auth.staff_id,
        idempotency_key: lineKey,
      }).select("*").single();
      if (error) throw error;

      created.push(inserted);

      if (item.track_inventory) {
        await applyStockMovement(supabase, {
          item,
          delta: -qty,
          type: "SALE",
          referenceType: "FNB_LINE",
          referenceId: inserted.id,
          reason: "Walk-in F&B sale",
          staffId: auth.staff_id,
          key: `sale:${inserted.id}`,
        });
        stockApplied.push({ item, qty, lineId: inserted.id });
      }
    }

    const items = created.map((line) => ({
      bill_id: bill.id,
      item_type: "FNB",
      reference_id: line.id,
      description: line.item_name_snapshot,
      quantity: number(line.quantity),
      unit_price_inr: money(line.unit_price_snapshot_inr),
      line_total_inr: money(line.line_total_inr),
      metadata: { item_id: line.item_id, source: "WALK_IN_FNB" },
    }));

    if (items.length) {
      const { error } = await supabase.from("snooker_bill_items").insert(items);
      if (error) throw error;
    }
  } catch (error) {
    // Best-effort compensation for any stock already deducted before a later write failed.
    for (const applied of stockApplied.reverse()) {
      try {
        const { data: latestItem } = await supabase
          .from("snooker_catalogue_items")
          .select("*")
          .eq("id", applied.item.id)
          .maybeSingle();
        if (latestItem) {
          await applyStockMovement(supabase, {
            item: latestItem,
            delta: applied.qty,
            type: "CORRECTION",
            referenceType: "WALK_IN_BILL_ROLLBACK",
            referenceId: applied.lineId,
            reason: "Rollback failed walk-in F&B bill",
            staffId: auth.staff_id,
            key: `rollback-sale:${applied.lineId}`,
          });
        }
      } catch (rollbackError) {
        console.error("walk-in F&B stock rollback failed", {
          line_id: applied.lineId,
          item_id: applied.item.id,
          message: rollbackError?.message,
        });
      }
    }

    // bill_id uses ON DELETE CASCADE for F&B lines / bill items.
    await supabase.from("snooker_bills").delete().eq("id", bill.id);
    throw error;
  }

  if (customerName) {
    try {
      await rememberCustomer(supabase, { name: customerName, phone: customerPhone, source: "quick_fnb_bill" });
    } catch (customerError) {
      console.error("customer directory remember failed", { source: "quick_fnb_bill", name: customerName, message: customerError?.message });
    }
  }

  const response = await billDetailPayload(supabase, bill.id);
  await rememberIdempotent(supabase, key, "walkin_fnb_bill", bill.id, response);
  return json(res, 201, response);
}

async function voidFnb(req, res, lineId, roles = ["STAFF", "ADMIN"]) {
  const auth = await requireAuth(req, res, roles);
  if (!auth) return;
  const reason = safeText(req.body?.reason || req.body?.void_reason || "", 500);
  if (!reason) return json(res, 400, { ok: false, error: "VOID_REASON_REQUIRED" });
  const returnStock = req.body?.return_stock !== false;
  const supabase = getSupabaseAdmin();
  const { data: line } = await supabase.from("snooker_fnb_lines").select("*").eq("id", lineId).maybeSingle();
  if (!line) return json(res, 404, { ok: false, error: "FNB_LINE_NOT_FOUND" });
  if (line.status === "VOIDED") return json(res, 200, line);
  const { data: billedFnbCharge } = await supabase.from("snooker_person_charges").select("id,bill_id").eq("reference_id",lineId).eq("charge_type","FNB").maybeSingle();
  if (billedFnbCharge?.bill_id) return json(res,409,{ok:false,error:"FNB_ALREADY_BILLED"});

  if (returnStock) {
    const { data: item } = await supabase.from("snooker_catalogue_items").select("*").eq("id", line.item_id).maybeSingle();
    if (item?.track_inventory) {
      await applyStockMovement(supabase, {
        item,
        delta: number(line.quantity),
        type: "RETURN",
        referenceType: "FNB_LINE_VOID",
        referenceId: line.id,
        reason,
        staffId: auth.staff_id,
        key: `return:${line.id}`,
      });
    }
  }
  const { data, error } = await supabase.from("snooker_fnb_lines").update({
    status: "VOIDED", voided_at: new Date().toISOString(), voided_by: auth.staff_id, void_reason: reason, stock_returned: returnStock,
  }).eq("id", lineId).select("*").single();
  if (error) throw error;
  await supabase.from("snooker_person_charges").update({status:"VOIDED",voided_at:new Date().toISOString(),voided_by:auth.staff_id,void_reason:reason}).eq("reference_id",lineId).eq("charge_type","FNB").is("bill_id",null);
  return json(res, 200, data);
}

function billStatus(total, paid, hasPending) {
  const due = Math.max(0, money(total - paid));
  if (due <= 0) return "PAID";
  if (hasPending) return "PAYMENT_PENDING";
  if (paid > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}

async function refreshBill(supabase, billId) {
  const { data: bill } = await supabase.from("snooker_bills").select("*").eq("id", billId).maybeSingle();
  if (!bill) return null;
  const { data: payments } = await supabase.from("snooker_bill_payments").select("*").eq("bill_id", billId);
  const list = payments || [];
  const paid = money(list.filter((p) => p.status === "RECEIVED" || p.status === "VERIFIED").reduce((sum, p) => sum + number(p.amount_inr), 0));
  const pending = list.some((p) => p.status === "PENDING");
  const due = Math.max(0, money(number(bill.total_inr) - paid));
  const status = billStatus(number(bill.total_inr), paid, pending);
  const { data: updated, error } = await supabase.from("snooker_bills").update({
    paid_inr: paid, due_inr: due, status, updated_at: new Date().toISOString(),
  }).eq("id", billId).select("*").single();
  if (error) throw error;
  if (updated.bill_source === "PLAYER_ACCOUNT" && updated.person_id && status === "PAID") {
    // Payment settles money only. Presence remains controlled by Leave/Rejoin,
    // so a player can pay mid-session and continue playing without interruption.
    await supabase.from("snooker_session_people").update({
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", updated.person_id);
  }
  return { ...updated, payments: list };
}

async function finalizeBill(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "finalize_bill");
  if (old) return json(res, 200, old);

  const sessionId = safeText(req.body?.session_id || req.body?.sessionId || "", 100);
  if (!sessionId) return json(res, 400, { ok: false, error: "SESSION_ID_REQUIRED" });
  const { data: existing } = await supabase.from("snooker_bills").select("*").eq("session_id", sessionId).maybeSingle();
  if (existing) {
    const response = await billDetailPayload(supabase, existing.id);
    await rememberIdempotent(supabase, key, "finalize_bill", existing.id, response);
    return json(res, 200, response);
  }

  const { data: session } = await supabase.from("snooker_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) return json(res, 404, { ok: false, error: "SESSION_NOT_FOUND" });
  if (session.account_mode === "INDIVIDUAL") return json(res,409,{ok:false,error:"USE_PLAYER_ACCOUNT_BILLS"});
  const { data: rule } = await supabase.from("snooker_game_rules").select("*").eq("game_type", session.game_type).maybeSingle();
  const { data: table } = await supabase.from("snooker_tables").select("*").eq("id", session.table_id).maybeSingle();
  if (!rule || !table) return json(res, 500, { ok: false, error: "BILLING_CONFIGURATION_MISSING" });

  let gameTotal = 0;
  const billItems = [];
  if (rule.billing_mode === "HOURLY") {
    const seconds = elapsedSeconds(session);
    const hourlyRate = money(session.is_member ? table.member_price_per_hour_inr : table.price_per_hour_inr);
    if (hourlyRate <= 0) return json(res, 409, { ok: false, error: "TABLE_RATE_NOT_CONFIGURED" });
    gameTotal = money((seconds / 3600) * hourlyRate);
    billItems.push({
      item_type: "TABLE_TIME",
      reference_id: session.id,
      description: `${table.display_name} — ${rule.display_name}`,
      quantity: money(seconds / 60),
      unit_price_inr: money(hourlyRate / 60),
      line_total_inr: gameTotal,
      metadata: { elapsed_seconds: seconds, hourly_rate_inr: hourlyRate, member_rate_applied: Boolean(session.is_member) },
    });
  } else {
    const { data: games } = await supabase
      .from("snooker_completed_games")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "COMPLETED")
      .order("game_number");
    for (const game of games || []) {
      const lineTotal = money(game.calculated_charge_inr);
      gameTotal = money(gameTotal + lineTotal);
      billItems.push({
        item_type: "GAME",
        reference_id: game.id,
        description: `${rule.display_name} — Game ${game.game_number}`,
        quantity: game.player_count_snapshot,
        unit_price_inr: money(game.rate_snapshot_inr),
        line_total_inr: lineTotal,
        metadata: {
          game_number: game.game_number,
          player_ids: game.player_ids,
          player_names: game.player_names,
          player_count_snapshot: game.player_count_snapshot,
          billing_mode: game.billing_mode,
        },
      });
    }
  }

  const { data: fnb } = await supabase.from("snooker_fnb_lines").select("*").eq("session_id", sessionId).eq("status", "ACTIVE").order("added_at");
  let fnbTotal = 0;
  for (const line of fnb || []) {
    const lineTotal = money(line.line_total_inr);
    fnbTotal = money(fnbTotal + lineTotal);
    billItems.push({
      item_type: "FNB",
      reference_id: line.id,
      description: line.item_name_snapshot,
      quantity: number(line.quantity),
      unit_price_inr: money(line.unit_price_snapshot_inr),
      line_total_inr: lineTotal,
      metadata: { item_id: line.item_id },
    });
  }

  let discount = 0;
  if (auth.role === "ADMIN" && req.body?.discount_inr != null) {
    discount = Math.max(0, money(req.body.discount_inr));
  }
  const total = Math.max(0, money(gameTotal + fnbTotal - discount));
  let linkedCustomer = null;
  if (session.customer_name) {
    try {
      linkedCustomer = await rememberCustomer(supabase, {
        name: session.customer_name,
        phone: session.customer_phone,
        isMember: session.is_member,
        source: "finalized_table_bill",
      });
    } catch (customerError) {
      console.error("bill customer link failed", { session_id: sessionId, message: customerError?.message });
    }
  }
  const billId = randomUUID();
  const suffix = billId.replace(/-/g, "").slice(-6).toUpperCase();
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const billNo = `QB-${datePart}-${suffix}`;

  const { data: bill, error: billError } = await supabase.from("snooker_bills").insert({
    id: billId,
    bill_no: billNo,
    session_id: sessionId,
    customer_id: linkedCustomer?.id || null,
    customer_name: session.customer_name || null,
    customer_phone: session.customer_phone || null,
    game_total_inr: gameTotal,
    fnb_total_inr: fnbTotal,
    discount_inr: discount,
    total_inr: total,
    paid_inr: 0,
    due_inr: total,
    status: total <= 0 ? "PAID" : "UNPAID",
    revision: "1",
    finalized_by: auth.staff_id,
    idempotency_key: key || null,
  }).select("*").single();
  if (billError) throw billError;

  if (discount > 0) {
    billItems.push({ item_type: "DISCOUNT", reference_id: null, description: "Discount", quantity: 1, unit_price_inr: -discount, line_total_inr: -discount, metadata: {} });
  }
  if (billItems.length) {
    const { error } = await supabase.from("snooker_bill_items").insert(billItems.map((item) => ({ ...item, bill_id: bill.id })));
    if (error) throw error;
  }
  await supabase.from("snooker_sessions").update({ status: "FINALIZED", ended_at: session.ended_at || new Date().toISOString(), timer_running: false, updated_at: new Date().toISOString() }).eq("id", sessionId);

  const response = await billDetailPayload(supabase, bill.id);
  await rememberIdempotent(supabase, key, "finalize_bill", bill.id, response);
  return json(res, 201, response);
}

async function billDetailPayload(supabase, billId) {
  const { data: bill } = await supabase.from("snooker_bills").select("*").eq("id", billId).maybeSingle();
  if (!bill) return null;
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("snooker_bill_items").select("*").eq("bill_id", billId).order("created_at"),
    supabase.from("snooker_bill_payments").select("*").eq("bill_id", billId).order("created_at"),
  ]);
  let customerBalance = 0;
  let balanceHistory = [];
  if (bill.customer_id) {
    const [{ data: customer }, { data: history }] = await Promise.all([
      supabase.from("snooker_customers").select("balance_inr").eq("id", bill.customer_id).maybeSingle(),
      supabase.from("snooker_customer_balance_entries").select("*").eq("customer_id", bill.customer_id).order("created_at", { ascending: false }).limit(20),
    ]);
    customerBalance = money(customer?.balance_inr || 0);
    balanceHistory = history || [];
  }
  return {
    bill_id: bill.id,
    id: bill.id,
    bill_no: bill.bill_no,
    session_id: bill.session_id,
    source_session_id: bill.source_session_id || null,
    person_id: bill.person_id || null,
    bill_source: bill.bill_source || "GAME_SESSION",
    customer_id: bill.customer_id || null,
    customer_name: bill.customer_name || null,
    customer_phone: bill.customer_phone || null,
    customer_balance_inr: customerBalance,
    balance_history: balanceHistory,
    game_total_inr: money(bill.game_total_inr),
    fnb_total_inr: money(bill.fnb_total_inr),
    discount_inr: money(bill.discount_inr),
    total_inr: money(bill.total_inr),
    paid_inr: money(bill.paid_inr),
    due_inr: money(bill.due_inr),
    status: bill.status,
    revision: bill.revision,
    finalized_at: bill.finalized_at,
    accounting_excluded: Boolean(bill.accounting_excluded),
    exclusion_reason: bill.exclusion_reason || null,
    excluded_at: bill.excluded_at || null,
    excluded_by: bill.excluded_by || null,
    items: items || [],
    payments: payments || [],
  };
}

async function billDetail(req, res, billId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const payload = await billDetailPayload(getSupabaseAdmin(), billId);
  if (!payload) return json(res, 404, { ok: false, error: "BILL_NOT_FOUND" });
  return json(res, 200, payload);
}

async function listBills(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const requestedLimit = Math.floor(number(req.query?.limit, 100));
  const limit = Math.min(500, Math.max(1, requestedLimit || 100));
  const { data, error } = await supabase
    .from("snooker_bills")
    .select("*")
    .order("finalized_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const bills = (data || []).map((bill) => ({
    bill_id: bill.id,
    id: bill.id,
    bill_no: bill.bill_no,
    session_id: bill.session_id,
    source_session_id: bill.source_session_id || null,
    person_id: bill.person_id || null,
    bill_source: bill.bill_source || "GAME_SESSION",
    customer_name: bill.customer_name || null,
    customer_phone: bill.customer_phone || null,
    game_total_inr: money(bill.game_total_inr),
    fnb_total_inr: money(bill.fnb_total_inr),
    discount_inr: money(bill.discount_inr),
    total_inr: money(bill.total_inr),
    paid_inr: money(bill.paid_inr),
    due_inr: money(bill.due_inr),
    status: bill.status,
    finalized_at: bill.finalized_at,
    created_at: bill.finalized_at || bill.updated_at,
    updated_at: bill.updated_at,
    accounting_excluded: Boolean(bill.accounting_excluded),
    exclusion_reason: bill.exclusion_reason || null,
    excluded_at: bill.excluded_at || null,
    excluded_by: bill.excluded_by || null,
  }));

  return json(res, 200, { bills });
}

async function setBillAccountingExclusion(req, res, billId) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const excluded = Boolean(req.body?.accounting_excluded);
  const reason = safeText(req.body?.reason || "", 500).trim();

  const { data: bill, error: billError } = await supabase
    .from("snooker_bills")
    .select("*")
    .eq("id", billId)
    .maybeSingle();
  if (billError) throw billError;
  if (!bill) return json(res, 404, { ok: false, error: "BILL_NOT_FOUND" });
  if (excluded && !reason) return json(res, 400, { ok: false, error: "EXCLUSION_REASON_REQUIRED" });

  const patch = excluded
    ? {
        accounting_excluded: true,
        exclusion_reason: reason,
        excluded_at: new Date().toISOString(),
        excluded_by: auth.staff_id,
        updated_at: new Date().toISOString(),
      }
    : {
        accounting_excluded: false,
        exclusion_reason: null,
        excluded_at: null,
        excluded_by: null,
        updated_at: new Date().toISOString(),
      };

  const { error } = await supabase.from("snooker_bills").update(patch).eq("id", billId);
  if (error) throw error;
  return json(res, 200, await billDetailPayload(supabase, billId));
}

async function cancelPaymentAttempt(req, res, paymentId) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const reason = safeText(req.body?.reason || "Admin cleared test/pending payment attempt", 500).trim();

  const { data: payment, error: paymentError } = await supabase
    .from("snooker_bill_payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment) return json(res, 404, { ok: false, error: "PAYMENT_NOT_FOUND" });

  if (payment.status === "VERIFIED" || payment.status === "RECEIVED") {
    return json(res, 409, { ok: false, error: "SETTLED_PAYMENT_CANNOT_BE_CLEARED", message: "Mark the bill as TEST / excluded instead. Settled provider history is preserved." });
  }
  if (payment.status === "CANCELLED") {
    return json(res, 200, await billDetailPayload(supabase, payment.bill_id));
  }

  const expiresMs = Date.parse(payment.expires_at || "");
  if (payment.status === "PENDING" && Number.isFinite(expiresMs) && expiresMs > Date.now()) {
    return json(res, 409, { ok: false, error: "PAYMENT_STILL_ACTIVE", message: "This Cashfree attempt has not expired yet. Verify it first or wait for expiry before clearing it." });
  }

  const { error } = await supabase
    .from("snooker_bill_payments")
    .update({
      status: "CANCELLED",
      cancel_reason: reason || "Admin cleared payment attempt",
      cancelled_at: new Date().toISOString(),
      cancelled_by: auth.staff_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);
  if (error) throw error;

  await refreshBill(supabase, payment.bill_id);
  return json(res, 200, await billDetailPayload(supabase, payment.bill_id));
}

async function cashPayment(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "manual_payment");
  if (old) return json(res, 200, old);

  const billId = safeText(req.body?.bill_id || req.body?.billId || "", 100);
  let { data: bill } = await supabase.from("snooker_bills").select("*").eq("id", billId).maybeSingle();
  if (!bill) return json(res, 404, { ok: false, error: "BILL_NOT_FOUND" });

  const requestedPhone = normalizePhone(req.body?.customer_phone || "");
  const requestedName = canonicalCustomerName(req.body?.customer_name || bill.customer_name || "");
  if (!bill.customer_id && requestedName) {
    const customer = await rememberCustomer(supabase, {
      name: requestedName,
      phone: requestedPhone || bill.customer_phone || "",
      source: "bill_payment",
    });
    if (customer?.id) {
      const { data: linked, error: linkError } = await supabase.from("snooker_bills").update({
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: requestedPhone || customer.phone || bill.customer_phone || null,
        updated_at: new Date().toISOString(),
      }).eq("id", billId).select("*").single();
      if (linkError) throw linkError;
      bill = linked;
    }
  } else if (requestedPhone && requestedPhone !== normalizePhone(bill.customer_phone || "")) {
    const { data: linked, error: contactError } = await supabase.from("snooker_bills").update({
      customer_phone: requestedPhone,
      updated_at: new Date().toISOString(),
    }).eq("id", billId).select("*").single();
    if (contactError) throw contactError;
    bill = linked;
  }

  const method = safeText(req.body?.method || "CASH", 20).toUpperCase();
  const received = money(req.body?.received_inr ?? req.body?.cash_tendered_inr ?? req.body?.amount_applied_inr ?? req.body?.amount_inr ?? bill.due_inr);
  const carryDifference = req.body?.carry_difference !== false;

  const { data: result, error } = await supabase.rpc("qclub_snooker_record_manual_payment", {
    p_bill_id: billId,
    p_method: method,
    p_received_inr: received,
    p_staff_id: auth.staff_id,
    p_idempotency_key: key || null,
    p_carry_difference: carryDifference,
  });
  if (error) throw error;

  const updatedBill = await refreshBill(supabase, billId);
  const autoReceipt = updatedBill?.status === "PAID"
    ? await autoSendPaidReceipt(supabase, billId, result?.payment_id, method === "UPI" ? "MANUAL_UPI_RECEIVED" : "CASH_RECEIVED")
    : { attempted: false, status: "SKIPPED", reason: "BILL_NOT_PAID" };
  const response = { ...(result || {}), auto_receipt: autoReceipt };
  await rememberIdempotent(supabase, key, "manual_payment", result?.payment_id || billId, response);
  return json(res, 201, response);
}

async function applyCustomerBalance(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "apply_customer_balance");
  if (old) return json(res, 200, old);
  const billId = safeText(req.body?.bill_id || req.body?.billId || "", 100);
  const { data: result, error } = await supabase.rpc("qclub_snooker_apply_customer_balance", {
    p_bill_id: billId,
    p_staff_id: auth.staff_id,
    p_idempotency_key: key || null,
  });
  if (error) throw error;
  const updatedBill = await refreshBill(supabase, billId);
  const autoReceipt = updatedBill?.status === "PAID"
    ? await autoSendPaidReceipt(supabase, billId, null, "BALANCE_APPLIED")
    : { attempted: false, status: "SKIPPED", reason: "BILL_NOT_PAID" };
  const response = { ...(result || {}), auto_receipt: autoReceipt };
  await rememberIdempotent(supabase, key, "apply_customer_balance", billId, response);
  return json(res, 200, response);
}

function cashfreeHeaders() {
  return {
    "Content-Type": "application/json",
    "x-client-id": env("CASHFREE_APP_ID"),
    "x-client-secret": env("CASHFREE_SECRET_KEY"),
    "x-api-version": CASHFREE_API_VERSION,
  };
}

async function cashfreeJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || safeText(text, 500) || `Cashfree error ${response.status}`);
    err.status = response.status;
    err.cashfree = data;
    throw err;
  }
  return data || {};
}

async function upiPayment(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!env("CASHFREE_APP_ID") || !env("CASHFREE_SECRET_KEY")) {
    return json(res, 503, { ok: false, error: "CASHFREE_NOT_CONFIGURED" });
  }

  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "upi_payment");
  if (old) return json(res, 200, old);

  const billId = safeText(req.body?.bill_id || req.body?.billId || "", 100);
  const { data: bill } = await supabase.from("snooker_bills").select("*").eq("id", billId).maybeSingle();
  if (!bill) return json(res, 404, { ok: false, error: "BILL_NOT_FOUND" });
  if (bill.status === "PAID") return json(res, 409, { ok: false, error: "BILL_ALREADY_PAID" });

  const due = money(bill.due_inr);
  const amount = money(req.body?.amount_inr ?? due);
  if (amount <= 0 || amount > due) {
    return json(res, 400, { ok: false, error: "INVALID_UPI_AMOUNT", due_inr: due });
  }

  const reuseCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: reusable } = await supabase
    .from("snooker_bill_payments")
    .select("*")
    .eq("bill_id", billId)
    .in("method", ["ONLINE","UPI"])
    .eq("status", "PENDING")
    .eq("amount_inr", amount)
    .gt("expires_at", new Date().toISOString())
    .gt("created_at", reuseCutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable?.payment_session_id) {
    const response = {
      payment_id: reusable.id,
      bill_id: billId,
      amount_inr: money(reusable.amount_inr),
      order_id: reusable.cashfree_order_id,
      payment_session_id: reusable.payment_session_id,
      qr_payload: null,
      qr_element_url: qrElementUrl(reusable),
      payment_url: paymentLinkUrl(reusable),
      status: reusable.status,
      expires_at: reusable.expires_at,
      integration: "CASHFREE_ELEMENT_UPI_QR",
      reused: true,
    };
    await rememberIdempotent(supabase, key, "upi_payment", reusable.id, response);
    return json(res, 200, response);
  }

  let session = null;
  if (bill.session_id) {
    const { data } = await supabase.from("snooker_sessions").select("*").eq("id", bill.session_id).maybeSingle();
    session = data || null;
  }
  const requestedPhone = normalizePhone(req.body?.customer_phone || "");
  const phone = requestedPhone || normalizePhone(session?.customer_phone || bill.customer_phone || "");
  const customerName = safeText(req.body?.customer_name || session?.customer_name || bill.customer_name || "Q Club Customer", 120) || "Q Club Customer";
  if (!phone) {
    return json(res, 409, { ok: false, error: "CUSTOMER_PHONE_REQUIRED_FOR_UPI" });
  }
  if (requestedPhone && requestedPhone !== normalizePhone(bill.customer_phone || "")) {
    const { error: contactError } = await supabase
      .from("snooker_bills")
      .update({ customer_phone: requestedPhone, updated_at: new Date().toISOString() })
      .eq("id", billId);
    if (contactError) throw contactError;
  }

  const paymentId = randomUUID();
  const orderId = `snk_${paymentId.replace(/-/g, "").slice(0, 24)}`;
  const siteUrl = safeText(env("QCLUB_SITE_URL") || "https://theqclubpasighat.com", 200).replace(/\/$/, "");

  const requestedExpiryAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const orderPayload = {
    order_id: orderId,
    order_amount: amount,
    order_currency: CURRENCY,
    order_expiry_time: requestedExpiryAt,
    customer_details: {
      customer_id: `snooker_${safeText(billId, 36)}`,
      customer_name: customerName,
      customer_phone: phone,
    },
    order_meta: {
      notify_url: `${siteUrl}/api/snooker/v1/cashfree-webhook`,
      return_url: `${siteUrl}/payment-status?order_id={order_id}`,
      payment_methods: "upi",
    },
    order_note: `Q Club bill ${bill.bill_no}`,
    order_tags: { context: "snooker", bill_id: billId, payment_id: paymentId },
  };

  const order = await cashfreeJson("https://api.cashfree.com/pg/orders", {
    method: "POST",
    headers: { ...cashfreeHeaders(), "x-idempotency-key": key || paymentId },
    body: JSON.stringify(orderPayload),
  });

  const sessionId = safeText(order.payment_session_id || "", 2000);
  if (!sessionId) {
    return json(res, 502, { ok: false, error: "CASHFREE_SESSION_MISSING" });
  }

  const providerExpiryMs = Date.parse(order.order_expiry_time || "");
  const requestedExpiryMs = Date.parse(requestedExpiryAt);
  const effectiveExpiryMs = Number.isFinite(providerExpiryMs)
    ? Math.min(providerExpiryMs, requestedExpiryMs)
    : requestedExpiryMs;
  const expiresAt = new Date(effectiveExpiryMs).toISOString();
  const { data: payment, error } = await supabase.from("snooker_bill_payments").insert({
    id: paymentId,
    bill_id: billId,
    method: "ONLINE",
    amount_inr: amount,
    status: "PENDING",
    cashfree_order_id: orderId,
    payment_session_id: sessionId,
    qr_payload: null,
    expires_at: expiresAt,
    provider_payload: {
      order,
      integration: "cashfree_element_upi_qr",
      s2s_order_pay_disabled: true,
    },
    received_by: auth.staff_id,
    idempotency_key: key || null,
  }).select("*").single();
  if (error) throw error;

  await refreshBill(supabase, billId);

  const response = {
    payment_id: payment.id,
    bill_id: billId,
    amount_inr: amount,
    order_id: orderId,
    payment_session_id: sessionId,
    qr_payload: null,
    qr_element_url: qrElementUrl(payment),
    payment_url: paymentLinkUrl(payment),
    status: "PENDING",
    expires_at: expiresAt,
    integration: "CASHFREE_ELEMENT_UPI_QR",
  };

  await rememberIdempotent(supabase, key, "upi_payment", payment.id, response);
  return json(res, 201, response);
}

async function syncCashfreePayment(supabase, payment) {
  if (!payment || !["ONLINE","UPI"].includes(payment.method) || !payment.cashfree_order_id || ["VERIFIED", "FAILED", "EXPIRED", "CANCELLED"].includes(payment.status)) return payment;
  if (!env("CASHFREE_APP_ID") || !env("CASHFREE_SECRET_KEY")) return payment;

  const order = await cashfreeJson(`https://api.cashfree.com/pg/orders/${encodeURIComponent(payment.cashfree_order_id)}`, {
    method: "GET",
    headers: cashfreeHeaders(),
  });
  const orderStatus = safeText(order.order_status || "", 40).toUpperCase();
  let status = payment.status;
  if (orderStatus === "PAID") status = "VERIFIED";
  else if (orderStatus === "EXPIRED") status = "EXPIRED";
  else if (["TERMINATED", "FAILED"].includes(orderStatus)) status = "FAILED";

  if (status !== payment.status) {
    const { data: updated, error } = await supabase.from("snooker_bill_payments").update({
      status,
      verified_at: status === "VERIFIED" ? new Date().toISOString() : null,
      provider_payload: { ...(payment.provider_payload || {}), verification_order: order },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).select("*").single();
    if (error) throw error;
    const refreshedBill = await refreshBill(supabase, payment.bill_id);
    if (status === "VERIFIED" && refreshedBill?.status === "PAID") {
      await autoSendPaidReceipt(supabase, payment.bill_id, updated.id, "CASHFREE_STATUS_SYNC");
    }
    return updated;
  }
  return payment;
}

async function paymentStatus(req, res, paymentId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("snooker_bill_payments").select("*").eq("id", paymentId).maybeSingle();
  if (!data) return json(res, 404, { ok: false, error: "PAYMENT_NOT_FOUND" });
  let payment = await syncCashfreePayment(supabase, data);

  // Cashfree can remain ACTIVE briefly around its expiry boundary. Once our
  // persisted order expiry has passed and no success was verified, release the
  // bill immediately for a fresh payment attempt while preserving the audit row.
  const expiresMs = Date.parse(payment.expires_at || "");
  if (payment.status === "PENDING" && Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
    const { data: expiredPayment, error: expiryError } = await supabase
      .from("snooker_bill_payments")
      .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
      .eq("id", payment.id)
      .eq("status", "PENDING")
      .select("*")
      .single();
    if (expiryError) throw expiryError;
    payment = expiredPayment || payment;
  }

  const bill = await refreshBill(supabase, payment.bill_id);
  const autoReceipt = payment.status === "VERIFIED" && bill?.status === "PAID"
    ? await autoSendPaidReceipt(supabase, payment.bill_id, payment.id, "PAYMENT_STATUS_VERIFY")
    : { attempted: false, status: "SKIPPED", reason: "BILL_NOT_PAID" };
  return json(res, 200, {
    payment_id: payment.id,
    bill_id: payment.bill_id,
    method: payment.method,
    amount_inr: money(payment.amount_inr),
    order_id: payment.cashfree_order_id,
    status: payment.status,
    expires_at: payment.expires_at,
    verified_at: payment.verified_at,
    bill_status: bill?.status,
    due_inr: bill ? money(bill.due_inr) : null,
    auto_receipt: autoReceipt,
  });
}

async function inventoryMovements(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  let query = supabase.from("snooker_inventory_movements").select("*").order("created_at", { ascending: false }).limit(500);
  if (req.query?.item_id) query = query.eq("item_id", safeText(req.query.item_id, 160));
  const { data, error } = await query;
  if (error) throw error;
  return json(res, 200, { movements: data || [] });
}

async function inventoryWrite(req, res, type) {
  const auth = await requireAuth(req, res, ["ADMIN"]);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const scope = type === "RESTOCK" ? "inventory_restock" : "inventory_adjust";
  const old = await previousIdempotent(supabase, key, scope);
  if (old) return json(res, 200, old);

  const itemId = safeText(req.body?.item_id || req.body?.itemId || "", 160);
  const { data: item } = await supabase.from("snooker_catalogue_items").select("*").eq("id", itemId).maybeSingle();
  if (!item) return json(res, 404, { ok: false, error: "ITEM_NOT_FOUND" });
  if (!item.track_inventory) return json(res, 409, { ok: false, error: "INVENTORY_TRACKING_DISABLED" });

  let delta = 0;
  if (type === "RESTOCK") delta = Math.abs(number(req.body?.quantity ?? req.body?.quantity_delta, 0));
  else if (req.body?.new_stock != null) delta = number(req.body.new_stock) - number(item.current_stock);
  else delta = number(req.body?.quantity_delta, 0);
  if (delta === 0) return json(res, 400, { ok: false, error: "ZERO_STOCK_CHANGE" });

  const reason = safeText(req.body?.reason || (type === "RESTOCK" ? "Restock" : "Stock adjustment"), 500);
  const movementType = type === "RESTOCK" ? "RESTOCK" : (delta < 0 && /wast/i.test(reason) ? "WASTAGE" : "ADJUSTMENT");
  const result = await applyStockMovement(supabase, {
    item, delta, type: movementType, referenceType: "MANUAL", referenceId: key || randomUUID(), reason, staffId: auth.staff_id, key: key || undefined,
  });
  const response = { item_id: itemId, quantity_before: result.before, quantity_after: result.after, quantity_delta: delta, movement_type: movementType };
  await rememberIdempotent(supabase, key, scope, itemId, response);
  return json(res, 200, response);
}

function msg91BodyText(value = "", maxLength = 1200) {
  return safeText(value, maxLength)
    .replace(/[\r\n]+/g, " • ")
    .replace(/\s+/g, " ")
    .trim();
}

async function autoSendPaidReceipt(supabase, billId, paymentId = null, trigger = "PAYMENT_SETTLED") {
  try {
    const bill = await billDetailPayload(supabase, billId);
    if (!bill) return { attempted: false, status: "SKIPPED", reason: "BILL_NOT_FOUND" };
    if (bill.status !== "PAID" || number(bill.due_inr) > 0.009) {
      return { attempted: false, status: "SKIPPED", reason: "BILL_NOT_PAID" };
    }
    if (bill.accounting_excluded) {
      return { attempted: false, status: "SKIPPED", reason: "ACCOUNTING_EXCLUDED" };
    }

    let session = null;
    if (bill.session_id) {
      const { data } = await supabase.from("snooker_sessions").select("*").eq("id", bill.session_id).maybeSingle();
      session = data || null;
    }
    const phone = normalizeWhatsappPhone(bill.customer_phone || session?.customer_phone || "");
    if (!phone) {
      return { attempted: false, status: "SKIPPED", reason: "PHONE_UNAVAILABLE" };
    }

    const authKey = env("MSG91_AUTH_KEY");
    const sender = env("MSG91_SENDER_NUMBER");
    const template = env("MSG91_SNOOKER_RECEIPT_TEMPLATE") || env("MSG91_FOOD_SUCCESS_TEMPLATE") || "food_success_items";
    if (!authKey || !sender || !template) {
      return { attempted: false, status: "SKIPPED", reason: "MSG91_NOT_CONFIGURED" };
    }

    // One automatic paid receipt per bill + destination phone. The unique
    // notification idempotency key protects against duplicate Cashfree webhooks,
    // manual Verify clicks and concurrent settlement callbacks.
    const notificationKey = `auto-paid-receipt:${billId}:${phone}`;
    let { data: existing, error: existingError } = await supabase
      .from("snooker_notification_requests")
      .select("*")
      .eq("idempotency_key", notificationKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return {
        attempted: false,
        status: existing.status,
        reason: existing.status === "SENT" ? "ALREADY_SENT" : "AUTO_ATTEMPT_ALREADY_RECORDED",
        notification_id: existing.id,
      };
    }

    let reservation = null;
    const { data: inserted, error: reserveError } = await supabase
      .from("snooker_notification_requests")
      .insert({
        bill_id: billId,
        phone,
        channel: "WHATSAPP",
        status: "PENDING",
        provider: "MSG91",
        requested_by: "AUTO_PAYMENT_SETTLEMENT",
        idempotency_key: notificationKey,
      })
      .select("*")
      .single();

    if (reserveError) {
      if (reserveError.code === "23505") {
        const { data: raced } = await supabase
          .from("snooker_notification_requests")
          .select("*")
          .eq("idempotency_key", notificationKey)
          .maybeSingle();
        return {
          attempted: false,
          status: raced?.status || "PENDING",
          reason: raced?.status === "SENT" ? "ALREADY_SENT" : "AUTO_ATTEMPT_ALREADY_RECORDED",
          notification_id: raced?.id || null,
        };
      }
      throw reserveError;
    }
    reservation = inserted;

    const summaryBase = (bill.items || [])
      .slice(0, 12)
      .map((item) => `${item.description} x ${item.quantity} = ₹${money(item.line_total_inr)}`)
      .join(" • ") || "Q Club bill";
    const customer = msg91BodyText(session?.customer_name || bill.customer_name || "Customer", 120) || "Customer";
    const params = [
      customer,
      msg91BodyText(bill.bill_no, 120),
      msg91BodyText(summaryBase, 1200),
      msg91BodyText(String(money(bill.total_inr)), 120),
    ];
    const payload = {
      integrated_number: sender,
      content_type: "template",
      payload: {
        to: phone,
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: template,
          language: { code: "en", policy: "deterministic" },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: msg91BodyText(text, 1200) })) }],
        },
      },
    };

    let upstream = null;
    let raw = "";
    let providerResponse = null;
    try {
      upstream = await fetch("https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/", {
        method: "POST",
        headers: { "Content-Type": "application/json", authkey: authKey },
        body: JSON.stringify(payload),
      });
      raw = await upstream.text();
      try { providerResponse = raw ? JSON.parse(raw) : null; } catch { providerResponse = { raw: safeText(raw, 2000) }; }
    } catch (deliveryError) {
      const errorText = safeText(deliveryError?.message || "MSG91 request failed", 1000);
      await supabase.from("snooker_notification_requests").update({
        status: "FAILED",
        error: errorText,
        provider_response: { trigger, payment_id: paymentId, network_error: errorText },
      }).eq("id", reservation.id);
      return { attempted: true, status: "FAILED", reason: "PROVIDER_REQUEST_FAILED", notification_id: reservation.id };
    }

    const notificationStatus = upstream.ok ? "SENT" : "FAILED";
    const errorText = upstream.ok ? null : safeText(raw, 1000);
    const mergedProviderResponse = providerResponse && typeof providerResponse === "object"
      ? { ...providerResponse, trigger, payment_id: paymentId }
      : { response: providerResponse, trigger, payment_id: paymentId };

    const { error: updateError } = await supabase.from("snooker_notification_requests").update({
      status: notificationStatus,
      provider_response: mergedProviderResponse,
      error: errorText,
      sent_at: upstream.ok ? new Date().toISOString() : null,
    }).eq("id", reservation.id);
    if (updateError) throw updateError;

    return {
      attempted: true,
      status: notificationStatus,
      reason: upstream.ok ? "AUTO_SENT" : "PROVIDER_REJECTED",
      notification_id: reservation.id,
    };
  } catch (error) {
    // Payment settlement must never fail because WhatsApp failed.
    console.error("auto paid receipt failed", {
      bill_id: billId,
      payment_id: paymentId,
      trigger,
      message: error?.message,
      code: error?.code,
    });
    return { attempted: true, status: "FAILED", reason: "AUTO_RECEIPT_ERROR" };
  }
}

async function sendReceipt(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "send_receipt");
  if (old) return json(res, 200, old);

  const billId = safeText(req.body?.bill_id || req.body?.billId || "", 100);
  const bill = await billDetailPayload(supabase, billId);
  if (!bill) return json(res, 404, { ok: false, error: "BILL_NOT_FOUND" });
  let session = null;
  if (bill.session_id) {
    const { data } = await supabase.from("snooker_sessions").select("*").eq("id", bill.session_id).maybeSingle();
    session = data || null;
  }
  const requestedPhone = normalizeWhatsappPhone(req.body?.phone || "");
  const phone = requestedPhone || normalizeWhatsappPhone(session?.customer_phone || bill.customer_phone || "");
  if (!phone) return json(res, 409, { ok: false, error: "PHONE_REQUIRED" });
  if (requestedPhone && requestedPhone !== normalizeWhatsappPhone(bill.customer_phone || "")) {
    const { error: contactError } = await supabase
      .from("snooker_bills")
      .update({ customer_phone: requestedPhone, updated_at: new Date().toISOString() })
      .eq("id", billId);
    if (contactError) throw contactError;
  }

  const authKey = env("MSG91_AUTH_KEY");
  const sender = env("MSG91_SENDER_NUMBER");
  const template = env("MSG91_SNOOKER_RECEIPT_TEMPLATE") || env("MSG91_FOOD_SUCCESS_TEMPLATE") || "food_success_items";
  if (!authKey || !sender || !template) return json(res, 503, { ok: false, error: "MSG91_NOT_CONFIGURED" });

  let linkedPayment = null;
  const requestedPaymentId = safeText(req.body?.payment_id || "", 100);
  if (requestedPaymentId) {
    const { data } = await supabase
      .from("snooker_bill_payments")
      .select("*")
      .eq("id", requestedPaymentId)
      .eq("bill_id", billId)
      .maybeSingle();
    linkedPayment = data || null;
  }
  if (!linkedPayment && number(bill.due_inr) > 0) {
    const { data } = await supabase
      .from("snooker_bill_payments")
      .select("*")
      .eq("bill_id", billId)
      .in("method", ["ONLINE","UPI"])
      .eq("status", "PENDING")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    linkedPayment = data || null;
  }

  const paymentUrlValue = linkedPayment ? paymentLinkUrl(linkedPayment) : "";
  const summaryBase = (bill.items || [])
    .slice(0, 12)
    .map((item) => `${item.description} x ${item.quantity} = ₹${money(item.line_total_inr)}`)
    .join(" • ") || "Q Club bill";
  const summary = paymentUrlValue ? `${summaryBase} • Pay securely: ${paymentUrlValue}` : summaryBase;
  const customer = msg91BodyText(session?.customer_name || bill.customer_name || "Customer", 120) || "Customer";
  const params = [
    customer,
    msg91BodyText(bill.bill_no, 120),
    msg91BodyText(summary, 1200),
    msg91BodyText(String(money(bill.total_inr)), 120),
  ];
  const payload = {
    integrated_number: sender,
    content_type: "template",
    payload: {
      to: phone,
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: template,
        language: { code: "en", policy: "deterministic" },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: msg91BodyText(text, 1200) })) }],
      },
    },
  };

  const upstream = await fetch("https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: authKey },
    body: JSON.stringify(payload),
  });
  const raw = await upstream.text();
  let providerResponse = null;
  try { providerResponse = raw ? JSON.parse(raw) : null; } catch { providerResponse = { raw: safeText(raw, 2000) }; }

  const status = upstream.ok ? "SENT" : "FAILED";
  await supabase.from("snooker_notification_requests").insert({
    bill_id: billId, phone, channel: "WHATSAPP", status, provider: "MSG91",
    provider_response: providerResponse, error: upstream.ok ? null : safeText(raw, 1000),
    requested_by: auth.staff_id, sent_at: upstream.ok ? new Date().toISOString() : null, idempotency_key: key || null,
  });
  const response = {
    ok: upstream.ok,
    bill_id: billId,
    channel: "WHATSAPP",
    status,
    provider: "MSG91",
    provider_error: upstream.ok ? null : msg91BodyText(providerResponse?.errors || providerResponse?.message || raw, 500),
  };
  await rememberIdempotent(supabase, key, "send_receipt", billId, response);
  return json(res, upstream.ok ? 200 : 502, response);
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  if (req.readable) {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  return req.body && typeof req.body === "object" ? JSON.stringify(req.body) : "";
}

function header(req, name) {
  const value = req.headers?.[name.toLowerCase()] ?? req.headers?.[name];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

async function cashfreeWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const signature = header(req, "x-webhook-signature");
  const timestamp = header(req, "x-webhook-timestamp");
  const secret = env("CASHFREE_WEBHOOK_SECRET") || env("CASHFREE_SECRET_KEY");
  if (!secret || !signature || !timestamp) return json(res, 401, { ok: false, error: "WEBHOOK_SIGNATURE_REQUIRED" });

  const expected = createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("base64");
  if (!secureEqual(signature, expected)) return json(res, 401, { ok: false, error: "INVALID_WEBHOOK_SIGNATURE" });

  let body = req.body;
  if (!body || typeof body !== "object") {
    try { body = JSON.parse(rawBody || "{}"); } catch { body = {}; }
  }
  const orderId = safeText(body?.data?.order?.order_id || body?.order_id || "", 160);
  const paymentStatusValue = safeText(body?.data?.payment?.payment_status || body?.payment_status || "", 40).toUpperCase();
  const paymentAmount = money(body?.data?.payment?.payment_amount ?? body?.data?.order?.order_amount ?? 0);
  if (!orderId) return json(res, 400, { ok: false, error: "ORDER_ID_REQUIRED" });

  const supabase = getSupabaseAdmin();
  const { data: payment } = await supabase.from("snooker_bill_payments").select("*").eq("cashfree_order_id", orderId).maybeSingle();
  if (!payment) return json(res, 200, { ok: true, ignored: true });

  if (paymentAmount && Math.abs(paymentAmount - number(payment.amount_inr)) >= 0.01) {
    return json(res, 200, { ok: true, ignored: true, reason: "AMOUNT_MISMATCH" });
  }

  let status = payment.status;
  if (paymentStatusValue === "SUCCESS") status = "VERIFIED";
  else if (["FAILED", "USER_DROPPED", "CANCELLED", "CANCELED"].includes(paymentStatusValue)) status = "FAILED";
  else if (paymentStatusValue === "PENDING") status = "PENDING";

  const { data: updatedPayment, error: paymentUpdateError } = await supabase.from("snooker_bill_payments").update({
    status,
    cashfree_payment_id: safeText(body?.data?.payment?.cf_payment_id || "", 160) || payment.cashfree_payment_id,
    verified_at: status === "VERIFIED" ? new Date().toISOString() : payment.verified_at,
    provider_payload: { ...(payment.provider_payload || {}), webhook: body },
    updated_at: new Date().toISOString(),
  }).eq("id", payment.id).select("*").single();
  if (paymentUpdateError) throw paymentUpdateError;

  const refreshedBill = await refreshBill(supabase, payment.bill_id);
  const autoReceipt = status === "VERIFIED" && refreshedBill?.status === "PAID"
    ? await autoSendPaidReceipt(supabase, payment.bill_id, updatedPayment?.id || payment.id, "CASHFREE_WEBHOOK")
    : { attempted: false, status: "SKIPPED", reason: "BILL_NOT_PAID" };
  return json(res, 200, { ok: true, received: true, auto_receipt: autoReceipt });
}

export async function handleSnookerV1(req, res, rawPath = "") {
  try {
    const method = safeText(req.method || "GET", 10).toUpperCase();
    const path = safeText(rawPath || req.query?.path || "", 500).replace(/^\/+|\/+$/g, "");
    const parts = path ? path.split("/").filter(Boolean) : [];

    if (path === "website/state") {
      try {
        return json(res, 200, await websiteStateTransport(getSupabaseAdmin(), req));
      } catch (error) {
        return json(res, error instanceof WebsiteSecurityError ? error.status : 503, {
          ok: false, error: error instanceof WebsiteSecurityError ? error.code : "STATE_UNAVAILABLE",
        });
      }
    }
    if (method === "GET" && path === "health") return await health(req, res);
    if (method === "GET" && path === "public-catalogue") return await publicCatalogue(req, res);
    if (parts[0] === "display" && parts[1] && parts.length === 2 && method === "GET") return await publicTableDisplay(req, res, parts[1]);
    if (method === "POST" && path === "auth/login") return await login(req, res);
    if (method === "POST" && path === "auth/logout") return await logout(req, res);
    if (method === "POST" && path === "auth/verify-game-pin") {
      const pin = safeText(req.body?.pin || "", 100);
      const kind = safeText(req.body?.kind || "", 20);
      const forwarded = safeText(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "", 300).split(",")[0].trim();
      if (!pin || !forwarded) return json(res, 400, { ok: false, error: "INVALID_REQUEST" });
      const { data: ok, error } = await getSupabaseAdmin().rpc("qclub_security_verify_game_pin", { p_network_hash: hashToken("ip:" + forwarded), p_kind: kind, p_pin: pin });
      if (error) return json(res, 503, { ok: false, error: "VERIFY_UNAVAILABLE" });
      return json(res, ok ? 200 : 401, { ok: Boolean(ok) });
    }
    if (method === "POST" && path === "auth/rotate-pin") {
      const auth = await requireAuth(req, res, ["ADMIN"]);
      if (!auth) return;
      if (auth.staff_id !== "admin-main") return json(res, 403, { ok: false, error: "FORBIDDEN" });
      const credentialId = safeText(req.body?.credential_id || "", 20);
      const newPin = safeText(req.body?.new_pin || "", 100);
      const { data: rotated, error: rotateError } = await getSupabaseAdmin().rpc("qclub_security_rotate_pin", {
        p_actor_token_hash: hashToken(bearer(req)),
        p_credential_id: credentialId,
        p_new_pin: newPin,
      });
      if (rotateError) return json(res, 503, { ok: false, error: "CREDENTIAL_CHANGE_FAILED" });
      if (!rotated?.ok) return json(res, rotated?.forbidden ? 403 : 400, { ok: false, error: rotated?.invalid ? "INVALID_PIN_FORMAT" : "CREDENTIAL_CHANGE_FAILED" });
      return json(res, 200, rotated);
    }
    if (method === "GET" && path === "cms/session") {
      const auth = await requireAuth(req, res, ["ADMIN", "STAFF", "COMMITTEE"]);
      if (!auth) return;
      return json(res, 200, {
        role: auth.role,
        staff_id: auth.staff_id,
        display_name: auth.display_name,
        expires_at: auth.expires_at,
      });
    }
    if (method === "GET" && path === "cms/content") {
      const auth = await requireAuth(req, res, ["ADMIN"]);
      if (!auth) return;
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.from("qclub_state").select("state,updated_at").eq("key", "main").single();
      if (error || !data) return json(res, 503, { ok: false, error: "STATE_UNAVAILABLE" });
      return json(res, 200, { content: cmsPublicContent(data.state), updatedAt: data.updated_at });
    }
    if (method === "PATCH" && path === "cms/content") {
      const auth = await requireAuth(req, res, ["ADMIN"]);
      if (!auth) return;
      if (auth.staff_id !== "admin-main") return json(res, 403, { ok: false, error: "FORBIDDEN" });
      try {
        return json(res, 200, await saveCmsContent(getSupabaseAdmin(), auth, req.body));
      } catch (error) {
        const status = Number(error?.status || 0);
        return json(res, status >= 400 && status < 600 ? status : 503, {
          ok: false,
          error: String(error?.code || "CMS_UNAVAILABLE"),
        });
      }
    }
    if (method === "GET" && path === "cms/staff-ops") {
      const auth = await requireAuth(req, res, ["ADMIN", "STAFF"]);
      if (!auth) return;
      try {
        return json(res, 200, await staffOpsSnapshot(getSupabaseAdmin(), hashToken(bearer(req))));
      } catch (error) {
        const status = Number(error?.status || 0);
        return json(res, status >= 400 && status < 600 ? status : 503, { ok: false, error: String(error?.code || "STAFF_OPS_UNAVAILABLE") });
      }
    }
    if (method === "POST" && path === "cms/staff-shift") {
      const auth = await requireAuth(req, res, ["ADMIN"]);
      if (!auth) return;
      try {
        const command = safeText(req.body?.command || "", 20).toUpperCase();
        if (command === "CREATE") return json(res, 200, await createStaffShift(getSupabaseAdmin(), hashToken(bearer(req)), req.body));
        if (command === "CANCEL") return json(res, 200, await cancelStaffShift(getSupabaseAdmin(), hashToken(bearer(req)), req.body));
        return json(res, 400, { ok: false, error: "INVALID_SHIFT_COMMAND" });
      } catch (error) {
        const status = Number(error?.status || 0);
        return json(res, status >= 400 && status < 600 ? status : 503, { ok: false, error: String(error?.code || "STAFF_OPS_UNAVAILABLE") });
      }
    }
    if (method === "POST" && path === "cms/staff-attendance") {
      const auth = await requireAuth(req, res, ["STAFF"]);
      if (!auth) return;
      try {
        return json(res, 200, await clockStaffAttendance(getSupabaseAdmin(), hashToken(bearer(req)), req.body));
      } catch (error) {
        const status = Number(error?.status || 0);
        return json(res, status >= 400 && status < 600 ? status : 503, { ok: false, error: String(error?.code || "STAFF_OPS_UNAVAILABLE") });
      }
    }
    if (method === "POST" && path === "cms/staff-expense") {
      const command = safeText(req.body?.command || "", 20).toUpperCase();
      const roles = command === "VOID" ? ["ADMIN"] : ["ADMIN", "STAFF"];
      const auth = await requireAuth(req, res, roles);
      if (!auth) return;
      try {
        if (command === "CREATE") return json(res, 200, await createStaffExpense(getSupabaseAdmin(), hashToken(bearer(req)), req.body));
        if (command === "VOID") return json(res, 200, await voidStaffExpense(getSupabaseAdmin(), hashToken(bearer(req)), req.body));
        return json(res, 400, { ok: false, error: "INVALID_EXPENSE_COMMAND" });
      } catch (error) {
        const status = Number(error?.status || 0);
        return json(res, status >= 400 && status < 600 ? status : 503, { ok: false, error: String(error?.code || "STAFF_OPS_UNAVAILABLE") });
      }
    }
    if (method === "POST" && path === "cashfree-webhook") return await cashfreeWebhook(req, res);
    if (parts[0] === "payments" && parts[1] === "public" && parts[2] && method === "GET") return await publicPaymentSession(req, res, parts[2]);

    if (method === "GET" && path === "bootstrap") return await bootstrap(req, res);
    if (method === "GET" && path === "game-rules") return await gameRules(req, res);
    if (method === "GET" && path === "catalogue") return await catalogue(req, res);
    if (method === "GET" && path === "catalogue/categories") return await catalogueCategories(req, res);
    if (method === "POST" && path === "catalogue/items") return await createCatalogueItem(req, res);
    if (parts[0] === "catalogue" && parts[1] === "items" && parts[2] && parts.length === 3 && method === "PATCH") return await updateCatalogueItem(req, res, parts[2]);
    if (parts[0] === "catalogue" && parts[1] === "items" && parts[2] && parts.length === 3 && method === "DELETE") return await removeCatalogueItem(req, res, parts[2]);
    if (method === "GET" && path === "inventory") return await inventory(req, res);
    if (method === "GET" && path === "members/verify") return await verifyMember(req, res);
    if (method === "GET" && path === "dashboard/summary") return await dashboardSummary(req, res);
    if (method === "GET" && path === "finance/reserve") return await financeReserve(req, res);
    if (method === "PATCH" && path === "finance/reserve") return await updateFinanceReserve(req, res);
    if (method === "PATCH" && path === "finance/fnb-costs") return await updateFnbCostPrices(req, res);
    if (method === "GET" && path === "operations/inbox") return await operationalInbox(req, res);

    if (method === "GET" && path === "sessions") return await listSessions(req, res);
    if (method === "POST" && path === "sessions") return await createSession(req, res);
    if (parts[0] === "sessions" && parts[1] && parts.length === 2 && method === "GET") return await sessionDetail(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts.length === 2 && method === "PATCH") return await updateSession(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "games" && method === "POST") return await recordGame(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "fnb" && method === "POST") return await addFnb(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "people" && parts.length === 3 && method === "POST") return await addSessionPerson(req,res,parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "people" && parts[3] && parts.length === 4 && method === "PATCH") return await updateSessionPerson(req,res,parts[1],parts[3]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "people" && parts[3] && parts[4] === "finalize" && method === "POST") return await finalizePersonBill(req,res,parts[1],parts[3]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "hourly-allocation" && method === "POST") return await allocateHourlySession(req,res,parts[1]);

    if (parts[0] === "games" && parts[1] && parts[2] === "void-admin" && method === "POST") return await voidGame(req, res, parts[1], ["ADMIN"]);
    if (parts[0] === "fnb-lines" && parts[1] && parts[2] === "void-admin" && method === "POST") return await voidFnb(req, res, parts[1], ["ADMIN"]);
    if (parts[0] === "games" && parts[1] && parts[2] === "void" && method === "POST") return await voidGame(req, res, parts[1], ["ADMIN"]);
    if (parts[0] === "fnb-lines" && parts[1] && parts[2] === "void" && method === "POST") return await voidFnb(req, res, parts[1], ["ADMIN"]);

    if (method === "GET" && path === "customers") return await listCustomers(req, res);
    if (method === "GET" && path === "player-tabs") return await listPlayerTabs(req, res);
    if (parts[0] === "player-tabs" && parts[1] && parts[2] === "finalize" && method === "POST") return await finalizePlayerTab(req,res,parts[1]);
    if (method === "POST" && path === "customers") return await upsertCustomer(req, res);
    if (method === "GET" && path === "fnb-tabs") return await listFnbTabs(req, res);
    if (method === "POST" && path === "fnb-tabs") return await createFnbTab(req, res);
    if (parts[0] === "fnb-tabs" && parts[1] && parts.length === 2 && method === "GET") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const payload = await fnbTabPayload(getSupabaseAdmin(), parts[1]);
      if (!payload) return json(res, 404, { ok: false, error: "FNB_TAB_NOT_FOUND" });
      return json(res, 200, payload);
    }
    if (parts[0] === "fnb-tabs" && parts[1] && parts.length === 2 && method === "PATCH") return await updateFnbTab(req, res, parts[1]);
    if (parts[0] === "fnb-tabs" && parts[1] && parts[2] === "fnb" && method === "POST") return await addFnbToTab(req, res, parts[1]);
    if (parts[0] === "fnb-tabs" && parts[1] && parts[2] === "close" && method === "POST") return await closeFnbTab(req, res, parts[1]);
    if (parts[0] === "fnb-tabs" && parts[1] && parts.length === 2 && method === "DELETE") return await cancelEmptyFnbTab(req, res, parts[1]);

    if (method === "GET" && path === "bills") return await listBills(req, res);
    if (method === "POST" && path === "bills/finalize") return await finalizeBill(req, res);
    if (method === "POST" && path === "bills/walk-in-fnb") return await createWalkInFnbBill(req, res);
    if (parts[0] === "bills" && parts[1] && parts.length === 2 && method === "GET") return await billDetail(req, res, parts[1]);
    if (parts[0] === "bills" && parts[1] && parts[2] === "accounting-exclusion" && method === "PATCH") return await setBillAccountingExclusion(req, res, parts[1]);

    if (method === "POST" && (path === "payments/cash" || path === "payments/manual")) return await cashPayment(req, res);
    if (method === "POST" && path === "payments/balance") return await applyCustomerBalance(req, res);
    if (method === "POST" && path === "payments/upi") return await upiPayment(req, res);
    if (parts[0] === "payments" && parts[1] && parts.length === 2 && method === "GET") return await paymentStatus(req, res, parts[1]);
    if (parts[0] === "payments" && parts[1] && parts[2] === "cancel" && method === "POST") return await cancelPaymentAttempt(req, res, parts[1]);

    if (method === "POST" && path === "notifications/receipt") return await sendReceipt(req, res);
    if (method === "GET" && path === "inventory/movements") return await inventoryMovements(req, res);
    if (method === "POST" && path === "inventory/restock") return await inventoryWrite(req, res, "RESTOCK");
    if (method === "POST" && path === "inventory/adjust") return await inventoryWrite(req, res, "ADJUST");

    return json(res, 404, { ok: false, error: "SNOOKER_V1_ROUTE_NOT_FOUND", path, method });
  } catch (error) {
    console.error("snooker-v1 error", {
      message: error?.message,
      code: error?.code,
      status: error?.status,
    });
    return json(res, error?.status && error.status >= 400 && error.status < 600 ? error.status : 500, {
      ok: false,
      error: error?.code || "SNOOKER_V1_SERVER_ERROR",
      message: error?.message || "Server error",
    });
  }
}
