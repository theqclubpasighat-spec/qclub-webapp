import { createClient } from "@supabase/supabase-js";

const TABLE = "qclub_state";
const KEY = "main";

function getSupabaseClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}

function safeNum(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOrder(order = {}) {
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const qty = safeNum(item?.qty || item?.quantity || 0);
        const price = safeNum(item?.price || 0);
        const lineTotal = safeNum(item?.lineTotal ?? price * qty);

        return {
          name: String(item?.name || item?.title || "Item"),
          qty,
          price,
          lineTotal,
        };
      })
    : [];

  return {
    id: String(order?.id || ""),
    name: String(order?.name || order?.customerName || "Customer"),
    mobile: String(order?.mobile || order?.customerMobile || ""),
    total: safeNum(order?.total || order?.amount || 0),
    time: order?.time || order?.createdAt || order?.paidAt || Date.now(),
    status: String(order?.status || "paid"),
    items,
  };
}

function isBadStatus(order = {}) {
  const status = String(order?.status || "").toLowerCase();

  return [
    "failed",
    "cancelled",
    "canceled",
    "refunded",
    "archived",
    "delivered",
  ].includes(status);
}

function isPrinted(order = {}) {
  return Boolean(order?.printMeta?.printedAt) || order?.printMeta?.status === "printed";
}

function isPrintingFresh(order = {}) {
  if (order?.printMeta?.status !== "printing") return false;

  const claimedAt = order?.printMeta?.claimedAt || order?.printMeta?.printingAt;
  const claimedMs = claimedAt ? Date.parse(claimedAt) : 0;

  if (!claimedMs || Number.isNaN(claimedMs)) return false;

  const ageMs = Date.now() - claimedMs;

  // If an app claimed it but crashed, allow retry after 2 minutes.
  return ageMs < 2 * 60 * 1000;
}

function isPrintablePendingOrder(order = {}) {
  if (!order?.id) return false;
  if (isBadStatus(order)) return false;
  if (isPrinted(order)) return false;
  if (isPrintingFresh(order)) return false;

  return true;
}

function findNextPendingOrderIndex(orders = []) {
  const candidates = orders
    .map((order, index) => ({ order, index }))
    .filter(({ order }) => isPrintablePendingOrder(order))
    .sort((a, b) => safeNum(a?.order?.time || 0) - safeNum(b?.order?.time || 0));

  return candidates.length ? candidates[0].index : -1;
}

async function readState(supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("state")
    .eq("key", KEY)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Supabase read failed");
  }

  return data?.state || {};
}

async function writeState(supabase, state) {
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        key: KEY,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

  if (error) {
    throw new Error(error.message || "Supabase write failed");
  }
}

function getAction(req) {
  if (req.method === "GET") return "peek";

  const bodyAction = req.body?.action;
  const queryAction = req.query?.action;

  return String(bodyAction || queryAction || "").trim().toLowerCase();
}

function getOrderId(req) {
  return String(req.body?.orderId || req.query?.orderId || "").trim();
}

function getDeviceId(req) {
  return String(
    req.body?.deviceId ||
      req.query?.deviceId ||
      req.headers["x-qclub-print-device"] ||
      "android-print-bridge"
  ).trim();
}

function getPrintBridgeToken() {
  return String(
    process.env.QCLUB_PRINT_BRIDGE_TOKEN ||
      process.env.PRINT_BRIDGE_TOKEN ||
      ""
  ).trim();
}

function getRequestPrintToken(req) {
  return String(
    req.headers["x-qclub-print-token"] ||
      req.query?.token ||
      req.body?.token ||
      ""
  ).trim();
}

function getPrintBridgeAuth(req) {
  const configuredToken = getPrintBridgeToken();

  if (!configuredToken) {
    return {
      ok: true,
      configured: false,
      warning: "Print bridge token is not configured; temporary compatibility mode is active.",
    };
  }

  return {
    ok: getRequestPrintToken(req) === configuredToken,
    configured: true,
    warning: "",
  };
}

