import { supabase, supabaseReady, getSupabaseMissingVars } from "./supabase";

// One single shared row for the whole club.
// Change this if you ever want multiple "clubs" or "seasons".
const TABLE = "qclub_state";
const KEY = "main";

export function isCloudEnabled() {
  return supabaseReady;
}

export function cloudMissingVars() {
  return getSupabaseMissingVars();
}

export function subscribeState(onState, onError) {
  if (!supabaseReady || !supabase) {
    onError?.(new Error("Supabase env vars missing: " + getSupabaseMissingVars().join(", ")));
    return () => {};
  }

  let isClosed = false;

  // 1) Initial fetch
  (async () => {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("state")
        .eq("key", KEY)
        .maybeSingle();
      if (!isClosed && !error && data?.state) onState(data.state);
      if (!isClosed && error) onError?.(error);
    } catch (e) {
      if (!isClosed) onError?.(e);
    }
  })();

  // 2) Realtime updates (optional; still works without realtime)
  const channel = supabase
    .channel(`qclub_state:${KEY}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `key=eq.${KEY}` },
      (payload) => {
        const next = payload?.new?.state;
        if (!isClosed && next) onState(next);
      }
    )
    .subscribe((status) => {
      // If realtime isn't enabled, Supabase may not deliver changes.
      // We keep the app working anyway (writes + next reload will sync).
      if (status === "CHANNEL_ERROR") {
        onError?.(new Error("Supabase realtime channel error (sync will work on refresh)."));
      }
    });

  return () => {
    isClosed = true;
    try {
      supabase.removeChannel(channel);
    } catch {
      // ignore
    }
  };
}

export async function writeState(state) {
  if (!supabaseReady || !supabase) {
    throw new Error("Supabase env vars missing: " + getSupabaseMissingVars().join(", "));
  }

  const payload = {
    key: KEY,
    state,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: "key" });
  if (error) throw error;
}
