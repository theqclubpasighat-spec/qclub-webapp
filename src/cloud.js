const AUTHENTICATED_POLL_INTERVAL_MS = 30000;
const ENDPOINT = "/api/snooker/v1/website/state";
const ROLE_WRITABLE_KEYS = Object.freeze({
  STAFF: new Set(["booking", "foodOrders", "archivedFoodOrders", "shopReceipts",
    "inventoryItems", "speakerAlerts", "whatsappJobs", "matchLedger", "qChaseActiveGames"]),
  COMMITTEE: new Set(["players", "reviewHistory"]),
});
// This list mirrors, but does not replace, the server's authoritative whitelist.
// A signed-in staff member must never send public CMS settings in a whole-state
// housekeeping patch just because legacy hydration filled their local copy.
export function allowedWebsitePatchForRole(role, patch, current = {}) {
  if (role === "ADMIN") return patch;
  const allowed = ROLE_WRITABLE_KEYS[role];
  if (!allowed) throw new Error("Secure session expired or role unavailable. Sign in again.");
  const result = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.has(key)) continue;
    if (role === "STAFF" && key === "booking") {
      const before = current.booking || {};
      // The staff role may manage requests/blocked slots, NOT booking table rates.
      result.booking = {
        ...before,
        requests: value?.requests ?? before.requests ?? [],
        blockedSlots: value?.blockedSlots ?? before.blockedSlots ?? [],
        lastSeenRequestAt: value?.lastSeenRequestAt ?? before.lastSeenRequestAt,
      };
      if (JSON.stringify(result.booking) === JSON.stringify(before)) delete result.booking;
      continue;
    }
    result[key] = value;
  }
  return result;
}


export function isCloudEnabled() { return true; }
export function cloudMissingVars() { return []; }

function token() {
  try { return sessionStorage.getItem("qclub_admin_access_token_v2") || ""; } catch { return ""; }
}
async function fetchLatestState() {
  const t = token();
  const response = await fetch(ENDPOINT, { cache: "no-store", headers: t ? { Authorization: "Bearer " + t } : {} });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "Cloud read failed");
  return { ...(result.state || {}), updated_at: result.updatedAt, updatedAt: result.updatedAt, __cloudUpdatedAt: result.updatedAt, __cloudRole: result.role || null };
}
export function subscribeState(onState,onError) {
  let closed=false; let timer=null;
  const pull=async()=>{try{const state=await fetchLatestState();if(!closed&&state)onState(state);}catch(e){if(!closed)onError?.(e);}};
  pull();
  // Public visitors only need the initial projection. Operational sessions poll
  // at a moderate cadence instead of forcing a network request every 5 seconds.
  if (token()) timer=setInterval(pull,AUTHENTICATED_POLL_INTERVAL_MS);
  const refresh=()=>{ if(timer)clearInterval(timer); timer=token()?setInterval(pull,AUTHENTICATED_POLL_INTERVAL_MS):null; if (!closed) pull(); };
  const onVisibility=()=>{ if (document.visibilityState === "visible" && token()) pull(); };
  window.addEventListener("qclub-secure-session-changed",refresh);
  document.addEventListener("visibilitychange",onVisibility);
  return()=>{closed=true;if(timer)clearInterval(timer);window.removeEventListener("qclub-secure-session-changed",refresh);document.removeEventListener("visibilitychange",onVisibility);};
}
export async function writeState(state) {
  const t=token();
  if(!t) throw new Error("Secure session required. Sign in again.");
  const baseUpdatedAt=state?.__cloudUpdatedAt||state?.updated_at||state?.updatedAt||null;
  if(!baseUpdatedAt) throw new Error("Cloud save blocked: missing cloud revision. Refresh once before saving.");
  const current=await fetchLatestState();
  const patch={};
  for(const [key,value] of Object.entries(state||{})){
    if(["updated_at","updatedAt","__cloudUpdatedAt","__cloudRole","admin","paymentOrders","whatsappPersistence"].includes(key)) continue;
    const comparable = v => key==='jobApplications' && Array.isArray(v)
      ? v.map(app=>{const next={...app};for(const field of ['photo','aadhaarFile','panFile'])if(next[field]?.path)next[field]={path:next[field].path};return next;}) : v;
    if(JSON.stringify(comparable(value))!==JSON.stringify(comparable(current?.[key]))) patch[key]=value;
  }
  const filteredPatch=allowedWebsitePatchForRole(current.__cloudRole,patch,current);
  if(!Object.keys(filteredPatch).length) return {ok:true,updatedAt:current.__cloudUpdatedAt};

  const response=await fetch(ENDPOINT,{method:"PATCH",cache:"no-store",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify({baseUpdatedAt,patch:filteredPatch})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result?.error||("Cloud write failed: "+response.status));
  return result;
}
