import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TABLE = "qclub_state";
const KEY = "main";
const CURRENCY = "INR";

function env(name = "") {
  return String(process.env[name] || "").trim();
}

function getSupabaseClient() {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  const key =
    env("SUPABASE_SERVICE_ROLE_KEY") ||
    env("QCLUB_SUPABASE_SERVICE_ROLE_KEY") ||
    env("VITE_SUPABASE_ANON_KEY");

  if (!url || !key) throw new Error("Missing Supabase environment variables");

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

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function safeText(value = "", maxLength = 8000) {
  return String(value ?? "").trim().slice(0, maxLength);
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

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(rawBody, reqBody) {
  if (reqBody && typeof reqBody === "object" && !Array.isArray(reqBody)) return reqBody;
  if (!rawBody) return {};

  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function headerValue(req, names = []) {
  for (const name of names) {
    const value = req.headers?.[name.toLowerCase()] || req.headers?.[name];
    if (Array.isArray(value)) return String(value[0] || "").trim();
    if (value) return String(value).trim();
  }
  return "";
}

function verifyWebhookSignature(req, rawBody) {
  const secret = env("CASHFREE_WEBHOOK_SECRET");

  if (!secret) {
    return { configured: false, verified: false, skipped: true };
  }

  const signature = headerValue(req, [
    "x-webhook-signature",
    "x-cf-signature",
    "x-cashfree-signature",
  ]);
  const timestamp = headerValue(req, [
    "x-webhook-timestamp",
    "x-cf-timestamp",
    "x-cashfree-timestamp",
  ]);

  if (!signature) {
    return { configured: true, verified: false, error: "Missing Cashfree webhook signature header" };
  }

  const signedPayload = `${timestamp || ""}${rawBody || ""}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("base64");
  const alternate = createHmac("sha256", secret).update(rawBody || "").digest("base64");
  const candidates = [expected, alternate];

  const verified = candidates.some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  });

  return {
    configured: true,
    verified,
    error: verified ? "" : "Invalid Cashfree webhook signature",
  };
}

function formatWhatsappDateTime(value = new Date()) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const MSG91_TEMPLATE_SPECS = {
  success: {
    food: {
      envName: "MSG91_FOOD_SUCCESS_TEMPLATE",
      fallbackTemplate: "food_success_items",
      params: ["customer_name", "food_order_no", "food_items", "amount"],
    },
    shop: {
  envName: "MSG91_QSHOP_SUCCESS_TEMPLATE",
  fallbackTemplate: "qshop_success_items",
  params: ["customer_name", "qshop_order_no", "qshop_items", "amount"],
},
    booking: {
      envName: "MSG91_BOOKING_SUCCESS_TEMPLATE",
      params: ["customer_name", "booking_ref", "table_label", "booking_date", "booking_slot"],
    },
    membership: {
  envName: "MSG91_MEMBERSHIP_SUCCESS_TEMPLATE",
  params: ["customer_name", "membership_id", "tier", "valid_until"],
},
    tournament: {
      envName: "MSG91_TOURNAMENT_SUCCESS_TEMPLATE",
      params: ["customer_name", "tournament_name", "tournament_fee"],
    },
  },
  failed: {
    food: {
      envName: "MSG91_FOOD_FAILED_TEMPLATE",
      params: ["customer_name", "food_order_no", "food_items", "amount"],
    },
    shop: {
      envName: "MSG91_QSHOP_FAILED_TEMPLATE",
      params: ["customer_name", "qshop_order_no", "amount"],
    },
    booking: {
      envName: "MSG91_BOOKING_FAILED_TEMPLATE",
      params: ["customer_name", "booking_ref", "table_label", "booking_date", "booking_slot"],
    },
    membership: {
      envName: "MSG91_MEMBERSHIP_FAILED_TEMPLATE",
      params: ["customer_name", "tier", "amount"],
    },
    tournament: {
      envName: "MSG91_TOURNAMENT_FAILED_TEMPLATE",
      params: ["customer_name", "tournament_name", "tournament_fee"],
    },
  },
};

function contextKey(context = "") {
  const clean = safeText(context).toLowerCase();
  return clean === "qshop" ? "shop" : clean;
}

function getTemplateSpec(kind = "", context = "") {
  return MSG91_TEMPLATE_SPECS[kind]?.[contextKey(context)] || null;
}

function getSuccessTemplateName(context = "") {
  const spec = getTemplateSpec("success", context);
  return spec ? env(spec.envName) || spec.fallbackTemplate || "" : "";
}

function getFailedTemplateName(context = "") {
  const spec = getTemplateSpec("failed", context);
  return spec ? env(spec.envName) || spec.fallbackTemplate || "" : "";
}

function templateValue(key = "", { orderId = "", amount = 0, orderTags = {}, customerName = "" }) {
  const safeAmount = String(Number.isFinite(Number(amount)) ? Number(amount) : 0);
  const values = {
    customer_name: customerName || "Customer",
    food_order_no: `QC-${String(orderId || "").slice(-6)}`,
    qshop_order_no: `QSHOP-${String(orderId || "").replace(/^order_/, "")}`,
    booking_ref: `BK-${String(orderId || "").slice(-5)}`,
    amount: safeAmount,
    table_label: safeText(orderTags.table_label || "Booked Table"),
    booking_date: safeText(orderTags.booking_date || "—"),
    booking_slot: safeText(orderTags.booking_slot || "—"),
    tier: safeText(orderTags.tier || "Member"),
    activated_at: formatWhatsappDateTime(new Date()),
    valid_until: safeText(orderTags.valid_until || "—"),
    tournament_name: safeText(orderTags.tournament_name || "Tournament"),
    tournament_fee: safeText(orderTags.tournament_fee || safeAmount),
  };

  return safeText(values[key] ?? "—", 1200) || "—";
}

function buildTemplateParams(kind = "", payload = {}) {
  const spec = getTemplateSpec(kind, payload.context);
  if (!spec) return [];
  return spec.params.map((key) => templateValue(key, payload));
}

function buildSuccessTemplateParams({ context = "", orderId = "", amount = 0, orderTags = {}, customerName = "" }) {
  const clean = safeText(context).toLowerCase();
  const safeAmount = String(Number.isFinite(Number(amount)) ? Number(amount) : 0);

  if (clean === "shop") {
  const qshopItemsFromJson = buildShopItemsBreakupText(
    normalizeShopPurchaseEntries(orderTags.shop_items_json || "[]")
  );
  const qshopItemsText = safeText(
    qshopItemsFromJson ||
      orderTags.shop_items ||
      orderTags.qshop_items ||
      orderTags.items ||
      orderTags.items_text ||
      "Q Shop items"
  );

  return [
    customerName || "Customer",
    `QSHOP-${String(orderId || "").replace(/^order_/, "")}`,
    qshopItemsText,
    safeAmount,
  ];
}

    if (clean === "food") {
    const foodItemsText = safeText(
      orderTags.food_items ||
        orderTags.items ||
        orderTags.items_text ||
        orderTags.food_items_text ||
        "Food items"
    );

    return [
      customerName || "Customer",
      `QC-${String(orderId || "").slice(-6)}`,
      foodItemsText,
      safeAmount,
    ];
  }

  if (clean === "booking") {
    return [
      customerName || "Customer",
      `BK-${String(orderId || "").slice(-5)}`,
      safeText(orderTags.table_label || "Booked Table"),
      safeText(orderTags.booking_date || "—"),
      safeText(orderTags.booking_slot || "—"),
    ];
  }

    if (clean === "membership") {
    const membershipId = safeText(
      orderTags.membership_id ||
        orderTags.member_id ||
        orderTags.membershipId ||
        `MEM-${String(orderId || "").slice(-6)}`
    );

    const membershipPlan = safeText(
      orderTags.tier ||
        orderTags.plan ||
        orderTags.membership_plan ||
        orderTags.membershipPlan ||
        "Membership"
    );

    return [
      customerName || "Member",
      membershipId,
      membershipPlan,
      safeText(orderTags.valid_until || orderTags.validTill || "—"),
    ];
  }

  if (clean === "tournament") {
    return [
      customerName || "Player",
      safeText(orderTags.tournament_name || "Tournament"),
      safeText(orderTags.tournament_fee || safeAmount),
    ];
  }

  return [];
}

function buildFailedTemplateParams({ context = "", orderId = "", amount = 0, orderTags = {}, customerName = "" }) {
  const clean = safeText(context).toLowerCase();
  const safeAmount = String(Number.isFinite(Number(amount)) ? Number(amount) : 0);

  if (clean === "shop") return [customerName || "Customer", `QSHOP-${String(orderId || "").replace(/^order_/, "")}`, safeAmount];
  if (clean === "food") {
    const foodItemsText = safeText(
      orderTags.food_items ||
        orderTags.items ||
        orderTags.items_text ||
        orderTags.food_items_text ||
        "Food items"
    );

    return [
      customerName || "Customer",
      `QC-${String(orderId || "").slice(-6)}`,
      foodItemsText,
      safeAmount,
    ];
  }

  if (clean === "booking") {
    return [
      customerName || "Customer",
      `BK-${String(orderId || "").slice(-5)}`,
      safeText(orderTags.table_label || "Booked Table"),
      safeText(orderTags.booking_date || "—"),
      safeText(orderTags.booking_slot || "—"),
    ];
  }

  if (clean === "membership") return [customerName || "Member", safeText(orderTags.tier || "Member"), safeAmount];
  if (clean === "tournament") return [customerName || "Player", safeText(orderTags.tournament_name || "Tournament"), safeText(orderTags.tournament_fee || safeAmount)];

  return [];
}

async function sendMsg91Template({
  phone,
  templateName,
  templateParams = [],
  label = "",
  textPreview = "",
  expectedParamCount = null,
}) {
  const authKey = env("MSG91_AUTH_KEY");
  const integratedNumber = env("MSG91_SENDER_NUMBER");
  const normalizedPhone = normalizePhone(phone);

  if (!authKey) throw new Error("Missing MSG91_AUTH_KEY");
  if (!integratedNumber) throw new Error("Missing MSG91_SENDER_NUMBER");
  if (!templateName) throw new Error("Missing MSG91 template name");
  if (!normalizedPhone) throw new Error("Missing recipient phone");
  if (Number.isInteger(expectedParamCount) && templateParams.length !== expectedParamCount) {
    throw new Error(
      `MSG91 template ${templateName} expects ${expectedParamCount} params, got ${templateParams.length}`
    );
  }

  const payload = {
    integrated_number: integratedNumber,
    content_type: "template",
    payload: {
      to: normalizedPhone,
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: safeText(templateName, 120),
        language: {
          code: "en",
          policy: "deterministic",
        },
        components: Array.isArray(templateParams) && templateParams.length
          ? [
              {
                type: "body",
                parameters: templateParams.map((value) => ({
                  type: "text",
                  text: safeText(value, 1200),
                })),
              },
            ]
          : [],
      },
    },
    meta: {
      label: safeText(label, 120),
      textPreview: safeText(textPreview, 1200),
      provider: "msg91",
    },
  };

  const response = await fetch(
    "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify(payload),
    }
  );

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(json?.message || json?.error || `MSG91 request failed with status ${response.status}`);
  }

  return json;
}


function parseTrustedArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeNum(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeShopPurchaseEntries(rawCart = []) {
  return parseTrustedArray(rawCart, [])
    .map((entry) => {
      const itemId = safeText(entry?.itemId || entry?.id || "", 160);
      const qty = Math.max(0, safeNum(entry?.qty, 0));
      const price = safeNum(entry?.price, 0);
      const lineTotal = safeNum(entry?.lineTotal ?? price * qty, price * qty);
      const displayName = safeText(entry?.displayName || entry?.name || "Item", 300);
      const selectedOptionId = safeText(entry?.selectedOptionId || "", 160);
      const selectedOptionLabel = safeText(entry?.selectedOptionLabel || "", 300);

      if (!itemId || qty <= 0) return null;

      return {
        id: itemId,
        itemId,
        name: safeText(entry?.name || displayName || "Item", 300),
        displayName,
        qty,
        price,
        lineTotal,
        selectedOptionId,
        selectedOptionLabel,
      };
    })
    .filter(Boolean);
}

function buildShopItemsBreakupText(entries = []) {
  return (entries || [])
    .map((entry, index) => {
      const name = safeText(entry?.displayName || entry?.name || "Item", 300) || "Item";
      const qty = Math.max(0, safeNum(entry?.qty, 0));
      const price = safeNum(entry?.price, 0);
      const lineTotal = safeNum(entry?.lineTotal ?? price * qty, price * qty);

      if (!qty) return "";
      return `${index + 1}. ${name} x ${qty} = ₹${lineTotal}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildWebhookShopReceipt({ orderId, customerName, phone, items, total, createdAt }) {
  const cleanOrderId = safeText(orderId || "");
  return {
    id: `QSHOP-${cleanOrderId.replace(/^order_/, "")}`,
    orderNo: `QSHOP-${cleanOrderId.replace(/^order_/, "")}`,
    gatewayOrderId: cleanOrderId,
    customerName: customerName || "Customer",
    customerMobile: phone || "",
    items,
    total: safeNum(total, 0),
    paymentStatus: "Paid",
    pickupStatus: "Pending Pickup",
    createdAt,
    updatedAt: createdAt,
    stockAdjusted: true,
    stockAdjustedAt: createdAt,
    source: "cashfree_webhook",
  };
}

function fulfilQShopInState(state, { orderId, customerName, phone, amount, orderTags, now }) {
  const purchases = normalizeShopPurchaseEntries(orderTags.shop_items_json || "[]");
  if (!purchases.length) {
    return {
      state,
      result: {
        stockAdjusted: false,
        receiptInserted: false,
        reason: "missing_shop_items_json",
      },
    };
  }

  const existingReceipts = Array.isArray(state.shopReceipts) ? state.shopReceipts : [];
  const existingReceipt = existingReceipts.find(
    (receipt) => safeText(receipt?.gatewayOrderId || "") === safeText(orderId || "")
  );

  if (existingReceipt?.stockAdjusted === true) {
    return {
      state,
      result: {
        stockAdjusted: false,
        receiptInserted: false,
        duplicate: true,
        reason: "already_stock_adjusted",
      },
    };
  }

  const existingItems = Array.isArray(state?.shopCatalog?.items) ? state.shopCatalog.items : [];

  const nextItems = existingItems.map((item) => {
    const itemId = safeText(item?.id || "");
    const purchasesForItem = purchases.filter((purchase) => safeText(purchase.itemId || "") === itemId);

    if (!purchasesForItem.length) return item;

    if (Array.isArray(item.options) && item.options.length > 0) {
      return {
        ...item,
        options: item.options.map((option) => {
          const optionId = safeText(option?.id || "");
          const purchasedQty = purchasesForItem
            .filter((purchase) => safeText(purchase.selectedOptionId || "") === optionId)
            .reduce((sum, purchase) => sum + safeNum(purchase.qty, 0), 0);

          return purchasedQty > 0
            ? {
                ...option,
                stock: Math.max(0, safeNum(option.stock, 0) - purchasedQty),
              }
            : option;
        }),
      };
    }

    const purchasedQty = purchasesForItem.reduce(
      (sum, purchase) => sum + safeNum(purchase.qty, 0),
      0
    );

    return {
      ...item,
      stock: Math.max(0, safeNum(item.stock, 0) - purchasedQty),
    };
  });

  const receipt = buildWebhookShopReceipt({
    orderId,
    customerName,
    phone,
    items: purchases,
    total: amount,
    createdAt: now,
  });

  const nextReceipts = existingReceipt
    ? existingReceipts.map((r) =>
        safeText(r?.gatewayOrderId || "") === safeText(orderId || "")
          ? {
              ...r,
              ...receipt,
              stockAdjusted: true,
              stockAdjustedAt: r.stockAdjustedAt || now,
            }
          : r
      )
    : [receipt, ...existingReceipts];

  return {
    state: {
      ...state,
      shopReceipts: nextReceipts,
      shopCatalog: {
        ...(state.shopCatalog || {}),
        items: nextItems,
      },
    },
    result: {
      stockAdjusted: true,
      receiptInserted: !existingReceipt,
      itemsCount: purchases.reduce((sum, purchase) => sum + safeNum(purchase.qty, 0), 0),
      itemsText: buildShopItemsBreakupText(purchases),
    },
  };
}

function isFailureLikeStatus(status = "") {
  const clean = safeText(status).toUpperCase();

  return ["FAILED", "FAILURE", "USER_DROPPED", "CANCELLED", "CANCELED", "NOT_ATTEMPTED"].includes(clean);
}

function findPaymentOrder(state, orderId) {
  const orders = Array.isArray(state.paymentOrders) ? state.paymentOrders : [];
  const index = orders.findIndex((order) => safeText(order?.order_id || "") === orderId);
  return { orders, index, record: index >= 0 ? orders[index] : null };
}

function updateOrder(orders, index, patch) {
  return orders.map((order, i) => (i === index ? { ...order, ...patch } : order));
}

function parseWebhook(body) {
  const data = body?.data || {};
  const order = data?.order || {};
  const payment = data?.payment || {};
  const customer = data?.customer_details || data?.customer || order?.customer_details || body?.customer_details || {};
  const orderTags = parseOrderTags(order?.order_tags || body?.order_tags || data?.order_tags || {});

  return {
    orderId: safeText(order?.order_id || body?.order_id || ""),
    paymentStatus: safeText(payment?.payment_status || body?.payment_status || data?.payment_status || "").toUpperCase(),
    amount: Number(order?.order_amount ?? body?.order_amount ?? 0),
    currency: safeText(order?.order_currency || body?.order_currency || CURRENCY).toUpperCase(),
    orderTags,
    customerName: safeText(customer?.customer_name || body?.customer_name || orderTags.customer_name || "Customer", 120) || "Customer",
    phone: normalizePhone(customer?.customer_phone || body?.customer_phone || orderTags.mobile || orderTags.phone || ""),
  };
}

function webhookMatchesTrusted(record, parsed) {
  const trustedContext = safeText(record?.context || record?.order_tags?.context || "").toLowerCase();
  const webhookContext = safeText(parsed?.orderTags?.context || trustedContext).toLowerCase();
  const expectedAmount = Number(record?.expectedAmount ?? 0);

  return (
    safeText(record?.order_id || "") === parsed.orderId &&
    Number.isFinite(expectedAmount) &&
    Number.isFinite(parsed.amount) &&
    Math.abs(expectedAmount - parsed.amount) < 0.01 &&
    parsed.currency === CURRENCY &&
    trustedContext &&
    webhookContext === trustedContext
  );
}

async function writePaymentPatch(supabase, state, orders, index, patch) {
  await writeState(supabase, {
    ...state,
    paymentOrders: updateOrder(orders, index, patch),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = verifyWebhookSignature(req, rawBody);

    if (signature.configured && !signature.verified) {
      return res.status(401).json({
        ok: false,
        error: signature.error || "Cashfree webhook signature verification failed",
      });
    }

    const body = parseBody(rawBody, req.body);
    const parsed = parseWebhook(body);

    if (!parsed.orderId) {
      return res.status(200).json({ ok: true, skipped: true, reason: "Missing order_id" });
    }

    const supabase = getSupabaseClient();
    const state = await readState(supabase);
    const { orders, index, record } = findPaymentOrder(state, parsed.orderId);

    if (!record) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        orderId: parsed.orderId,
        reason: "Trusted payment order not found",
        signatureConfigured: signature.configured,
      });
    }

    const trustedOrderTags = parseOrderTags(record.order_tags || {});
    const context = safeText(record.context || trustedOrderTags.context || "").toLowerCase();
    const customerName = safeText(record.customer_name || parsed.customerName || "Customer", 120) || "Customer";
    const phone = normalizePhone(record.customer_phone || parsed.phone);
    const verified = webhookMatchesTrusted(record, parsed);
    const now = new Date().toISOString();

    const basePatch = {
      paymentStatus: parsed.paymentStatus,
      cashfreeOrderStatus: parsed.paymentStatus,
      lastWebhookAt: now,
      webhookSignatureVerified: signature.verified,
      webhookSignatureConfigured: signature.configured,
      webhookChecks: {
        trustedMatch: verified,
        amount: parsed.amount,
        currency: parsed.currency,
      },
    };

    if (!verified) {
      await writePaymentPatch(supabase, state, orders, index, {
        ...basePatch,
        status: "webhook_verification_failed",
      });

      return res.status(200).json({
        ok: true,
        skipped: true,
        orderId: parsed.orderId,
        reason: "Webhook did not match trusted order record",
        signatureConfigured: signature.configured,
      });
    }

    if (parsed.paymentStatus === "SUCCESS") {
      let stateForSuccess = state;
      let shopFulfillmentResult = null;
      let shopFulfillmentPatch = {};

      if (context === "shop") {
        const fulfilled = fulfilQShopInState(state, {
          orderId: parsed.orderId,
          customerName,
          phone,
          amount: record.expectedAmount,
          orderTags: trustedOrderTags,
          now,
        });

        stateForSuccess = fulfilled.state;
        shopFulfillmentResult = fulfilled.result;
        shopFulfillmentPatch = {
          fulfilled: true,
          fulfilledAt: record.fulfilledAt || now,
          fulfillmentStatus: "fulfilled",
          fulfillmentCompletionType: "cashfree_webhook",
          fulfillmentResult: {
            ...(record.fulfillmentResult || {}),
            qshopStock: shopFulfillmentResult,
          },
        };
      }

      const successBasePatch = {
        ...basePatch,
        verified: true,
        status: "verified",
        ...shopFulfillmentPatch,
      };

      if (record?.webhookWhatsapp?.successSentAt) {
        await writePaymentPatch(supabase, stateForSuccess, orders, index, successBasePatch);

        return res.status(200).json({
          ok: true,
          received: true,
          orderId: parsed.orderId,
          paymentStatus: parsed.paymentStatus,
          context,
          whatsappSent: false,
          duplicate: true,
          signatureConfigured: signature.configured,
        });
      }

      const templateName = getSuccessTemplateName(context);
      if (!templateName || !phone) {
        await writePaymentPatch(supabase, stateForSuccess, orders, index, {
          ...successBasePatch,
          webhookWhatsapp: {
            ...(record.webhookWhatsapp || {}),
            successSkippedAt: now,
            successSkipReason: !templateName ? "Missing success template" : "Missing phone",
          },
        });

        return res.status(200).json({
          ok: true,
          skipped: true,
          orderId: parsed.orderId,
          context,
          reason: !templateName ? "Missing success template" : "Missing phone",
          signatureConfigured: signature.configured,
        });
      }

      const templateParams = buildSuccessTemplateParams({
        context,
        orderId: parsed.orderId,
        amount: record.expectedAmount,
        orderTags: trustedOrderTags,
        customerName,
      });
      const successSpec = getTemplateSpec("success", context);

      await writePaymentPatch(supabase, stateForSuccess, orders, index, successBasePatch);

      let whatsappSent = false;
      let whatsappResponse = null;
      let whatsappError = "";

      try {
        whatsappResponse = await sendMsg91Template({
          phone,
          templateName,
          templateParams,
          label: `${context}_success_webhook`,
          textPreview: `${context} payment success for ${parsed.orderId}`,
          expectedParamCount: successSpec?.params?.length ?? null,
        });
        whatsappSent = true;
      } catch (msg91Error) {
        whatsappError = msg91Error?.message || "MSG91 send failed";
        console.error("MSG91 success WhatsApp failed, but payment fulfilment will continue:", msg91Error);
      }

      await writePaymentPatch(supabase, stateForSuccess, orders, index, {
        ...successBasePatch,
        webhookWhatsapp: {
          ...(record.webhookWhatsapp || {}),
          ...(whatsappSent
            ? {
                successSentAt: now,
                successTemplateName: templateName,
                successResponse: whatsappResponse,
              }
            : {
                successFailedAt: now,
                successTemplateName: templateName,
                successError: whatsappError,
              }),
        },
      });

      return res.status(200).json({
        ok: true,
        received: true,
        orderId: parsed.orderId,
        paymentStatus: parsed.paymentStatus,
        context,
        whatsappSent,
        whatsappError,
        templateName,
        signatureConfigured: signature.configured,
      });
    }

    if (!isFailureLikeStatus(parsed.paymentStatus)) {
      await writePaymentPatch(supabase, state, orders, index, basePatch);
      return res.status(200).json({
        ok: true,
        skipped: true,
        orderId: parsed.orderId,
        paymentStatus: parsed.paymentStatus,
        reason: `Ignoring non-final payment status: ${parsed.paymentStatus || "UNKNOWN"}`,
        signatureConfigured: signature.configured,
      });
    }

    if (record?.webhookWhatsapp?.failedSentAt) {
      return res.status(200).json({
        ok: true,
        received: true,
        orderId: parsed.orderId,
        paymentStatus: parsed.paymentStatus,
        context,
        whatsappSent: false,
        duplicate: true,
        signatureConfigured: signature.configured,
      });
    }

    const templateName = getFailedTemplateName(context);
    if (!templateName || !phone) {
      await writePaymentPatch(supabase, state, orders, index, {
        ...basePatch,
        status: "failed",
        webhookWhatsapp: {
          ...(record.webhookWhatsapp || {}),
          failedSkippedAt: now,
          failedSkipReason: !templateName ? "Missing failed template" : "Missing phone",
        },
      });

      return res.status(200).json({
        ok: true,
        skipped: true,
        orderId: parsed.orderId,
        context,
        reason: !templateName ? "Missing failed template" : "Missing phone",
        signatureConfigured: signature.configured,
      });
    }

    const templateParams = buildFailedTemplateParams({
      context,
      orderId: parsed.orderId,
      amount: record.expectedAmount,
      orderTags: trustedOrderTags,
      customerName,
    });
    const failedSpec = getTemplateSpec("failed", context);

    const response = await sendMsg91Template({
      phone,
      templateName,
      templateParams,
      label: `${context}_failed_webhook`,
      textPreview: `${context} payment failed for ${parsed.orderId}`,
      expectedParamCount: failedSpec?.params?.length ?? null,
    });

    await writePaymentPatch(supabase, state, orders, index, {
      ...basePatch,
      status: "failed",
      webhookWhatsapp: {
        ...(record.webhookWhatsapp || {}),
        failedSentAt: now,
        failedTemplateName: templateName,
        failedResponse: response,
      },
    });

    return res.status(200).json({
      ok: true,
      received: true,
      orderId: parsed.orderId,
      paymentStatus: parsed.paymentStatus,
      context,
      whatsappSent: true,
      templateName,
      signatureConfigured: signature.configured,
    });
  } catch (error) {
    console.error("Cashfree webhook error:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Webhook server error",
    });
  }
}


