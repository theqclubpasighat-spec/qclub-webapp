import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const API_ROOT="/api/snooker/v1";

function money(value){
  return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(value||0));
}
function elapsed(seconds){
  const total=Math.max(0,Math.floor(Number(seconds||0)));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  return [h,m,s].map((v,i)=>i===0?String(v):String(v).padStart(2,"0")).join(":");
}
function storageKey(tableKey){return "qclub_table_portal_"+String(tableKey||"").toUpperCase();}
async function requestJson(path,options={}){
  const response=await fetch(API_ROOT+"/"+path,{cache:"no-store",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.message||data.error||"Request failed");error.status=response.status;throw error;}
  return data;
}
const GAME_LABELS={
  NORMAL_SNOOKER:"Normal Snooker",
  QCHASE_RUMMY:"QChase / Rummy",
  SIX_BALL_SNOOKER:"6-Ball Snooker",
  TEN_BALL_SNOOKER:"10-Ball Snooker",
  KITTY:"Kitty",
  AMERICAN_POOL:"American Pool",
};
function gameChoices(tableType){
  if(tableType==="AMERICAN_POOL")return [["AMERICAN_POOL","American Pool"]];
  if(tableType==="MINI_SNOOKER")return [["NORMAL_SNOOKER","Normal Mini Snooker"],["QCHASE_RUMMY","QChase / Rummy"],["SIX_BALL_SNOOKER","6-Ball Snooker"],["TEN_BALL_SNOOKER","10-Ball Snooker"],["KITTY","Kitty"]];
  return [["NORMAL_SNOOKER","Normal Snooker"],["QCHASE_RUMMY","QChase / Rummy"],["SIX_BALL_SNOOKER","6-Ball Snooker"],["TEN_BALL_SNOOKER","10-Ball Snooker"],["KITTY","Kitty"]];
}

