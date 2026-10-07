import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const API = "/api/snooker/v1";

function money(value) {
  const n = Number(value || 0);
  return "₹" + (Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "") : "0");
}

function clock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h,m,s].map((v) => String(v).padStart(2,"0")).join(":");
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = "Bearer " + options.token;
  const response = await fetch(API + "/" + path.replace(/^\/+/, ""), {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || "Request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function tableTokenKey(tableKey) {
  return "qclub_table_access_" + tableKey;
}

const CSS = `
.qrtable{min-height:100vh;background:radial-gradient(circle at top,#163d28 0,#07130d 42%,#020604 100%);color:#f5faf7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:18px 12px 64px}
.qrtable *{box-sizing:border-box}.qr-wrap{max-width:760px;margin:0 auto}.qr-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}.qr-logo{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#ebcb68,#8a681d);color:#11170f;font-size:26px;font-weight:950}.qr-title{font-weight:950;letter-spacing:.05em;font-size:20px}.qr-sub{color:#9ab1a2;font-size:12px;margin-top:2px}.qr-card{border:1px solid #244735;background:rgba(7,21,14,.94);border-radius:18px;padding:16px;margin:12px 0;box-shadow:0 18px 44px rgba(0,0,0,.24)}.qr-space{display:flex;justify-content:space-between;gap:12px;align-items:center}.qr-badge{display:inline-flex;padding:6px 9px;border-radius:999px;background:#173426;color:#aee4c4;font-size:12px;font-weight:850}.qr-badge.good{background:#114c2b;color:#92f2b9}.qr-badge.warn{background:#54410d;color:#ffe08a}.qr-badge.wait{background:#17345f;color:#a9ccff}.qr-huge{font-size:clamp(38px,12vw,66px);font-weight:950;letter-spacing:.04em;color:#82efad;text-align:center;margin:14px 0}.qr-due{font-size:34px;font-weight:950;color:#f1d36c}.qr-muted{color:#9eb2a5;font-size:13px;line-height:1.45}.qr-btn{border:1px solid #315943;background:#10281b;color:#f7fbf8;border-radius:12px;padding:12px 14px;font-weight:900;cursor:pointer}.qr-btn.primary{background:#78e5a8;color:#06130b;border-color:#78e5a8}.qr-btn.gold{background:#d5b548;color:#171104;border-color:#e8cc68}.qr-btn.ghost{background:transparent}.qr-btn.danger{background:#351717;border-color:#6f3535;color:#ffb8b8}.qr-btn:disabled{opacity:.45;cursor:not-allowed}.qr-row{display:flex;gap:8px;flex-wrap:wrap}.qr-input,.qr-select{width:100%;border:1px solid #31513f;background:#07150f;color:#fff;border-radius:12px;padding:12px 13px;outline:none}.qr-label{display:block;color:#aec1b5;font-size:12px;font-weight:800;margin:10px 0 5px}.qr-section{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:#e3c968;font-weight:900;margin:20px 0 9px}.qr-player{padding:10px 12px;border:1px solid #1d3a2b;border-radius:12px;background:#08160f;margin:7px 0}.qr-line{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #183123;padding:9px 0}.qr-line:last-child{border-bottom:0}.qr-order{border:1px solid #203e2f;border-radius:13px;padding:12px;margin:8px 0}.qr-item-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.qr-item{border:1px solid #1d3b2b;background:#08160f;border-radius:13px;padding:11px;min-width:0}.qr-price{color:#f0d06f;font-weight:900;margin-top:4px}.qr-qty{display:flex;align-items:center;gap:8px;margin-top:10px}.qr-qty button{width:32px;height:32px;border-radius:9px;border:1px solid #355c45;background:#11271b;color:#fff;font-weight:950}.qr-note{border:1px dashed #355440;border-radius:12px;padding:11px;color:#a9bcae;font-size:12px;line-height:1.5}.qr-error{background:#431818;border:1px solid #773535;color:#ffd0d0;border-radius:12px;padding:11px;margin:10px 0}.qr-success{background:#113d27;border:1px solid #387758;color:#bdf5d2;border-radius:12px;padding:11px;margin:10px 0}@media(max-width:560px){.qrtable{padding:12px 10px 50px}.qr-item-grid{grid-template-columns:1fr}.qr-space{align-items:flex-start}.qr-btn{flex:1}.qr-head{position:sticky;top:0;z-index:20;background:rgba(3,9,6,.92);backdrop-filter:blur(12px);padding:8px 0}}
`;

function allowedGames(table) {
  if (!table) return [];
  if (table.table_type === "POOL") return [{value:"NORMAL_POOL",label:"American Pool"}];
  return [
    {value:"NORMAL_SNOOKER",label:table.table_type === "MINI_SNOOKER" ? "Normal Mini Snooker" : "Normal Snooker"},
    {value:"QCHASE_RUMMY",label:"QChase / Rummy"},
    {value:"SIX_BALL_SNOOKER",label:"6-Ball Snooker"},
    {value:"TEN_BALL_SNOOKER",label:"10-Ball Snooker"},
    {value:"KITTY",label:"Kitty"},
  ];
}

export default function TableQrPage() {
  const params = useParams();
  const tableKey = String(params.tableKey || "").toUpperCase();
  const valid = /^T[1-4]$/.test(tableKey);
  const [token,setToken] = useState(() => {
    try { return valid ? localStorage.getItem(tableTokenKey(tableKey)) || "" : ""; } catch { return ""; }
  });
  const [data,setData] = useState(null);
  const [menu,setMenu] = useState([]);
  const [quantities,setQuantities] = useState({});
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [identifyAction,setIdentifyAction] = useState("");
  const [name,setName] = useState("");
  const [phone,setPhone] = useState("");
  const [gameType,setGameType] = useState("NORMAL_SNOOKER");
  const [tick,setTick] = useState(Date.now());
  const [receivedAt,setReceivedAt] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!valid) return;
    try {
      const payload = await request("public/table/" + tableKey, { token });
      setData(payload);
      setReceivedAt(Date.now());
      setError("");
      if (payload.request && ["REJECTED","CANCELLED","EXPIRED"].includes(payload.request.status) && token) {
        try { localStorage.removeItem(tableTokenKey(tableKey)); } catch {}
      }
    } catch (err) {
      if (err.status === 401 && token) {
        try { localStorage.removeItem(tableTokenKey(tableKey)); } catch {}
        setToken("");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [tableKey, token, valid]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!valid) return undefined;
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, valid]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()),1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!data?.own) return;
    request("public-catalogue").then((payload) => {
      const flat=[];
      Object.entries(payload.menuCatalog || {}).forEach(([key,cat]) => {
        (cat.items || []).filter((item) => item.onlineOrderEnabled && item.inStock).forEach((item) => flat.push({...item,category:cat.title||key}));
      });
      setMenu(flat);
    }).catch(() => {});
  }, [Boolean(data?.own)]);

  useEffect(() => {
    const games=allowedGames(data?.table);
    if (games.length && !games.some((g) => g.value === gameType)) setGameType(games[0].value);
  }, [data?.table]);

  const elapsed = useMemo(() => {
    if (!data?.session) return 0;
    const base=Number(data.session.elapsed_seconds||0);
    if (data.session.status !== "ACTIVE") return base;
    return base + Math.max(0,Math.floor((tick-receivedAt)/1000));
  }, [data?.session,tick,receivedAt]);

  const cart = useMemo(() => {
    let count=0,total=0;
    for (const item of menu) {
      const qty=Number(quantities[item.id]||0);
      count+=qty; total+=qty*Number(item.price||0);
    }
    return {count,total};
  }, [menu,quantities]);

  async function submitIdentity(action) {
    if (!name.trim()) { setError("Enter your name."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const payload=await request("public/table/"+tableKey+"/requests",{
        method:"POST",
        body:{request_type:action,name:name.trim(),phone:phone.trim(),game_type:action==="START"?gameType:null},
      });
      setToken(payload.access_token);
      try { localStorage.setItem(tableTokenKey(tableKey),payload.access_token); } catch {}
      setIdentifyAction("");
      setNotice(payload.message || "Request sent.");
      await request("public/table/"+tableKey,{token:payload.access_token}).then((next)=>{setData(next);setReceivedAt(Date.now());});
    } catch(err){setError(err.message);}
    finally{setBusy(false);}
  }

  async function sendOrder() {
    if (!cart.count) return;
    const lines=menu.map((item)=>({item_id:item.id,quantity:Number(quantities[item.id]||0)})).filter((line)=>line.quantity>0);
    setBusy(true);setError("");setNotice("");
    try{
      const payload=await request("public/table/"+tableKey+"/orders",{method:"POST",token,body:{lines}});
      setQuantities({});
      setNotice("Order "+payload.order.order_no+" sent to the counter. It will be charged only after staff accepts it.");
      await refresh();
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }

  function forgetAccess() {
    try { localStorage.removeItem(tableTokenKey(tableKey)); } catch {}
    setToken("");setData(null);setNotice("");setError("");setLoading(true);
  }

  if (!valid) return <div className="qrtable"><style>{CSS}</style><div className="qr-wrap"><div className="qr-error">Invalid Q Club table QR.</div></div></div>;

  const requestState=data?.request;
  const session=data?.session;
  const isQchase=session?.game_type==="QCHASE_RUMMY" && session?.payment_rule==="PER_PLAYER";

  return <div className="qrtable"><style>{CSS}</style><div className="qr-wrap">
    <div className="qr-head">
      <div className="qr-logo">Q</div>
      <div><div className="qr-title">THE Q CLUB PASIGHAT</div><div className="qr-sub">Table QR • live server session</div></div>
    </div>

    {loading ? <div className="qr-card">Loading table…</div> : null}
    {error ? <div className="qr-error">{error}</div> : null}
    {notice ? <div className="qr-success">{notice}</div> : null}

    {data ? <div className="qr-card">
      <div className="qr-space">
        <div><div className="qr-title">TABLE {data.table.table_no} — {data.table.display_name}</div><div className="qr-muted">{String(data.table.table_type||"").replaceAll("_"," ")}</div></div>
        <span className={"qr-badge "+(data.state==="AVAILABLE"?"good":"warn")}>{data.state}</span>
      </div>
      {session ? <>
        <div className="qr-huge">{clock(elapsed)}</div>
        <div className="qr-row" style={{justifyContent:"center"}}>
          <span className="qr-badge">{String(session.game_type||"").replaceAll("_"," ")}</span>
          {isQchase ? <span className={"qr-badge "+(session.qchase_game_state==="ACTIVE"?"good":"wait")}>GAME {session.qchase_game_number||1} • {session.qchase_game_state||"ACTIVE"}</span> : null}
        </div>
        <div className="qr-section">At this table</div>
        {(session.participants||[]).map((person,index)=><div className="qr-player" key={index}><strong>{person.name}</strong><span className="qr-muted"> • {person.status==="WAITING"?"Waiting for next game":"Playing"}</span></div>)}
      </> : <>
        <div className="qr-muted" style={{marginTop:12}}>This table is free. A chargeable session starts only after the Game Marshall approves your request.</div>
        <div className="qr-row" style={{marginTop:12}}><span className="qr-badge">Walk-in {money(data.table.price_per_hour_inr)}/hr</span><span className="qr-badge">Member {money(data.table.member_price_per_hour_inr)}/hr</span></div>
      </>}
    </div> : null}

    {requestState && requestState.status==="PENDING" ? <div className="qr-card">
      <div className="qr-space"><strong>REQUEST SENT</strong><span className="qr-badge wait">WAITING FOR STAFF</span></div>
      <div className="qr-muted" style={{marginTop:8}}>{requestState.request_no} • {String(requestState.request_type||"").replaceAll("_"," ")}{requestState.target_game_number?" • Game "+requestState.target_game_number:""}</div>
      <div className="qr-note" style={{marginTop:12}}>Keep playing only after staff approves. Refreshing, locking or restarting your phone will not create another table session.</div>
    </div> : null}

    {data?.own ? <div className="qr-card">
      <div className="qr-space"><div><div className="qr-title">{data.own.name}</div><div className="qr-muted">{data.own.status==="WAITING"?"Waiting for the next game":"Connected to this table"}</div></div><span className="qr-badge good">APPROVED</span></div>
      <div className="qr-section">My Club Tab</div>
      <div className="qr-space"><div className="qr-muted">Current due</div><div className="qr-due">{money(data.own.club_tab?.current_due_inr||0)}</div></div>
      <div className="qr-muted">New/unbilled {money(data.own.club_tab?.unbilled_inr||0)} • Earlier billed due {money(data.own.club_tab?.billed_due_inr||0)}</div>
      {(data.own.club_tab?.activity||[]).length ? <div style={{marginTop:12}}>{data.own.club_tab.activity.map((row,index)=><div className="qr-line" key={index}><div><strong>{row.description||row.type||"Charge"}</strong><div className="qr-muted">{row.status||""}</div></div><strong>{money(row.amount_inr)}</strong></div>)}</div> : <div className="qr-muted" style={{marginTop:12}}>No charges yet.</div>}

      <div className="qr-section">Order Food & Drinks</div>
      <div className="qr-muted" style={{marginBottom:10}}>Customer orders are sent to the counter first. Your account and stock are charged only when staff accepts the order.</div>
      <div className="qr-item-grid">
        {menu.map((item)=>{
          const qty=Number(quantities[item.id]||0);
          return <div className="qr-item" key={item.id}><strong>{item.name}</strong><div className="qr-muted">{item.category}</div><div className="qr-price">{money(item.price)}</div><div className="qr-qty"><button disabled={qty<=0} onClick={()=>setQuantities({...quantities,[item.id]:Math.max(0,qty-1)})}>−</button><strong>{qty}</strong><button onClick={()=>setQuantities({...quantities,[item.id]:qty+1})}>+</button></div></div>;
        })}
      </div>
      {menu.length ? <div className="qr-card" style={{position:"sticky",bottom:8,zIndex:10,borderColor:"#5a9c74"}}>
        <div className="qr-space"><strong>{cart.count} item(s) • {money(cart.total)}</strong><button className="qr-btn primary" disabled={busy||!cart.count} onClick={sendOrder}>{busy?"Sending…":"Send Order"}</button></div>
      </div> : <div className="qr-muted">No customer-order items are available right now.</div>}

      {(data.orders||[]).length ? <><div className="qr-section">My QR Orders</div>{data.orders.map((order)=><div className="qr-order" key={order.order_id}><div className="qr-space"><strong>{order.order_no}</strong><span className={"qr-badge "+(order.status==="PENDING"?"wait":"good")}>{order.status}</span></div><div className="qr-muted">{(order.lines||[]).map((line)=>line.name+" × "+line.quantity).join(", ")}</div><div className="qr-price">{money(order.total_inr)}</div></div>)}</> : null}
    </div> : null}

    {!requestState && data && !data.own ? <div className="qr-card">
      <div className="qr-title">{data.state==="AVAILABLE"?"Request this table":"Join / reconnect"}</div>
      <div className="qr-muted" style={{marginTop:5}}>{data.state==="AVAILABLE"?"Scanning alone never starts billing. Staff approval starts the session.":"Scanning an occupied table never starts a second session."}</div>
      <div className="qr-row" style={{marginTop:12}}>
        {data.state==="AVAILABLE" ? <button className="qr-btn primary" onClick={()=>setIdentifyAction("START")}>Request Start</button> : <>
          <button className="qr-btn primary" onClick={()=>setIdentifyAction("JOIN_CURRENT")}>{isQchase?"Join Game "+(session.qchase_game_number||1)+" now":"Join this table"}</button>
          {isQchase ? <button className="qr-btn gold" onClick={()=>setIdentifyAction("JOIN_NEXT")}>Join from Game {Number(session.qchase_game_number||0)+1}</button> : null}
          <button className="qr-btn" onClick={()=>setIdentifyAction("RECONNECT")}>I&apos;m already playing</button>
          <button className="qr-btn ghost" onClick={()=>setNotice("Spectator mode: no player account or charge has been created.")}>I&apos;m only watching</button>
        </>}
      </div>
    </div> : null}

    {identifyAction ? <div className="qr-card">
      <div className="qr-space"><strong>{identifyAction==="START"?"REQUEST START":identifyAction.replaceAll("_"," ")}</strong><button className="qr-btn ghost" onClick={()=>setIdentifyAction("")}>✕</button></div>
      <label className="qr-label">Your name</label><input className="qr-input" value={name} onChange={(e)=>setName(e.target.value.toUpperCase())} placeholder="Player name" autoComplete="name"/>
      <label className="qr-label">Mobile (optional)</label><input className="qr-input" value={phone} onChange={(e)=>setPhone(e.target.value.replace(/\D/g,"").slice(0,10))} inputMode="numeric" placeholder="10-digit mobile"/>
      {identifyAction==="START" ? <><label className="qr-label">Game</label><select className="qr-select" value={gameType} onChange={(e)=>setGameType(e.target.value)}>{allowedGames(data?.table).map((game)=><option value={game.value} key={game.value}>{game.label}</option>)}</select></> : null}
      {identifyAction==="JOIN_CURRENT"&&isQchase ? <div className="qr-note" style={{marginTop:12}}>If approved, your ₹100 QChase/Rummy charge begins with Game {session.qchase_game_number||1}. Earlier games are never charged.</div> : null}
      {identifyAction==="JOIN_NEXT"&&isQchase ? <div className="qr-note" style={{marginTop:12}}>No charge now. If approved, you wait for Game {Number(session.qchase_game_number||0)+1} and are charged when that game starts.</div> : null}
      <button className="qr-btn primary" style={{width:"100%",marginTop:12}} disabled={busy} onClick={()=>submitIdentity(identifyAction)}>{busy?"Sending…":"Send to Game Marshall"}</button>
    </div> : null}

    <div className="qr-note">Your phone is not the timer. The Q Club server keeps the table session running even if this page closes, the battery dies, Wi-Fi drops or the phone restarts. Scan the same table QR again to return.</div>
    {token ? <button className="qr-btn ghost" style={{marginTop:10}} onClick={forgetAccess}>This is not my session / clear this phone</button> : null}
  </div></div>;
}
