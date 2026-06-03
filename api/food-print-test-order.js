import { createClient } from "@supabase/supabase-js";

const TABLE = "qclub_state";
const KEY = "main";
const TEST_TOKEN = "qclub-test-2026";

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

  if (error) throw new Error(error.message || "Supabase write failed");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const token = String(req.query?.token || req.body?.token || "").trim();

    if (token !== TEST_TOKEN) {
      return res.status(403).json({
        ok: false,
        error: "Invalid token",
      });
    }

    const supabase = getSupabaseClient();
    const state = await readState(supabase);

    const existingOrders = Array.isArray(state.foodOrders) ? state.foodOrders : [];

    const nowIso = new Date().toISOString();
    const orderId = "QC-TEST-" + Date.now().toString().slice(-6);

    const testOrder = {
      id: orderId,
      name: "Print Bridge Test",
      mobile: "9774219051",
      status: "Paid",
      total: 1,
      time: Date.now(),
      createdAt: nowIso,
      paidAt: nowIso,
      items: [
        {
          name: "Test",
          qty: 1,
          price: 1,
          lineTotal: 1,
        },
      ],
      printMeta: {
        status: "pending",
        source: "manual_test_order",
      },
    };

    const updatedOrders = [testOrder, ...existingOrders];

    await writeState(supabase, {
      ...state,
      foodOrders: updatedOrders,
    });

    return res.status(200).json({
      ok: true,
      order: testOrder,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Server error",
    });
  }
}