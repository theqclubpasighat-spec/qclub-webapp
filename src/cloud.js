const AUTHENTICATED_POLL_INTERVAL_MS = 30000;
const ENDPOINT = "/api/snooker/v1/website/state";

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
  return { ...(result.state || {}), updated_at: result.updatedAt, updatedAt: result.updatedAt, __cloudUpdatedAt: result.updatedAt };
}
export function subscribeState(onState,onError) {
  let closed=false; let timer=null;
  const pull=async()=>{try{const state=await fetchLatestState();if(!closed&&state)onState(state);}catch(e){if(!closed)onError?.(e);}};
  pull();
  // Public visitors only need the initial projection. Operational sessions poll
  // at a moderate cadence instead of forcing a network request every 5 seconds.
  if (token()) timer=setInterval(pull,AUTHENTICATED_POLL_INTERVAL_MS);
  const refresh=()=>{ if (!closed) pull(); };
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
    if(["updated_at","updatedAt","__cloudUpdatedAt","admin","paymentOrders","whatsappPersistence"].includes(key)) continue;
    if(JSON.stringify(value)!==JSON.stringify(current?.[key])) patch[key]=value;
  }
  if(!Object.keys(patch).length) return {ok:true,updatedAt:baseUpdatedAt};
  const response=await fetch(ENDPOINT,{method:"PATCH",cache:"no-store",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify({baseUpdatedAt,patch})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result?.error||("Cloud write failed: "+response.status));
  return result;
}
