import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
  const forwarded = safeText(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "", 300)
    .split(",")[0]
    .trim();
  const ipHash = forwarded ? hashToken(`ip:${forwarded}`) : null;
  const deviceHash = deviceId ? hashToken(`device:${deviceId}`) : null;
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();

  let recentFailures = 0;
  if (ipHash) {
    const { count } = await supabase
      .from("snooker_auth_login_attempts")
      .select("id", { head: true, count: "exact" })
      .eq("ip_hash", ipHash)
      .eq("success", false)
      .gte("created_at", cutoff);
    recentFailures = Math.max(recentFailures, Number(count || 0));
  }
  if (deviceHash) {
    const { count } = await supabase
      .from("snooker_auth_login_attempts")
      .select("id", { head: true, count: "exact" })
      .eq("device_hash", deviceHash)
      .eq("success", false)
      .gte("created_at", cutoff);
    recentFailures = Math.max(recentFailures, Number(count || 0));
  }

  if (recentFailures >= 5) {
    return json(res, 429, {
      ok: false,
      error: "LOGIN_RATE_LIMITED",
      message: "Too many failed login attempts. Try again later.",
      retry_after_seconds: 900,
    });
  }

  const admin = await legacyAdminConfig(supabase);
  const candidates = [
    { pin: admin.mainPin || admin.pin, role: "ADMIN", staffId: "admin-main", displayName: admin.adminName || "Q Club Admin" },
    { pin: admin.committeePin, role: "ADMIN", staffId: "admin-committee", displayName: admin.committeeName || "Committee Admin" },
    { pin: admin.staffPin, role: "STAFF", staffId: "staff-game-marshall", displayName: admin.staffName || "Game Marshall" },
  ].filter((candidate) => candidate.pin);

  const matched = candidates.find((candidate) => secureEqual(pin, String(candidate.pin))) || null;
  const role = matched?.role || "";

  await supabase.from("snooker_auth_login_attempts").insert({
    ip_hash: ipHash,
    device_hash: deviceHash,
    success: Boolean(role),
    role: role || null,
  });

  if (!matched) return json(res, 401, { ok: false, error: "INVALID_PIN" });

  const rawToken = `snk_${randomBytes(32).toString("base64url")}`;
  const ttlHours = Math.min(720, Math.max(1, number(env("SNOOKER_AUTH_TTL_HOURS"), 72)));
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  const displayName = matched.displayName;
  const staffId = matched.staffId;

  const { error } = await supabase.from("snooker_auth_sessions").insert({
    token_hash: hashToken(rawToken),
    role,
    staff_id: staffId,
    display_name: displayName,
    device_id: deviceId || null,
    client_version: safeText(req.body?.client_version || req.headers?.["x-qclub-client-version"] || "", 100) || null,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return json(res, 200, {
    access_token: rawToken,
    expires_at: expiresAt,
    role,
    staff_id: staffId,
    display_name: displayName,
  });
}

async function logout(req, res) {
  const auth = await requireAuth(req, res);
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

async function memberRegistry(supabase) {
  const { data, error } = await supabase
    .from("qclub_state")
    .select("state")
    .eq("key", "main")
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.state?.memberRegistry) ? data.state.memberRegistry : [];
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
    supabase.from("snooker_bills").select("id").gte("finalized_at", bounds.start).lt("finalized_at", bounds.end),
    supabase.from("snooker_bill_payments").select("amount_inr").eq("method", "CASH").eq("status", "RECEIVED").gte("created_at", bounds.start).lt("created_at", bounds.end),
    supabase.from("snooker_bill_payments").select("amount_inr").eq("method", "UPI").eq("status", "VERIFIED").gte("verified_at", bounds.start).lt("verified_at", bounds.end),
    supabase.from("snooker_bills").select("due_inr").gt("due_inr", 0),
  ]);
  if (billError || cashError || upiError || outstandingError) throw billError || cashError || upiError || outstandingError;

  const cash = (cashPayments || []).reduce((sum, row) => sum + number(row.amount_inr), 0);
  const upi = (upiPayments || []).reduce((sum, row) => sum + number(row.amount_inr), 0);
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
  if (tableType === "MINI_SNOOKER") return gameType === "NORMAL_SNOOKER";
  if (tableType === "FULL_SIZE_SNOOKER") {
    return ["NORMAL_SNOOKER", "QCHASE_RUMMY", "SIX_BALL_SNOOKER", "TEN_BALL_SNOOKER"].includes(gameType);
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
    started_at: row.started_at,
    ended_at: row.ended_at,
    timer_running: row.timer_running,
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

  const { data: active } = await supabase
    .from("snooker_sessions")
    .select("id")
    .eq("table_id", tableId)
    .in("status", ["ACTIVE", "PAUSED"])
    .maybeSingle();
  if (active) return json(res, 409, { ok: false, error: "TABLE_ALREADY_ACTIVE", session_id: active.id });

  const customerName = safeText(req.body?.customer_name || req.body?.customerName || "", 160) || null;
  const customerPhone = normalizePhone(req.body?.customer_phone || req.body?.customerPhone || "") || null;
  const requestedMember = Boolean(req.body?.is_member ?? req.body?.isMember ?? false);
  let isMember = false;
  if (requestedMember) {
    const verification = await verifyMemberRecord(supabase, { phone: customerPhone, name: customerName });
    if (!verification.verified) {
      return json(res, 409, { ok: false, error: "MEMBERSHIP_NOT_VERIFIED", reason: verification.reason });
    }
    isMember = true;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase.from("snooker_sessions").insert({
    table_id: tableId,
    game_type: gameType,
    customer_name: customerName,
    customer_phone: customerPhone,
    is_member: isMember,
    participant_ids: Array.isArray(req.body?.participant_ids) ? req.body.participant_ids : (Array.isArray(req.body?.participantIds) ? req.body.participantIds : []),
    participant_names: Array.isArray(req.body?.participant_names) ? req.body.participant_names : (Array.isArray(req.body?.participantNames) ? req.body.participantNames : []),
    started_at: now,
    timer_started_at: now,
    timer_running: rule.billing_mode === "HOURLY",
    created_by: auth.staff_id,
    updated_by: auth.staff_id,
    client_revision: safeText(req.body?.client_revision || "", 120) || null,
    idempotency_key: key || null,
  }).select("*").single();
  if (error) throw error;
  const response = sessionDto(data);
  await rememberIdempotent(supabase, key, "create_session", data.id, response);
  return json(res, 201, response);
}

async function sessionDetail(req, res, sessionId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { data: session, error } = await supabase.from("snooker_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw error;
  if (!session) return json(res, 404, { ok: false, error: "SESSION_NOT_FOUND" });

  const [{ data: games }, { data: fnb }, { data: bill }] = await Promise.all([
    supabase.from("snooker_completed_games").select("*").eq("session_id", sessionId).order("game_number"),
    supabase.from("snooker_fnb_lines").select("*").eq("session_id", sessionId).order("added_at"),
    supabase.from("snooker_bills").select("*").eq("session_id", sessionId).maybeSingle(),
  ]);
  return json(res, 200, { ...sessionDto(session), games: games || [], fnb_lines: fnb || [], bill: bill || null });
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

async function updateSession(req, res, sessionId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const { data: current } = await supabase.from("snooker_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!current) return json(res, 404, { ok: false, error: "SESSION_NOT_FOUND" });

  const action = safeText(req.body?.action || "", 50).toUpperCase();
  const patch = { updated_by: auth.staff_id, updated_at: new Date().toISOString() };

  if (Array.isArray(req.body?.participant_ids)) patch.participant_ids = req.body.participant_ids;
  if (Array.isArray(req.body?.participant_names)) patch.participant_names = req.body.participant_names;
  if (req.body?.customer_name !== undefined) patch.customer_name = safeText(req.body.customer_name, 160) || null;
  if (req.body?.customer_phone !== undefined) patch.customer_phone = normalizePhone(req.body.customer_phone) || null;
  if (req.body?.client_revision !== undefined) patch.client_revision = safeText(req.body.client_revision, 120) || null;

  const identityChanged = req.body?.customer_name !== undefined || req.body?.customer_phone !== undefined;
  const requestedMember = req.body?.is_member !== undefined ? Boolean(req.body.is_member) : Boolean(current.is_member);
  if (req.body?.is_member !== undefined || (identityChanged && current.is_member)) {
    if (requestedMember) {
      const verification = await verifyMemberRecord(supabase, {
        phone: patch.customer_phone ?? current.customer_phone,
        name: patch.customer_name ?? current.customer_name,
      });
      if (!verification.verified) {
        if (req.body?.is_member !== undefined) {
          return json(res, 409, { ok: false, error: "MEMBERSHIP_NOT_VERIFIED", reason: verification.reason });
        }
        patch.is_member = false;
      } else {
        patch.is_member = true;
      }
    } else {
      patch.is_member = false;
    }
  }

  const now = new Date();
  if (action === "PAUSE" && current.timer_running) {
    patch.accumulated_seconds = elapsedSeconds(current, now);
    patch.timer_running = false;
    patch.status = "PAUSED";
  } else if (action === "RESUME" && !current.timer_running) {
    patch.timer_started_at = now.toISOString();
    patch.timer_running = true;
    patch.status = "ACTIVE";
  } else if (action === "END" || safeText(req.body?.status || "").toUpperCase() === "ENDED") {
    patch.accumulated_seconds = elapsedSeconds(current, now);
    patch.timer_running = false;
    patch.status = "ENDED";
    patch.ended_at = now.toISOString();
  }

  const { data, error } = await supabase.from("snooker_sessions").update(patch).eq("id", sessionId).select("*").single();
  if (error) throw error;
  return json(res, 200, sessionDto(data));
}

async function recordGame(req, res, sessionId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "record_game");
  if (old) return json(res, 200, old);

  const { data: session } = await supabase.from("snooker_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session || !["ACTIVE", "PAUSED"].includes(session.status)) return json(res, 409, { ok: false, error: "SESSION_NOT_ACTIVE" });
  const { data: rule } = await supabase.from("snooker_game_rules").select("*").eq("game_type", session.game_type).maybeSingle();
  if (!rule || rule.billing_mode !== "PER_PLAYER_PER_GAME") return json(res, 400, { ok: false, error: "GAME_COMPLETION_NOT_USED_FOR_THIS_MODE" });

  const playerIds = Array.isArray(req.body?.player_ids) ? req.body.player_ids : (session.participant_ids || []);
  const playerNames = Array.isArray(req.body?.player_names) ? req.body.player_names : (session.participant_names || []);
  const count = Math.max(playerIds.length, playerNames.length, number(req.body?.player_count, 0));
  if (count <= 0) return json(res, 400, { ok: false, error: "PLAYERS_REQUIRED" });

  const { data: last } = await supabase
    .from("snooker_completed_games")
    .select("game_number")
    .eq("session_id", sessionId)
    .order("game_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const gameNumber = number(last?.game_number, 0) + 1;
  const rate = money(rule.rate_inr);
  const charge = money(rate * count);

  const { data, error } = await supabase.from("snooker_completed_games").insert({
    session_id: sessionId,
    game_number: gameNumber,
    game_type: session.game_type,
    billing_mode: rule.billing_mode,
    rate_snapshot_inr: rate,
    player_ids: playerIds,
    player_names: playerNames,
    player_count_snapshot: count,
    calculated_charge_inr: charge,
    completed_by: auth.staff_id,
    idempotency_key: key || null,
  }).select("*").single();
  if (error) throw error;

  const response = {
    id: data.id,
    game_id: data.id,
    session_id: sessionId,
    game_number: gameNumber,
    game_type: data.game_type,
    billing_mode: data.billing_mode,
    rate_snapshot_inr: rate,
    player_ids: playerIds,
    player_names: playerNames,
    player_count_snapshot: count,
    calculated_charge_inr: charge,
    status: data.status,
    completed_at: data.completed_at,
  };
  await rememberIdempotent(supabase, key, "record_game", data.id, response);
  return json(res, 201, response);
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
  const { data, error } = await supabase.from("snooker_completed_games").update({
    status: "VOIDED", voided_at: new Date().toISOString(), voided_by: auth.staff_id, void_reason: reason,
  }).eq("id", gameId).select("*").single();
  if (error) throw error;
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

async function addFnb(req, res, sessionId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "add_fnb");
  if (old) return json(res, 200, old);

  const { data: session } = await supabase.from("snooker_sessions").select("id,status").eq("id", sessionId).maybeSingle();
  if (!session || !["ACTIVE", "PAUSED", "ENDED"].includes(session.status)) return json(res, 409, { ok: false, error: "SESSION_NOT_AVAILABLE" });

  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [req.body || {}];
  if (!rawLines.length) return json(res, 400, { ok: false, error: "FNB_LINES_REQUIRED" });
  const created = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] || {};
    const itemId = safeText(line.item_id || line.itemId || "", 160);
    const qty = number(line.quantity ?? line.qty, 0);
    if (!itemId || qty <= 0) return json(res, 400, { ok: false, error: "INVALID_FNB_LINE" });

    const { data: item } = await supabase.from("snooker_catalogue_items").select("*").eq("id", itemId).eq("active", true).maybeSingle();
    if (!item) return json(res, 404, { ok: false, error: "ITEM_NOT_FOUND", item_id: itemId });
    if (item.selling_price_inr == null || number(item.selling_price_inr) <= 0) {
      return json(res, 409, { ok: false, error: "PRICE_NOT_CONFIGURED", item_id: itemId, name: item.name });
    }
    if (item.track_inventory && number(item.current_stock) < qty) {
      return json(res, 409, { ok: false, error: "INSUFFICIENT_STOCK", item_id: itemId, available: number(item.current_stock) });
    }

    const lineKey = key ? `${key}:${i}` : null;
    if (lineKey) {
      const { data: dup } = await supabase.from("snooker_fnb_lines").select("*").eq("idempotency_key", lineKey).maybeSingle();
      if (dup) { created.push(dup); continue; }
    }

    const lineTotal = money(number(item.selling_price_inr) * qty);
    const { data: inserted, error } = await supabase.from("snooker_fnb_lines").insert({
      session_id: sessionId,
      item_id: item.id,
      item_name_snapshot: item.name,
      unit_price_snapshot_inr: money(item.selling_price_inr),
      quantity: qty,
      line_total_inr: lineTotal,
      added_by: auth.staff_id,
      idempotency_key: lineKey,
    }).select("*").single();
    if (error) throw error;

    try {
      if (item.track_inventory) {
        await applyStockMovement(supabase, {
          item,
          delta: -qty,
          type: "SALE",
          referenceType: "FNB_LINE",
          referenceId: inserted.id,
          reason: "F&B sale",
          staffId: auth.staff_id,
          key: `sale:${inserted.id}`,
        });
      }
    } catch (error) {
      await supabase.from("snooker_fnb_lines").delete().eq("id", inserted.id);
      throw error;
    }
    created.push(inserted);
  }

  const response = { session_id: sessionId, lines: created };
  await rememberIdempotent(supabase, key, "add_fnb", sessionId, response);
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
  const billId = randomUUID();
  const suffix = billId.replace(/-/g, "").slice(-6).toUpperCase();
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const billNo = `QB-${datePart}-${suffix}`;

  const { data: bill, error: billError } = await supabase.from("snooker_bills").insert({
    id: billId,
    bill_no: billNo,
    session_id: sessionId,
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
  return {
    bill_id: bill.id,
    id: bill.id,
    bill_no: bill.bill_no,
    session_id: bill.session_id,
    game_total_inr: money(bill.game_total_inr),
    fnb_total_inr: money(bill.fnb_total_inr),
    discount_inr: money(bill.discount_inr),
    total_inr: money(bill.total_inr),
    paid_inr: money(bill.paid_inr),
    due_inr: money(bill.due_inr),
    status: bill.status,
    revision: bill.revision,
    finalized_at: bill.finalized_at,
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
  }));

  return json(res, 200, { bills });
}

async function cashPayment(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const supabase = getSupabaseAdmin();
  const key = idempotencyKey(req);
  const old = await previousIdempotent(supabase, key, "cash_payment");
  if (old) return json(res, 200, old);

  const billId = safeText(req.body?.bill_id || req.body?.billId || "", 100);
  const { data: bill } = await supabase.from("snooker_bills").select("*").eq("id", billId).maybeSingle();
  if (!bill) return json(res, 404, { ok: false, error: "BILL_NOT_FOUND" });
  if (bill.status === "PAID") return json(res, 409, { ok: false, error: "BILL_ALREADY_PAID" });

  const due = money(bill.due_inr);
  const requested = money(req.body?.amount_applied_inr ?? req.body?.amount_inr ?? due);
  const applied = Math.min(due, requested > 0 ? requested : due);
  const tendered = money(req.body?.cash_tendered_inr ?? applied);
  if (tendered < applied) return json(res, 400, { ok: false, error: "CASH_TENDERED_TOO_LOW" });
  const change = money(tendered - applied);

  const { data: payment, error } = await supabase.from("snooker_bill_payments").insert({
    bill_id: billId,
    method: "CASH",
    amount_inr: applied,
    cash_tendered_inr: tendered,
    change_inr: change,
    status: "RECEIVED",
    received_by: auth.staff_id,
    idempotency_key: key || null,
  }).select("*").single();
  if (error) throw error;
  const updatedBill = await refreshBill(supabase, billId);
  const response = {
    payment_id: payment.id,
    bill_id: billId,
    method: "CASH",
    amount_applied_inr: applied,
    cash_tendered_inr: tendered,
    change_inr: change,
    status: "RECEIVED",
    bill_status: updatedBill.status,
    due_inr: money(updatedBill.due_inr),
  };
  await rememberIdempotent(supabase, key, "cash_payment", payment.id, response);
  return json(res, 201, response);
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
  if (!env("CASHFREE_APP_ID") || !env("CASHFREE_SECRET_KEY")) return json(res, 503, { ok: false, error: "CASHFREE_NOT_CONFIGURED" });

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
  if (amount <= 0 || amount > due) return json(res, 400, { ok: false, error: "INVALID_UPI_AMOUNT", due_inr: due });

  const { data: reusable } = await supabase
    .from("snooker_bill_payments")
    .select("*")
    .eq("bill_id", billId)
    .eq("method", "UPI")
    .eq("status", "PENDING")
    .eq("amount_inr", amount)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reusable?.payment_session_id && reusable?.qr_payload) {
    const response = {
      payment_id: reusable.id,
      bill_id: billId,
      amount_inr: money(reusable.amount_inr),
      order_id: reusable.cashfree_order_id,
      payment_session_id: reusable.payment_session_id,
      qr_payload: reusable.qr_payload,
      payment_url: paymentLinkUrl(reusable),
      status: reusable.status,
      expires_at: reusable.expires_at,
      reused: true,
    };
    await rememberIdempotent(supabase, key, "upi_payment", reusable.id, response);
    return json(res, 200, response);
  }

  const { data: session } = await supabase.from("snooker_sessions").select("*").eq("id", bill.session_id).maybeSingle();
  const phone = normalizePhone(req.body?.customer_phone || session?.customer_phone || "");
  if (!phone) return json(res, 409, { ok: false, error: "CUSTOMER_PHONE_REQUIRED_FOR_UPI" });

  const paymentId = randomUUID();
  const orderId = `snk_${paymentId.replace(/-/g, "").slice(0, 24)}`;
  const siteUrl = safeText(env("QCLUB_SITE_URL") || "https://theqclubpasighat.com", 200).replace(/\/$/, "");

  const orderPayload = {
    order_id: orderId,
    order_amount: amount,
    order_currency: CURRENCY,
    customer_details: {
      customer_id: `snooker_${safeText(billId, 36)}`,
      customer_name: safeText(session?.customer_name || "Q Club Customer", 120) || "Q Club Customer",
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
  if (!sessionId) return json(res, 502, { ok: false, error: "CASHFREE_SESSION_MISSING" });

  let qrPayload = "";
  let payProviderPayload = null;
  try {
    const pay = await cashfreeJson("https://api.cashfree.com/pg/orders/sessions", {
      method: "POST",
      headers: cashfreeHeaders(),
      body: JSON.stringify({
        payment_session_id: sessionId,
        payment_method: { upi: { channel: "qrcode" } },
      }),
    });
    payProviderPayload = pay;
    qrPayload = safeText(
      pay?.data?.payload ||
      pay?.data?.qr_payload ||
      pay?.data?.qr_code ||
      pay?.data?.qrcode ||
      pay?.payload ||
      pay?.qr_payload ||
      "",
      10000
    );
  } catch (error) {
    return json(res, 502, {
      ok: false,
      error: "CASHFREE_QR_CREATION_FAILED",
      message: error.message,
      order_id: orderId,
      payment_session_id: sessionId,
    });
  }

  if (!qrPayload) {
    return json(res, 502, {
      ok: false,
      error: "CASHFREE_QR_PAYLOAD_MISSING",
      order_id: orderId,
      payment_session_id: sessionId,
    });
  }

  const expiresAt = order.order_expiry_time || new Date(Date.now() + 15 * 60_000).toISOString();
  const { data: payment, error } = await supabase.from("snooker_bill_payments").insert({
    id: paymentId,
    bill_id: billId,
    method: "UPI",
    amount_inr: amount,
    status: "PENDING",
    cashfree_order_id: orderId,
    payment_session_id: sessionId,
    qr_payload: qrPayload,
    expires_at: expiresAt,
    provider_payload: { order, pay: payProviderPayload },
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
    qr_payload: qrPayload,
    payment_url: paymentLinkUrl(payment),
    status: "PENDING",
    expires_at: expiresAt,
  };
  await rememberIdempotent(supabase, key, "upi_payment", payment.id, response);
  return json(res, 201, response);
}

async function syncCashfreePayment(supabase, payment) {
  if (!payment || payment.method !== "UPI" || !payment.cashfree_order_id || ["VERIFIED", "FAILED", "EXPIRED", "CANCELLED"].includes(payment.status)) return payment;
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
    await refreshBill(supabase, payment.bill_id);
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
  const payment = await syncCashfreePayment(supabase, data);
  const bill = await refreshBill(supabase, payment.bill_id);
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
  const { data: session } = await supabase.from("snooker_sessions").select("*").eq("id", bill.session_id).maybeSingle();
  const phone = normalizeWhatsappPhone(req.body?.phone || session?.customer_phone || "");
  if (!phone) return json(res, 409, { ok: false, error: "PHONE_REQUIRED" });

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
      .eq("method", "UPI")
      .eq("status", "PENDING")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    linkedPayment = data || null;
  }

  const paymentUrlValue = linkedPayment ? paymentLinkUrl(linkedPayment) : "";
  const summaryBase = (bill.items || []).slice(0, 12).map((item) => `${item.description} x ${item.quantity} = ₹${money(item.line_total_inr)}`).join("\n") || "Q Club bill";
  const summary = paymentUrlValue ? `${summaryBase}\nPay securely: ${paymentUrlValue}` : summaryBase;
  const customer = safeText(session?.customer_name || "Customer", 120) || "Customer";
  const params = [customer, bill.bill_no, summary, String(money(bill.total_inr))];
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
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: safeText(text, 1200) })) }],
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
  const response = { ok: upstream.ok, bill_id: billId, channel: "WHATSAPP", status, provider: "MSG91" };
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

  await supabase.from("snooker_bill_payments").update({
    status,
    cashfree_payment_id: safeText(body?.data?.payment?.cf_payment_id || "", 160) || payment.cashfree_payment_id,
    verified_at: status === "VERIFIED" ? new Date().toISOString() : payment.verified_at,
    provider_payload: { ...(payment.provider_payload || {}), webhook: body },
    updated_at: new Date().toISOString(),
  }).eq("id", payment.id);
  await refreshBill(supabase, payment.bill_id);
  return json(res, 200, { ok: true, received: true });
}

