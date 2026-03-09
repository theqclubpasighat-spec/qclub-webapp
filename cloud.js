import { supabase, supabaseReady, getSupabaseMissingVars } from "./supabase";

// One single shared row for the whole club.
// Change this if you ever want multiple "clubs" or "seasons".
const TABLE = "qclub_state";
const KEY = "main";
const POLL_INTERVAL_MS = 5000;

export function isCloudEnabled() {
  return supabaseReady;
}

export function cloudMissingVars() {
  return getSupabaseMissingVars();
}

async function fetchLatestState() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("state, updated_at")
    .eq("key", KEY)
    .maybeSingle();

  if (error) throw error;
  return data?.state || null;
}

export function subscribeState(onState, onError) {
  if (!supabaseReady || !supabase) {
    onError?.(new Error("Supabase env vars missing: " + getSupabaseMissingVars().join(", ")));
    return () => {};
  }

  let isClosed = false;
  let pollTimer = null;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const pullLatest = async () => {
    try {
      const state = await fetchLatestState();
      if (!isClosed && state) onState(state);
    } catch (e) {
      if (!isClosed) onError?.(e);
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    pullLatest();
    pollTimer = setInterval(pullLatest, POLL_INTERVAL_MS);
  };

  // 1) Initial fetch
  pullLatest();

  // 2) Realtime updates with polling fallback
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
      if (status === "SUBSCRIBED") {
        stopPolling();
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        onError?.(new Error(`Supabase realtime status: ${status}. Falling back to polling.`));
        startPolling();
      }
    });

  return () => {
    isClosed = true;
    stopPolling();
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