export default function TableCustomerPage(){
  const params=useParams();
  const tableKey=String(params.tableKey||"").toUpperCase();
  const [state,setState]=useState(null);
  const [link,setLink]=useState(()=>{try{return JSON.parse(localStorage.getItem(storageKey(tableKey))||"null");}catch{return null;}});
  const [requestState,setRequestState]=useState(null);
  const [name,setName]=useState("");
  const [phone,setPhone]=useState("");
  const [gameType,setGameType]=useState("NORMAL_SNOOKER");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [menu,setMenu]=useState([]);
  const [cart,setCart]=useState({});
  const [orderBusy,setOrderBusy]=useState(false);

  const choices=useMemo(()=>gameChoices(state?.table?.table_type),[state?.table?.table_type]);
  useEffect(()=>{if(choices.length&&!choices.some(x=>x[0]===gameType))setGameType(choices[0][0]);},[choices,gameType]);

  async function refreshTable(){
    try{setState(await requestJson("table-public/"+encodeURIComponent(tableKey)));setError("");}
    catch(e){setError(e.message||"Unable to load table.");}
  }
  async function refreshRequest(activeLink=link){
    if(!activeLink?.request_id||!activeLink?.request_token)return;
    try{
      const data=await requestJson("table-public/request-status/"+encodeURIComponent(activeLink.request_id)+"?token="+encodeURIComponent(activeLink.request_token));
      setRequestState(data);
      if(data?.request?.status==="REJECTED"||data?.request?.status==="CANCELLED"){
        // Keep the result visible; user can clear it and request again.
      }
    }catch(e){
      if(e.status===404){try{localStorage.removeItem(storageKey(tableKey));}catch{} setLink(null);setRequestState(null);}
    }
  }
  useEffect(()=>{refreshTable();const timer=setInterval(refreshTable,2500);return()=>clearInterval(timer);},[tableKey]);
  useEffect(()=>{if(!link)return;refreshRequest(link);const timer=setInterval(()=>refreshRequest(link),2500);return()=>clearInterval(timer);},[link?.request_id,link?.request_token]);
  useEffect(()=>{if(requestState?.request?.status!=="APPROVED")return;requestJson("public-catalogue").then(data=>{
    const rows=[];
    Object.entries(data.menuCatalog||{}).forEach(([key,group])=>(group.items||[]).forEach(item=>{
      if(item.onlineOrderEnabled&&item.inStock)rows.push({...item,category:group.title||key});
    }));
    setMenu(rows);
  }).catch(()=>setMenu([]));},[requestState?.request?.status]);

  async function submit(action){
    const whatsapp=phone.replace(/\D/g,"").slice(-10);
    if(!name.trim()){setError("Enter your name.");return;}
    if(whatsapp.length!==10){setError("Enter your 10-digit WhatsApp number.");return;}
    setBusy(true);setError("");
    try{
      const data=await requestJson("table-public/"+encodeURIComponent(tableKey)+"/request",{
        method:"POST",
        body:JSON.stringify({name:name.trim(),phone:whatsapp,action,game_type:gameType})
      });
      const next={request_id:data.request_id,request_token:data.request_token};
      localStorage.setItem(storageKey(tableKey),JSON.stringify(next));
      setLink(next);
      await refreshRequest(next);
    }catch(e){setError(e.message||"Unable to send request.");}
    finally{setBusy(false);}
  }
  function clearRequest(){
    try{localStorage.removeItem(storageKey(tableKey));}catch{}
    setLink(null);setRequestState(null);setError("");
  }

  function changeQty(itemId,delta){
    setCart(current=>{
      const next={...current};
      const value=Math.max(0,Number(next[itemId]||0)+delta);
      if(value)next[itemId]=value;else delete next[itemId];
      return next;
    });
  }
  async function sendOrder(){
    const lines=Object.entries(cart).map(([item_id,quantity])=>({item_id,quantity:Number(quantity)})).filter(x=>x.quantity>0);
    if(!lines.length)return;
    setOrderBusy(true);setError("");
    try{
      await requestJson("table-public/request-status/"+encodeURIComponent(link.request_id)+"/orders?token="+encodeURIComponent(link.request_token),{
        method:"POST",body:JSON.stringify({lines})
      });
      setCart({});
      await refreshRequest(link);
    }catch(e){setError(e.message||"Unable to send order.");}
    finally{setOrderBusy(false);}
  }

  const session=state?.session;
  const own=requestState?.own;
  const req=requestState?.request;
  const approved=req?.status==="APPROVED";
  const waitingNext=req?.status==="WAITING_NEXT_GAME";
  const pending=req?.status==="PENDING";
  const rejected=req?.status==="REJECTED"||req?.status==="CANCELLED";

  return <div style={{minHeight:"100vh",background:"radial-gradient(circle at top,#173524 0,#09150f 46%,#040806 100%)",color:"#f7fbf8",padding:"18px 12px 48px",fontFamily:"Inter,system-ui,sans-serif"}}>
    <div style={{maxWidth:620,margin:"0 auto"}}>
      <div style={{fontSize:12,letterSpacing:".18em",color:"#d8b64e",fontWeight:900}}>THE Q CLUB PASIGHAT</div>
      <h1 style={{margin:"7px 0 2px",fontSize:32}}>Table {state?.table?.table_no||tableKey.replace("T","")} — {state?.table?.display_name||"Loading…"}</h1>
      <div style={{color:"#a9b9af",marginBottom:16}}>{state?.state==="PLAYING"?"LIVE TABLE":"TABLE QR"}</div>

      {error?<div style={{padding:12,border:"1px solid #7c3b3b",borderRadius:14,background:"#2e1515",marginBottom:12}}>{error}</div>:null}

      <div style={{border:"1px solid #294638",background:"rgba(8,21,15,.94)",borderRadius:18,padding:16,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
          <div>
            <div style={{fontSize:12,color:"#9fb3a6"}}>STATUS</div>
            <strong style={{fontSize:24,color:state?.state==="AVAILABLE"?"#79e7aa":"#f0d06f"}}>{state?.state||"LOADING"}</strong>
          </div>
          {session?<div style={{textAlign:"right"}}><div style={{fontSize:12,color:"#9fb3a6"}}>TABLE TIME</div><strong style={{fontSize:24}}>{elapsed(session.elapsed_seconds)}</strong></div>:null}
        </div>
        {session?<div style={{marginTop:12}}>
          <strong>{session.game_label||GAME_LABELS[session.game_type]||session.game_type}</strong>
          <div style={{color:"#a9b9af",marginTop:4}}>
            {session.current_game?.game_number?"Game "+session.current_game.game_number+" • ":""}{session.player_count} active player{session.player_count===1?"":"s"}
          </div>
          {session.active_players?.length?<div style={{marginTop:8,color:"#d9e4dd"}}>{session.active_players.map(p=>p.name).join(" • ")}</div>:null}
        </div>:<div style={{marginTop:12,color:"#a9b9af"}}>Walk-in {money(state?.table?.walkin_rate_inr)}/hr • Member {money(state?.table?.member_rate_inr)}/hr</div>}
      </div>

      {req?<div style={{border:"1px solid "+(approved?"#4c8d69":waitingNext?"#8c742a":rejected?"#7c3b3b":"#315242"),background:"#08150f",borderRadius:18,padding:16,marginBottom:12}}>
        <div style={{fontSize:12,color:"#9fb3a6"}}>YOUR REQUEST</div>
        <strong style={{fontSize:22}}>{approved?"CONNECTED":waitingNext?"WAITING FOR NEXT GAME":pending?"WAITING FOR GAME MARSHALL":rejected?"NOT APPROVED":req.status}</strong>
        {waitingNext?<div style={{marginTop:8,color:"#f0d06f"}}>You will be added and charged when the next QChase/Rummy game starts.</div>:null}
        {pending?<div style={{marginTop:8,color:"#a9b9af"}}>The Game Marshall has been notified. Do not rescan or create another session.</div>:null}
        {approved&&requestState?.session?<div style={{marginTop:10}}>
          <div>{requestState.session.game_type==="QCHASE_RUMMY"&&requestState.session.current_game?.game_number?"QChase Game "+requestState.session.current_game.game_number:"Session active"}</div>
          <div style={{color:"#a9b9af"}}>Your phone may be closed or switched off. The club server keeps the session running.</div>
        </div>:null}
        {own?<div style={{marginTop:14,padding:14,borderRadius:14,background:"#10271b"}}>
          <div style={{fontSize:12,color:"#9fb3a6"}}>YOUR CLUB TAB</div>
          <strong style={{fontSize:34,color:"#79e7aa"}}>{money(own.current_due_inr)}</strong>
          <div style={{color:"#a9b9af"}}>Games/Table {money(own.player_unbilled_inr)} • F&B {money(own.fnb_unbilled_inr)} • Earlier due {money(own.billed_due_inr)}</div>
        </div>:null}
        {rejected?<button onClick={clearRequest} style={buttonStyle("ghost")}>Make a new request</button>:null}
      </div>:null}

      {approved?<div style={{border:"1px solid #294638",background:"#08150f",borderRadius:18,padding:16,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
          <div><div style={{fontSize:12,color:"#9fb3a6"}}>ORDER FROM YOUR TABLE</div><strong style={{fontSize:22}}>Food & Drinks</strong></div>
          <div style={{textAlign:"right",color:"#f0d06f",fontWeight:900}}>{money(menu.reduce((sum,item)=>sum+Number(item.price||0)*Number(cart[item.id]||0),0))}</div>
        </div>
        {menu.length?<div style={{display:"grid",gap:8,marginTop:12,maxHeight:360,overflow:"auto"}}>
          {menu.map(item=>{
            const qty=Number(cart[item.id]||0);
            return <div key={item.id} style={{border:"1px solid #1c382a",borderRadius:12,padding:10,display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
              <div><strong>{item.name}</strong><div style={{color:"#91a69a",fontSize:12}}>{item.category} • {money(item.price)}</div></div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>changeQty(item.id,-1)} disabled={!qty} style={qtyButton}>−</button><strong>{qty}</strong><button onClick={()=>changeQty(item.id,1)} style={qtyButton}>+</button>
              </div>
            </div>;
          })}
        </div>:<div style={{color:"#91a69a",marginTop:10}}>No online-order items are available right now.</div>}
        {Object.keys(cart).length?<button disabled={orderBusy} onClick={sendOrder} style={buttonStyle("primary")}>{orderBusy?"Sending…":"Send Order • "+money(menu.reduce((sum,item)=>sum+Number(item.price||0)*Number(cart[item.id]||0),0))}</button>:null}
        {(requestState?.orders||[]).length?<div style={{marginTop:14}}>
          <div style={{fontSize:12,color:"#9fb3a6",fontWeight:800}}>YOUR RECENT ORDERS</div>
          {(requestState.orders||[]).slice(0,5).map(order=><div key={order.id} style={{marginTop:7,padding:9,borderRadius:10,background:"#10271b"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10}}><strong>{money(order.total_inr)}</strong><span style={{color:order.status==="SERVED"?"#79e7aa":order.status==="REJECTED"?"#ffb0b0":"#f0d06f"}}>{order.status}</span></div>
            <div style={{fontSize:12,color:"#a9b9af"}}>{(order.priced_lines||[]).map(x=>x.name+" × "+x.quantity).join(", ")}</div>
          </div>)}
        </div>:null}
      </div>:null}

      {!req?<div style={{border:"1px solid #294638",background:"#08150f",borderRadius:18,padding:16}}>
        <label style={labelStyle}>Your name</label>
        <input value={name} onChange={e=>setName(e.target.value.toUpperCase())} placeholder="Player name" style={inputStyle}/>
        <label style={labelStyle}>WhatsApp number (required)</label>
        <input value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,"").slice(0,10))} inputMode="numeric" placeholder="10-digit WhatsApp number" required aria-required="true" style={inputStyle}/>
        <div style={{marginTop:6,color:"#91a69a",fontSize:12}}>Required for WhatsApp order updates, bills and payment links.</div>
        {state?.state==="AVAILABLE"?<>
          <label style={labelStyle}>What do you want to play?</label>
          <select value={gameType} onChange={e=>setGameType(e.target.value)} style={inputStyle}>{choices.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>
          <button disabled={busy} onClick={()=>submit("START")} style={buttonStyle("primary")}>{busy?"Sending…":"Request Table Start"}</button>
          <div style={{marginTop:8,color:"#91a69a",fontSize:12}}>The timer starts only after the Game Marshall starts/approves the table in QclubLedger.</div>
        </>:<>
          {session?.game_type==="QCHASE_RUMMY"?<>
            <button disabled={busy||session.player_count>=session.max_players} onClick={()=>submit("JOIN_CURRENT")} style={buttonStyle("primary")}>{busy?"Sending…":"Join Current Game • ₹100"}</button>
            <button disabled={busy} onClick={()=>submit("JOIN_NEXT")} style={buttonStyle("gold")}>Join From Next Game</button>
          </>:<button disabled={busy||session?.player_count>=session?.max_players} onClick={()=>submit("JOIN_CURRENT")} style={buttonStyle("primary")}>{busy?"Sending…":"Request to Join This Table"}</button>}
          <div style={{marginTop:8,color:"#91a69a",fontSize:12}}>Scanning this QR never creates a second table session. You join the existing session after staff approval.</div>
        </>}
      </div>:null}

      <div style={{marginTop:16,padding:14,borderRadius:14,border:"1px solid #203a2d",color:"#a9b9af",fontSize:13}}>
        Closing this page, losing Wi-Fi, restarting your phone or charging a dead battery does not stop table time. Scan the same table QR again to return.
      </div>
    </div>
  </div>;
}

const qtyButton={width:32,height:32,borderRadius:9,border:"1px solid #315242",background:"#11261b",color:"white",fontWeight:900,fontSize:18};
const labelStyle={display:"block",fontSize:12,color:"#abc0b3",fontWeight:800,margin:"12px 0 6px"};
const inputStyle={width:"100%",border:"1px solid #294638",background:"#07110c",color:"#f7fbf8",borderRadius:12,padding:"12px 13px",fontSize:16,boxSizing:"border-box"};
function buttonStyle(kind){
  return {width:"100%",marginTop:12,border:"1px solid "+(kind==="gold"?"#b59132":"#3b6b50"),background:kind==="primary"?"#79e7aa":kind==="gold"?"#3b2d0d":"transparent",color:kind==="primary"?"#07130c":"#f7fbf8",borderRadius:13,padding:"13px 14px",fontSize:15,fontWeight:900,cursor:"pointer"};
}
