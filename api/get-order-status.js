import { createClient } from "@supabase/supabase-js";

const TABLE = "qclub_state";
const KEY = "main";
const CURRENCY = "INR";
const CLAIM_TTL_MS = 10 * 60 * 1000;
const MAX_CLIENT_ACKS = 20;
const ALLOWED_ACTIONS = new Set([
  "",
  "claim_fulfillment",
  "acknowledge_fulfillment",
  "complete_fulfillment",
]);

function env(name = "") {
  return String(process.env[name] || "").trim();
}

function getSupabaseClient() {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  const key =
    env("SUPABASE_SERVICE_ROLE_KEY") ||
    env("QCLUB_SUPABASE_SERVICE_ROLE_KEY") ||
    env("VITE_SUPABASE_ANON_KEY");

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

async function readState(supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("state")
    .eq("key", KEY)
    .maybeSingle();

  if (error) throw new Error(error.message || "Supabase read failed");
  return data?.state || {};
}

async function writeState(supabase, state) {
  const { error } = await supabase.from(TABLE).upsert(
    {
      key: KEY,
      state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) throw new Error(error.message || "Supabase write failed");
}

function parseOrderTags(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}

  return {};
}

function safeText(value = "", maxLength = 8000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function getRequestHeader(req, name) {
  const headers = req?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function hasServerFulfillmentSecret(req) {
  const configured = env("QCLUB_FULFILLMENT_SECRET") || env("QCLUB_SERVER_ACTION_SECRET");
  if (!configured) return false;

  const supplied = safeText(getRequestHeader(req, "x-qclub-fulfillment-secret"), 300);

  return supplied === configured;
}

function safeResultValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return safeText(value, 500);
}

function sanitizeFulfillmentResult(result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};

  const allowed = [
    "context",
    "orderNo",
    "inserted",
    "bookingUpdated",
    "membershipUpserted",
    "tournamentRegistered",
  ];

  return Object.fromEntries(
    allowed
      .filter((key) => result[key] !== undefined && result[key] !== null)
      .map((key) => [key, safeResultValue(result[key])])
  );
}

function publicOrderTags(tags = {}) {
  const allowed = [
    "context",
    "customer_name",
    "mobile",
    "phone",
    "food_items",
    "food_items_json",
    "food_total",
    "shop_items",
    "shop_items_json",
    "shop_total",
    "table_label",
    "booking_date",
    "booking_slot",
    "booking_amount",
    "tier",
    "tshirt_size",
    "valid_until",
    "tournament_id",
    "tournament_name",
    "tournament_fee",
    "tournament_player_id",
  ];

  return Object.fromEntries(
    allowed
      .filter((key) => tags[key] !== undefined && tags[key] !== null)
      .map((key) => [key, safeText(tags[key])])
  );
}

function findPaymentOrder(state, orderId) {
  const orders = Array.isArray(state.paymentOrders) ? state.paymentOrders : [];
  const index = orders.findIndex((order) => String(order?.order_id || "") === orderId);
  return { orders, index, record: index >= 0 ? orders[index] : null };
}

async function fetchCashfreeOrder(orderId) {
  const response = await fetch(`https://api.cashfree.com/pg/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": env("CASHFREE_APP_ID"),
      "x-client-secret": env("CASHFREE_SECRET_KEY"),
      "x-api-version": "2022-09-01",
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || data?.error || `Cashfree lookup failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.cashfree = data;
    throw error;
  }

  return data || {};
}

function verifyAgainstTrustedRecord(record, cashfreeOrder) {
  const cashfreeTags = parseOrderTags(cashfreeOrder?.order_tags || {});
  const trustedContext = safeText(record?.context || record?.order_tags?.context || "").toLowerCase();
  const cashfreeContext = safeText(cashfreeTags.context || trustedContext).toLowerCase();
  const expectedAmount = Number(record?.expectedAmount ?? record?.amount ?? 0);
  const cashfreeAmount = Number(cashfreeOrder?.order_amount ?? 0);
  const cashfreeCurrency = safeText(cashfreeOrder?.order_currency || CURRENCY).toUpperCase();
  const orderStatus = safeText(cashfreeOrder?.order_status || "").toUpperCase();

  const checks = {
    orderIdMatches: safeText(cashfreeOrder?.order_id || "") === safeText(record?.order_id || ""),
    amountMatches:
      Number.isFinite(expectedAmount) &&
      Number.isFinite(cashfreeAmount) &&
      Math.abs(expectedAmount - cashfreeAmount) < 0.01,
    currencyMatches: cashfreeCurrency === CURRENCY,
    contextMatches: Boolean(trustedContext) && cashfreeContext === trustedContext,
    paid: orderStatus === "PAID",
  };

  return {
    verified:
      checks.orderIdMatches &&
      checks.amountMatches &&
      checks.currencyMatches &&
      checks.contextMatches &&
      checks.paid,
    checks,
    orderStatus,
    cashfreeTags,
  };
}

function claimedFresh(record) {
  if (record?.fulfilled) return false;
  if (record?.fulfillmentStatus !== "claimed") return false;
  const claimedAt = Date.parse(record?.claimedAt || "");
  return Boolean(claimedAt) && Date.now() - claimedAt < CLAIM_TTL_MS;
}

function safeResponse(record, verification) {
  const tags = publicOrderTags(record?.order_tags || {});

  return {
    ok: true,
    order_id: safeText(record?.order_id || ""),
    status: record?.status || "pending",
    order_status: verification?.orderStatus || record?.cashfreeOrderStatus || "",
    payment_status: record?.paymentStatus || "",
    verified: Boolean(verification?.verified || record?.verified),
    fulfilled: Boolean(record?.fulfilled),
    fulfillmentStatus: record?.fulfillmentStatus || "pending",
    context: safeText(record?.context || tags.context || "").toLowerCase(),
    amount: Number(record?.expectedAmount ?? 0),
    currency: record?.currency || CURRENCY,
    customer: {
      name: safeText(record?.customer_name || tags.customer_name || "Customer", 120),
      phone: safeText(record?.customer_phone || tags.mobile || tags.phone || "", 30),
    },
    fulfillment: {
      orderNo: `QC-${safeText(record?.order_id || "").slice(-6)}`,
      orderTags: tags,
      result: record?.fulfillmentResult || null,
      claimedAt: record?.claimedAt || null,
      fulfilledAt: record?.fulfilledAt || null,
      clientAcknowledgedAt: record?.clientAcknowledgedAt || null,
    },
    checks: verification?.checks || null,
  };
}

function updateOrder(orders, index, patch) {
  return orders.map((order, i) => (i === index ? { ...order, ...patch } : order));
}

async function updateVerifiedRecord(supabase, state, orders, index, record, verification) {
  const now = new Date().toISOString();
  const patch = {
    status: verification.verified ? "verified" : "verification_failed",
    verified: verification.verified,
    paymentStatus: verification.orderStatus,
    cashfreeOrderStatus: verification.orderStatus,
    lastVerifiedAt: now,
    verificationChecks: verification.checks,
  };

  const nextRecord = { ...record, ...patch };
  const nextState = {
    ...state,
    paymentOrders: updateOrder(orders, index, patch),
  };

  await writeState(supabase, nextState);
  return { nextState, nextRecord };
}

async function claimFulfillment(supabase, state, orders, index, record) {
  if (record?.fulfilled) return record;
  if (claimedFresh(record)) return record;

  const patch = {
    fulfillmentStatus: "claimed",
    claimedAt: new Date().toISOString(),
  };

  await writeState(supabase, {
    ...state,
    paymentOrders: updateOrder(orders, index, patch),
  });

  return { ...record, ...patch };
}

async function completeFulfillment(supabase, state, orders, index, record, result = {}) {
  const now = new Date().toISOString();
  const safeResult = sanitizeFulfillmentResult(result);
  const patch = {
    fulfilled: true,
    fulfilledAt: record?.fulfilledAt || now,
    fulfillmentStatus: "fulfilled",
    fulfillmentCompletionType: "server_secret",
    fulfillmentResult: {
      ...(record?.fulfillmentResult || {}),
      ...safeResult,
      completedAt: now,
    },
  };

  await writeState(supabase, {
    ...state,
    paymentOrders: updateOrder(orders, index, patch),
  });

  return { ...record, ...patch };
}

async function acknowledgeFulfillment(supabase, state, orders, index, record, result = {}) {
  const now = new Date().toISOString();
  const safeResult = sanitizeFulfillmentResult(result);
  const previousAcks = Array.isArray(record?.clientFulfillmentAcks)
    ? record.clientFulfillmentAcks
    : [];
  const patch = {
    fulfilled: true,
    fulfilledAt: record?.fulfilledAt || now,
    fulfillmentStatus: "client_acknowledged",
    fulfillmentCompletionType: "client_acknowledged",
    clientAcknowledgedAt: now,
    clientFulfillmentResult: safeResult,
    clientFulfillmentAcks: [
      {
        at: now,
        result: safeResult,
      },
      ...previousAcks,
    ].slice(0, MAX_CLIENT_ACKS),
  };

  await writeState(supabase, {
    ...state,
    paymentOrders: updateOrder(orders, index, patch),
  });

  return { ...record, ...patch };
}

export default async function handler(req, res) {
  const orderId = safeText(req.query?.order_id || req.body?.order_id || "", 120);
  const action = safeText(req.query?.action || req.body?.action || "", 80).toLowerCase();

  if (!orderId) {
    return res.status(400).json({ ok: false, error: "Missing order_id" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "Unsupported payment action" });
  }

  if (action && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Payment actions require POST" });
  }

  try {
    const supabase = getSupabaseClient();
    let state = await readState(supabase);
    let { orders, index, record } = findPaymentOrder(state, orderId);

    if (!record) {
      return res.status(404).json({
        ok: false,
        order_id: orderId,
        verified: false,
        fulfilled: false,
        error: "Trusted payment order not found",
      });
    }

    if (action === "complete_fulfillment") {
      if (!hasServerFulfillmentSecret(req)) {
        return res.status(403).json({ ok: false, error: "Fulfillment completion requires server authorization" });
      }

      const cashfreeOrder = await fetchCashfreeOrder(orderId);
      const verification = verifyAgainstTrustedRecord(record, cashfreeOrder);
      const verifiedUpdate = await updateVerifiedRecord(supabase, state, orders, index, record, verification);
      state = verifiedUpdate.nextState;
      record = verifiedUpdate.nextRecord;
      ({ orders, index } = findPaymentOrder(state, orderId));

      if (
        !verification.verified ||
        !["claimed", "client_acknowledged", "fulfilled"].includes(String(record?.fulfillmentStatus || ""))
      ) {
        return res.status(409).json({
          ...safeResponse(record, verification),
          ok: false,
          error: "Payment order is not ready to complete fulfillment",
        });
      }

      record = await completeFulfillment(supabase, state, orders, index, record, req.body?.result || {});
      return res.status(200).json(safeResponse(record, verification));
    }

    const cashfreeOrder = await fetchCashfreeOrder(orderId);
    const verification = verifyAgainstTrustedRecord(record, cashfreeOrder);
    const verifiedUpdate = await updateVerifiedRecord(supabase, state, orders, index, record, verification);
    state = verifiedUpdate.nextState;
    record = verifiedUpdate.nextRecord;
    ({ orders, index } = findPaymentOrder(state, orderId));

    let claimAccepted = null;

    if (action === "acknowledge_fulfillment") {
      if (!verification.verified) {
        return res.status(409).json(safeResponse(record, verification));
      }

      record = await acknowledgeFulfillment(supabase, state, orders, index, record, req.body?.result || {});
      const responsePayload = safeResponse(record, verification);
      responsePayload.acknowledged = true;
      return res.status(200).json(responsePayload);
    }

    if (action === "claim_fulfillment") {
      if (!verification.verified) {
        return res.status(409).json(safeResponse(record, verification));
      }

      const alreadyClaimed = claimedFresh(record);
      record = await claimFulfillment(supabase, state, orders, index, record);
      claimAccepted = !alreadyClaimed && !record?.fulfilled;
    }

    const responsePayload = safeResponse(record, verification);
    if (claimAccepted !== null) responsePayload.claimAccepted = claimAccepted;

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error("get-order-status error:", err);
    return res.status(err?.status || 500).json({
      ok: false,
      order_id: orderId,
      verified: false,
      fulfilled: false,
      error: err?.message || "Failed to fetch order status",
    });
  }
}
