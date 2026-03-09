import { createClient } from "@supabase/supabase-js";

// Supabase connection (Cloud Sync)
// These must be set in:
// - Local dev: .env (same folder as package.json)
// - Vercel: Project Settings -> Environment Variables
//
// IMPORTANT: Vite exposes ONLY variables prefixed with VITE_.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function getSupabaseMissingVars() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  return missing;
}

export const supabaseReady = getSupabaseMissingVars().length === 0;

export const supabase = supabaseReady
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