export async function handleSnookerV1(req, res, rawPath = "") {
  try {
    const method = safeText(req.method || "GET", 10).toUpperCase();
    const path = safeText(rawPath || req.query?.path || "", 500).replace(/^\/+|\/+$/g, "");
    const parts = path ? path.split("/").filter(Boolean) : [];

    if (method === "GET" && path === "health") return await health(req, res);
    if (method === "POST" && path === "auth/login") return await login(req, res);
    if (method === "POST" && path === "auth/logout") return await logout(req, res);
    if (method === "POST" && path === "cashfree-webhook") return await cashfreeWebhook(req, res);
    if (parts[0] === "payments" && parts[1] === "public" && parts[2] && method === "GET") return await publicPaymentSession(req, res, parts[2]);

    if (method === "GET" && path === "bootstrap") return await bootstrap(req, res);
    if (method === "GET" && path === "game-rules") return await gameRules(req, res);
    if (method === "GET" && path === "catalogue") return await catalogue(req, res);
    if (method === "GET" && path === "inventory") return await inventory(req, res);
    if (method === "GET" && path === "members/verify") return await verifyMember(req, res);
    if (method === "GET" && path === "dashboard/summary") return await dashboardSummary(req, res);

    if (method === "GET" && path === "sessions") return await listSessions(req, res);
    if (method === "POST" && path === "sessions") return await createSession(req, res);
    if (parts[0] === "sessions" && parts[1] && parts.length === 2 && method === "GET") return await sessionDetail(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts.length === 2 && method === "PATCH") return await updateSession(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "games" && method === "POST") return await recordGame(req, res, parts[1]);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "fnb" && method === "POST") return await addFnb(req, res, parts[1]);

    if (parts[0] === "games" && parts[1] && parts[2] === "void-admin" && method === "POST") return await voidGame(req, res, parts[1], ["ADMIN"]);
    if (parts[0] === "fnb-lines" && parts[1] && parts[2] === "void-admin" && method === "POST") return await voidFnb(req, res, parts[1], ["ADMIN"]);
    if (parts[0] === "games" && parts[1] && parts[2] === "void" && method === "POST") return await voidGame(req, res, parts[1]);
    if (parts[0] === "fnb-lines" && parts[1] && parts[2] === "void" && method === "POST") return await voidFnb(req, res, parts[1]);

    if (method === "GET" && path === "bills") return await listBills(req, res);
    if (method === "POST" && path === "bills/finalize") return await finalizeBill(req, res);
    if (parts[0] === "bills" && parts[1] && parts.length === 2 && method === "GET") return await billDetail(req, res, parts[1]);

    if (method === "POST" && path === "payments/cash") return await cashPayment(req, res);
    if (method === "POST" && path === "payments/upi") return await upiPayment(req, res);
    if (parts[0] === "payments" && parts[1] && parts.length === 2 && method === "GET") return await paymentStatus(req, res, parts[1]);

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