function withPrintBridgeAuth(payload, auth) {
  return {
    ...payload,
    printBridgeAuthConfigured: Boolean(auth?.configured),
    ...(auth?.warning ? { printBridgeAuthWarning: auth.warning } : {}),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = getPrintBridgeAuth(req);

  if (!auth.ok) {
    return res.status(401).json({
      ok: false,
      error: "Invalid print bridge token",
      printBridgeAuthConfigured: true,
    });
  }

  try {
    const supabase = getSupabaseClient();
    const action = getAction(req);
    const deviceId = getDeviceId(req);
    const send = (status, payload) =>
      res.status(status).json(withPrintBridgeAuth(payload, auth));

    const state = await readState(supabase);
    const orders = Array.isArray(state.foodOrders) ? state.foodOrders : [];

    if (action === "peek") {
      const pendingIndex = findNextPendingOrderIndex(orders);
      const pendingOrder = pendingIndex >= 0 ? orders[pendingIndex] : null;

      return send(200, {
        ok: true,
        order: pendingOrder ? normalizeOrder(pendingOrder) : null,
      });
    }

    if (action === "claim") {
      const pendingIndex = findNextPendingOrderIndex(orders);

      if (pendingIndex < 0) {
        return send(200, {
          ok: true,
          order: null,
        });
      }

      const now = new Date().toISOString();
      const order = orders[pendingIndex];

      const updatedOrder = {
        ...order,
        printMeta: {
          ...(order.printMeta || {}),
          status: "printing",
          claimedAt: now,
          printingAt: now,
          claimedBy: deviceId,
          source: "android_native_print_bridge",
        },
      };

      const updatedOrders = orders.map((item, index) =>
        index === pendingIndex ? updatedOrder : item
      );

      await writeState(supabase, {
        ...state,
        foodOrders: updatedOrders,
      });

      return send(200, {
        ok: true,
        order: normalizeOrder(updatedOrder),
      });
    }

    if (action === "printed") {
      const orderId = getOrderId(req);

      if (!orderId) {
        return send(400, {
          ok: false,
          error: "Missing orderId",
        });
      }

      const orderIndex = orders.findIndex((order) => String(order?.id || "") === orderId);

      if (orderIndex < 0) {
        return send(404, {
          ok: false,
          error: "Order not found",
        });
      }

      const now = new Date().toISOString();
      const order = orders[orderIndex];

      const updatedOrder = {
        ...order,
        printMeta: {
          ...(order.printMeta || {}),
          status: "printed",
          printedAt: now,
          printedBy: deviceId,
          printedByRole: "android_native_print_bridge",
          source: "android_native_print_bridge",
        },
      };

      const updatedOrders = orders.map((item, index) =>
        index === orderIndex ? updatedOrder : item
      );

      await writeState(supabase, {
        ...state,
        foodOrders: updatedOrders,
      });

      return send(200, {
        ok: true,
        order: normalizeOrder(updatedOrder),
      });
    }

    if (action === "failed") {
      const orderId = getOrderId(req);
      const message = String(req.body?.message || req.query?.message || "Print failed").trim();

      if (!orderId) {
        return send(400, {
          ok: false,
          error: "Missing orderId",
        });
      }

      const orderIndex = orders.findIndex((order) => String(order?.id || "") === orderId);

      if (orderIndex < 0) {
        return send(404, {
          ok: false,
          error: "Order not found",
        });
      }

      const now = new Date().toISOString();
      const order = orders[orderIndex];

      const updatedOrder = {
        ...order,
        printMeta: {
          ...(order.printMeta || {}),
          status: "pending",
          failedAt: now,
          failedBy: deviceId,
          failureMessage: message,
          source: "android_native_print_bridge",
        },
      };

      const updatedOrders = orders.map((item, index) =>
        index === orderIndex ? updatedOrder : item
      );

      await writeState(supabase, {
        ...state,
        foodOrders: updatedOrders,
      });

      return send(200, {
        ok: true,
        order: normalizeOrder(updatedOrder),
      });
    }

    return send(400, {
      ok: false,
      error: "Invalid action",
    });
  } catch (error) {
    return res.status(500).json(withPrintBridgeAuth({
      ok: false,
      error: error?.message || "Server error",
    }, auth));
  }
}
