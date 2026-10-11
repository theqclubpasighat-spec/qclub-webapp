import React, { useMemo, useState } from "react";
import { REGISTER_GAME_TYPES, registerTableAllowsGame } from "../lib/daily-register.js";

const price = n => "₹" + Number(n || 0).toLocaleString("en-IN",{maximumFractionDigits:2});
const activeSession = x => ["ACTIVE","PAUSED"].includes(x?.status);
const supportedRates = new Set(["SIX_BALL_SNOOKER","TEN_BALL_SNOOKER","QCHASE_RUMMY"]);

export default function DailyRegisterChargeModal({
  customer, tables=[], rules=[], sessions=[], busy=false, previewMode=false, demoMode=false,
  onClose, onPost, onStartTimed, onContinue, onSimulate,
}) {
  const [gameType,setGameType] = useState("SIX_BALL_SNOOKER");
  const [tableId,setTableId] = useState(customer?.open_tab?.active_locations?.[0]?.table_id || "table_1");
  const [count,setCount] = useState(1);
  const [championship,setChampionship] = useState(false);
  const [hourly,setHourly] = useState(false);
  const [posting,setPosting] = useState(false);
  const [error,setError] = useState("");
  const [key] = useState(()=>"reg-"+(globalThis.crypto?.randomUUID?.() || Date.now()+"-"+Math.random().toString(36).slice(2)));
  const availableGames = useMemo(()=>REGISTER_GAME_TYPES.filter(g=>rules.some(r=>r.game_type===g.id && r.active!==false)),[rules]);
  const compatibleTables = useMemo(()=>tables.filter(t=>registerTableAllowsGame(t,gameType)),[tables,gameType]);
  const table = compatibleTables.find(t=>t.table_id===tableId) || compatibleTables[0] || null;
  const session = sessions.find(s=>s.table_id===table?.table_id && activeSession(s)) || null;
  const rule = rules.find(r=>r.game_type===gameType && r.active!==false);
  const rate = Number(rule?.rate_inr || 0);
  const fixed = supportedRates.has(gameType) && rate>0 && !hourly;
  const timed = !fixed;
  const total = rate * count;
  const goodCount=Number.isSafeInteger(count)&&count>=1&&count<=50;
  const gameName=availableGames.find(g=>g.id===gameType)?.label || gameType;

  const chooseGame = value=>{
    setGameType(value);setError("");
    setHourly(false);
    const next=tables.find(t=>t.table_id===tableId && registerTableAllowsGame(t,value)) || tables.find(t=>registerTableAllowsGame(t,value));
    setTableId(next?.table_id||"");
    if(!["NORMAL_SNOOKER","SIX_BALL_SNOOKER","TEN_BALL_SNOOKER"].includes(value))setChampionship(false);
  };

  const submit=async ()=>{
    if(posting||busy||!table)return;
    if(session) {onContinue(session,customer);onClose();return;}
    if(timed){
      onStartTimed(customer,{
        table_id:table.table_id,
        game_type:hourly&&gameType!=="QCHASE_RUMMY"&&gameType!=="NORMAL_POOL"?"NORMAL_SNOOKER":gameType,
        payment_rule:gameType==="QCHASE_RUMMY"?"HOURLY_SHARED":gameType==="KITTY"?"PER_PLAYER":"HOURLY",
        match_format:championship&&gameType==="NORMAL_SNOOKER"?"CHAMPIONSHIP":"FLEX",
      });
      onClose();return;
    }
    if(!goodCount) {setError("Enter between 1 and 50 whole frames/games.");return;}
    if(demoMode||previewMode) {
      onSimulate({customer_id:customer.customer_id,customer_name:customer.name,table_id:table.table_id,
        game_type:gameType, game_name:gameName, quantity:count, unit_inr:rate,
        amount_inr:total, register_format:championship?"CHAMPIONSHIP":"STANDARD"});
      onClose();return;
    }
    setPosting(true);setError("");
    try {
      await onPost({
        customer_id:customer.customer_id,table_id:table.table_id,
        game_type:gameType,quantity:count,
        register_format:championship?"CHAMPIONSHIP":"STANDARD",
        idempotency_key:key,
      });
      onClose();
    }catch(e){setError(e?.message||"Could not save. Do not start a new transaction; retry this one.");}
    finally{setPosting(false);}
  };

  return (
    <div className="ql-modal-bg" onMouseDown={e=>{if(e.target===e.currentTarget&&!posting)onClose();}}
      style={{position:"fixed",inset:0,zIndex:99999,display:"flex",justifyContent:"center",alignItems:"center",padding:12,background:"rgba(0,0,0,.78)"}}>
      <div role="dialog" aria-modal="true" aria-label="Add Table or Frame Charges" style={{
        background:"#14232a",color:"#f5f9f8",border:"1px solid #508a80",
        width:"min(100%,450px)",borderRadius:14,padding:17,boxShadow:"0 24px 60px #000a",
        maxHeight:"calc(100vh - 24px)",overflowY:"auto",
      }}>
        <div className="ql-space">
          <div><h3 style={{margin:0}}>Add Table / Frame Charges</h3>
            <div className="ql-muted" style={{marginTop:5}}>{customer.name}</div></div>
          <button type="button" className="ql-btn ghost" disabled={posting} onClick={onClose}>✕</button>
        </div>
        <div style={{display:"grid",gap:12,marginTop:16}}>
          <label><span className="ql-label">Game</span>
            <select className="ql-select" value={gameType} disabled={posting} onChange={e=>chooseGame(e.target.value)}>
              {availableGames.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          <label><span className="ql-label">Table</span>
            <select className="ql-select" value={table?.table_id||""} disabled={posting}
              onChange={e=>setTableId(e.target.value)}>
              {compatibleTables.map(t=><option value={t.table_id} key={t.table_id}>
                T{t.table_no} · {t.display_name}
              </option>)}
            </select>
          </label>
          {supportedRates.has(gameType) ? (
            <label className="ql-line" style={{display:"flex",gap:10,alignItems:"center",cursor:"pointer"}}>
              <input type="checkbox" checked={hourly} disabled={posting} onChange={e=>setHourly(e.target.checked)}/>
              <span>Booked by time instead of per frame/game</span>
            </label>
          ):null}
          {fixed ? (
            <label><span className="ql-label">Frames / games to charge {customer.name}</span>
              <div className="ql-row" style={{flexWrap:"nowrap"}}>
                <button type="button" className="ql-btn" disabled={posting||count<=1} onClick={()=>setCount(n=>Math.max(1,n-1))}>−</button>
                <input className="ql-input" type="number" aria-label="Chargeable frames" min={1} max={50} step={1}
                  style={{textAlign:"center",flex:1,minWidth:80}} disabled={posting} value={count}
                  onChange={e=>setCount(Number(e.target.value))}/>
                <button type="button" className="ql-btn" disabled={posting||count>=50} onClick={()=>setCount(n=>Math.min(50,n+1))}>+</button>
              </div>
            </label>
          ):null}
          {["NORMAL_SNOOKER","SIX_BALL_SNOOKER","TEN_BALL_SNOOKER"].includes(gameType) ? (
            <label style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer"}}>
              <input type="checkbox" checked={championship} disabled={posting} onChange={e=>setChampionship(e.target.checked)}/>
              <span className="ql-muted">Championship format (no different price)</span>
            </label>
          ):null}
          <div style={{padding:13,borderRadius:11,background:"#0f3026",border:"1px solid #346957"}}>
            {fixed ? (
              <div className="ql-space">
                <div><strong>{count} × {price(rate)}</strong><div className="ql-muted">{gameName}</div></div>
                <strong style={{fontSize:27}}>{goodCount?price(total):"—"}</strong>
              </div>
            ):(
              <>
                <strong>Timed table booking</strong>
                <div className="ql-muted" style={{marginTop:5}}>
                  Table hours, pauses, member rates and timed Kitty winner rules stay with the existing session engine. No guessed fixed charge is added here.
                </div>
              </>
            )}
          </div>
          {session ? <div className="ql-error">This table has a running session. Continue its game to avoid double billing.</div>:null}
          {error ? <div className="ql-error" role="alert">{error}</div>:null}
          {previewMode ? <div className="ql-muted">Preview mode: Add will record a temporary sample line on this screen only. Nothing is saved to the club database.</div> : null}
          <div className="ql-row" style={{justifyContent:"flex-end"}}>
            <button type="button" className="ql-btn ghost" disabled={posting} onClick={onClose}>Cancel</button>
            <button type="button" className="ql-btn primary" disabled={posting||busy||!table||(fixed&&!goodCount)}
              onClick={submit}>
              {posting?"Adding…":session?"Open running table":
                fixed?"Add "+price(total):"Open table timer"}
            </button>
          </div>
          <div className="ql-muted" style={{fontSize:12}}>
            Loser pays: add only the loser's chargeable frames. Own share: add each player's frames to their own account. Time bookings use the timer, not a frame count.
          </div>
        </div>
      </div>
    </div>
  );
}
