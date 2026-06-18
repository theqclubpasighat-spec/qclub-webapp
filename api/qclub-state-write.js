import { createClient } from "@supabase/supabase-js";

const REQUIRED_APP_VERSION = "2026-06-18-live-safe-cloud-v1";
const TABLE = "qclub_state";
const KEY = "main";

function json(res, status, body) {
  res.status(status).json(body);
}

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or Supabase URL in Vercel environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const headerVersion = String(req.headers["x-qclub-app-version"] || "").trim();
  const bodyVersion = String(req.body?.appVersion || "").trim();

  if (headerVersion !== REQUIRED_APP_VERSION || bodyVersion !== REQUIRED_APP_VERSION) {
    return json(res, 409, {
      error: "Old app version blocked. Refresh the Q Club app before saving.",
      requiredVersion: REQUIRED_APP_VERSION,
    });
  }

  const key = String(req.body?.key || KEY).trim();

  if (key !== KEY) {
    return json(res, 400, { error: "Invalid state key." });
  }

  const state = req.body?.state;

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return json(res, 400, { error: "Invalid state payload." });
  }

  try {
    const supabase = getSupabaseAdmin();

    const payload = {
      key: KEY,
      state,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: "key" });

    if (error) {
      console.error("qclub-state-write Supabase error:", error);
      return json(res, 500, { error: error.message || "Supabase write failed." });
    }

    return json(res, 200, {
      ok: true,
      updatedAt: payload.updated_at,
      version: REQUIRED_APP_VERSION,
    });
  } catch (error) {
    console.error("qclub-state-write fatal error:", error);
    return json(res, 500, {
      error: error?.message || "Cloud write failed.",
    });
  }
}