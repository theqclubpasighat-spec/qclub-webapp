import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TABLE = "qclub_state";
const KEY = "main";
const CURRENCY = "INR";
const MAX_PAYMENT_ORDERS = 500;
const ALLOWED_PAYMENT_CONTEXTS = new Set(["food", "shop", "booking", "membership", "tournament"]);

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

function cleanText(value = "", maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function cleanOrderTags(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key, value]) => cleanText(key, 80) && value !== undefined && value !== null)
      .map(([key, value]) => [cleanText(key, 80), cleanText(value, 6000)])
  );
}

async function storePaymentOrder(orderRecord) {
  const supabase = getSupabaseClient();
  const state = await readState(supabase);
  const existing = Array.isArray(state.paymentOrders) ? state.paymentOrders : [];
  const nextOrders = [
    orderRecord,
    ...existing.filter((order) => String(order?.order_id || "") !== orderRecord.order_id),
  ].slice(0, MAX_PAYMENT_ORDERS);

  await writeState(supabase, {
    ...state,
    paymentOrders: nextOrders,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      amount,
      customer_phone,
      customer_name,
      order_tags = {},
    } = req.body || {};

    const orderAmount = Number(amount || 0);

    if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid amount",
      });
    }

    const tags = cleanOrderTags(order_tags);
    const context = cleanText(tags.context || "", 60).toLowerCase();

    if (!context) {
      return res.status(400).json({
        ok: false,
        error: "Missing payment context",
      });
    }

    if (!ALLOWED_PAYMENT_CONTEXTS.has(context)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported payment context",
      });
    }

    const order_id = `order_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const customerPhone = normalizePhone(customer_phone || tags.mobile || tags.phone);
    const customerName = cleanText(customer_name || tags.customer_name || "Customer", 120) || "Customer";
    const siteUrl = cleanText(env("QCLUB_SITE_URL") || "https://www.theqclubpasighat.com", 160);

    const cashfreePayload = {
      order_id,
      order_amount: orderAmount,
      order_currency: CURRENCY,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_phone: customerPhone,
        customer_name: customerName,
      },
      order_meta: {
        return_url: `${siteUrl}/payment-status?order_id={order_id}`,
        notify_url: `${siteUrl}/api/cashfree-webhook`,
      },
      order_tags: tags,
    };

    const response = await fetch("https://api.cashfree.com/pg/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": env("CASHFREE_APP_ID"),
        "x-client-secret": env("CASHFREE_SECRET_KEY"),
        "x-api-version": "2022-09-01",
      },
      body: JSON.stringify(cashfreePayload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data?.message || data?.error || "Cashfree order creation failed",
      });
    }

    await storePaymentOrder({
      order_id,
      expectedAmount: orderAmount,
      currency: CURRENCY,
      context,
      order_tags: tags,
      customer_phone: customerPhone,
      customer_name: customerName,
      createdAt: new Date().toISOString(),
      status: "pending",
      paymentStatus: "pending",
      cashfreeOrderStatus: "",
      fulfilled: false,
      fulfilledAt: null,
      fulfillmentStatus: "pending",
      fulfillmentResult: null,
      lastVerifiedAt: null,
      webhookEvents: [],
    });

    return res.status(200).json(data);
  } catch (error) {
    console.error("create-order error:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Server error",
    });
  }
}
