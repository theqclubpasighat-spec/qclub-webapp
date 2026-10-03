import { createClient } from "@supabase/supabase-js";
import { SecurityError, authenticate, publicContent, revokeSession, saveContent } from "../src/server/security/foundation.js";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function database() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.QCLUB_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new SecurityError(503, "CMS_UNAVAILABLE");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function actorView(actor) {
  const committee = actor?.staff_id === "admin-committee";
  return {
    role: committee ? "COMMITTEE" : actor?.role,
    staff_id: actor?.staff_id,
    display_name: actor?.display_name,
    expires_at: actor?.expires_at,
  };
}

export default async function handler(req, res) {
  try {
    if (req.headers?.["sec-fetch-site"] === "cross-site") {
      throw new SecurityError(403, "CROSS_SITE_REQUEST");
    }

    const action = String(req.query?.action || "").trim();
    const db = database();

    if (action === "session" && req.method === "GET") {
      const actor = await authenticate(db, req, ["ADMIN", "STAFF"]);
      return json(res, 200, actorView(actor));
    }

    if (action === "logout" && req.method === "POST") {
      await authenticate(db, req, ["ADMIN", "STAFF"]);
      return json(res, 200, await revokeSession(db, req));
    }

    if (action === "content" && req.method === "GET") {
      const actor = await authenticate(db, req, ["ADMIN", "STAFF"]);
      if (actor.role !== "ADMIN") throw new SecurityError(403, "FORBIDDEN");
      const { data, error } = await db.from("qclub_state").select("state,updated_at").eq("key", "main").single();
      if (error || !data) throw new SecurityError(503, "STATE_UNAVAILABLE");
      return json(res, 200, { content: publicContent(data.state), updatedAt: data.updated_at });
    }

    if (action === "content" && req.method === "PATCH") {
      const actor = await authenticate(db, req, ["ADMIN"]);
      if (actor.staff_id !== "admin-main") throw new SecurityError(403, "FORBIDDEN");
      return json(res, 200, await saveContent(db, actor, req.body));
    }

    throw new SecurityError(404, "NOT_FOUND");
  } catch (error) {
    return json(
      res,
      error instanceof SecurityError ? error.status : 503,
      { ok: false, error: error instanceof SecurityError ? error.code : "CMS_UNAVAILABLE" }
    );
  }
}
