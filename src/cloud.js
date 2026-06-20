import { supabase, supabaseReady, getSupabaseMissingVars } from "./supabase";

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

  if (!data) return null;

  return {
    ...(data.state || {}),
    updated_at: data.updated_at,
    updatedAt: data.updated_at,
    __cloudUpdatedAt: data.updated_at,
  };
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

  pullLatest();

  const channel = supabase
    .channel(`qclub_state:${KEY}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `key=eq.${KEY}` },
      (payload) => {
        const row = payload?.new;
        const next = row?.state;
        if (!isClosed && next) {
          onState({
            ...next,
            updated_at: row?.updated_at || next?.updated_at || null,
            updatedAt: row?.updated_at || next?.updatedAt || null,
            __cloudUpdatedAt: row?.updated_at || next?.__cloudUpdatedAt || null,
          });
        }
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
    } catch {}
  };
}

const QCLUB_REQUIRED_APP_VERSION = "2026-06-20-live-lock-v2";

export async function writeState(state) {
  if (!supabaseReady || !supabase) {
    throw new Error("Supabase env vars missing: " + getSupabaseMissingVars().join(", "));
  }

  const baseUpdatedAt =
    state?.__cloudUpdatedAt ||
    state?.updated_at ||
    state?.updatedAt ||
    null;

  if (!baseUpdatedAt) {
    throw new Error("Cloud save blocked: missing cloud revision. Refresh once before saving.");
  }

  const response = await fetch("/api/qclub-state-write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-qclub-app-version": QCLUB_REQUIRED_APP_VERSION,
    },
    body: JSON.stringify({
      key: KEY,
      state,
      appVersion: QCLUB_REQUIRED_APP_VERSION,
      baseUpdatedAt,
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result?.error || `Cloud write failed: ${response.status}`);
  }

  return result;
}