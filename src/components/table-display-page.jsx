import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const API_ROOT = "/api/snooker/v1";
const TABLE_LABELS = { T1: "LIBERWIN", T2: "WIRAKA 777", T3: "MINI SNOOKER", T4: "AMERICAN POOL" };

function money(value) {
  return "₹" + Number(value || 0).toFixed(2);
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return h + ":" + m + ":" + r;
}

export default function TableDisplayPage({ tableKey: fixedTableKey }) {
  const params = useParams();
  const tableKey = String(fixedTableKey || params.tableKey || "").toUpperCase();
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(function() {
    let stopped = false;
    async function load() {
      try {
        const response = await fetch(API_ROOT + "/display/" + encodeURIComponent(tableKey), { cache: "no-store" });
        if (!response.ok) throw new Error("Display unavailable");
        const payload = await response.json();
        if (!stopped) setData(payload);
      } catch {
        if (!stopped) setData(null);
      }
    }
    load();
    const refresh = window.setInterval(load, 3000);
    const tick = window.setInterval(function() { setNow(Date.now()); }, 1000);
    return function() { stopped = true; window.clearInterval(refresh); window.clearInterval(tick); };
  }, [tableKey]);

  const liveSeconds = useMemo(function() {
    if (!data || !data.session) return 0;
    const session = data.session;
    let seconds = Number(session.accumulated_seconds || 0);
    if (session.timer_running && session.timer_started_at) {
      const start = Date.parse(session.timer_started_at);
      if (Number.isFinite(start)) seconds += Math.max(0, Math.floor((now - start) / 1000));
    }
    return seconds;
  }, [data, now]);

  const state = data?.state || "STANDBY";
  const table = data?.table || {};
  const rules = data?.standby_rules || [];
  const session = data?.session || null;
  const bill = data?.bill || null;
  const payment = data?.payment || null;
  const liveTable = session?.billing_mode === "HOURLY" ? (liveSeconds / 3600) * Number(session.hourly_rate_inr || 0) : Number(session?.game_charges_inr || 0);
  const liveTotal = liveTable + Number(session?.fnb_total_inr || 0);
  const kittyChainSeconds = Number(session?.kitty_chain_seconds_live || liveSeconds || 0);
  const kittyRawCharge = Math.max(100, (kittyChainSeconds / 3600) * Number(session?.hourly_rate_inr || 0));
  const kittyWinnerCharge = Math.max(100, Math.round(kittyRawCharge / 10) * 10);

  return (
    <main style={{ minHeight:"100vh", background:"#06100b", color:"#f7fbf8", fontFamily:"Inter,system-ui,sans-serif", padding:"clamp(18px,4vw,46px)" }}>
      <div style={{ maxWidth:980, margin:"0 auto" }}>
        <header style={{ display:"flex", justifyContent:"space-between", gap:20, alignItems:"center", borderBottom:"1px solid #294334", paddingBottom:18 }}>
          <div><div style={{ fontWeight:950, fontSize:"clamp(24px,4vw,42px)" }}>THE Q CLUB</div><div style={{ color:"#9fb3a6" }}>PASIGHAT • OFFICIAL TABLE DISPLAY</div></div>
          <div style={{ textAlign:"right" }}><div style={{ fontWeight:950, fontSize:"clamp(22px,3.5vw,38px)" }}>{tableKey} • {TABLE_LABELS[tableKey] || table.display_name || "TABLE"}</div><div style={{ color: state === "PAID" ? "#7df0ad" : "#e5c45c", fontWeight:900 }}>{state}</div></div>
        </header>

        {!data ? <div style={{ padding:"80px 0", textAlign:"center", fontSize:24 }}>Connecting to the official Q Club billing system…</div> : null}

        {data && state === "STANDBY" ? (
          <section>
            <div style={{ textAlign:"center", padding:"30px 0 20px" }}><div style={{ fontSize:"clamp(34px,6vw,64px)", fontWeight:950 }}>AVAILABLE</div><div style={{ color:"#9fb3a6", fontSize:18 }}>Please contact the counter to start a session</div></div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:14 }}>
              <div style={{ border:"1px solid #294334", borderRadius:18, padding:20, textAlign:"center" }}><div style={{ color:"#9fb3a6" }}>MEMBER</div><strong style={{ fontSize:"clamp(30px,5vw,54px)" }}>{money(table.member_price_per_hour_inr)}</strong><div>per hour</div></div>
              <div style={{ border:"1px solid #294334", borderRadius:18, padding:20, textAlign:"center" }}><div style={{ color:"#9fb3a6" }}>NON-MEMBER</div><strong style={{ fontSize:"clamp(30px,5vw,54px)" }}>{money(table.price_per_hour_inr)}</strong><div>per hour</div></div>
            </div>
            <h2 style={{ marginTop:28 }}>Billing Rules</h2>
            <div style={{ borderTop:"1px solid #294334" }}>{rules.map(function(rule){ return <div key={rule.title} style={{ display:"flex", justifyContent:"space-between", gap:20, padding:"13px 0", borderBottom:"1px solid #294334" }}><span>{rule.title}</span><strong style={{ textAlign:"right" }}>{rule.value}</strong></div>; })}</div>
            <div style={{ marginTop:26, border:"1px solid #365b46", borderRadius:18, padding:20, background:"#0b1b12" }}>
              <strong>🔒 SECURE COMPUTER-GENERATED BILLING</strong>
              <p style={{ color:"#b5c7bb", lineHeight:1.55, marginBottom:0 }}>Playing time and table charges are calculated automatically from the recorded session. Finalized bills cannot be edited by staff. Any authorized correction is retained in the audit trail.</p>
            </div>
            <div style={{ textAlign:"center", marginTop:22, fontWeight:900, fontSize:18 }}>UPI — Pay by QR on this screen &nbsp; • &nbsp; CASH — Pay at the counter</div>
          </section>
        ) : null}

        {data && state === "PLAYING" && session ? (
          <section style={{ textAlign:"center", paddingTop:28 }}>
            <div style={{ color:"#7df0ad", fontWeight:900 }}>● PLAYING • OFFICIAL SESSION TIME</div>
            <div style={{ fontSize:"clamp(62px,13vw,126px)", fontWeight:950, fontVariantNumeric:"tabular-nums", margin:"14px 0" }}>{clock(liveSeconds)}</div>
            <div style={{ fontSize:22, fontWeight:850 }}>{session.game_label}</div>
            {session.game_type === "KITTY" ? (
              <div style={{ margin:"24px auto", maxWidth:720, border:"1px solid #294334", borderRadius:18, padding:22 }}>
                <div style={{ color:"#9fb3a6" }}>CURRENT KITTY CHAIN</div>
                <div style={{ fontSize:36, fontWeight:950 }}>{clock(kittyChainSeconds)}</div>
                <div style={{ color:"#9fb3a6", marginTop:12 }}>WINNER CHARGE IF GAME ENDS NOW</div>
                <div style={{ fontSize:46, fontWeight:950 }}>{money(kittyWinnerCharge)}</div>
                <div style={{ marginTop:8 }}>Only the winner is charged • Minimum ₹100 • Rounded to nearest ₹10 • No-winner time carries forward</div>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:14, maxWidth:720, margin:"24px auto" }}>
                <div style={{ border:"1px solid #294334", borderRadius:18, padding:20 }}><div style={{ color:"#9fb3a6" }}>TABLE / GAME</div><strong style={{ fontSize:34 }}>{money(liveTable)}</strong></div>
                <div style={{ border:"1px solid #294334", borderRadius:18, padding:20 }}><div style={{ color:"#9fb3a6" }}>F&B</div><strong style={{ fontSize:34 }}>{money(session.fnb_total_inr)}</strong></div>
                <div style={{ gridColumn:"1/-1", border:"1px solid #8a6e27", borderRadius:18, padding:20 }}><div style={{ color:"#d8c27f" }}>CURRENT BILL</div><strong style={{ fontSize:46 }}>{money(liveTotal)}</strong></div>
              </div>
            )}
            <div style={{ marginTop:30, borderTop:"1px solid #294334", paddingTop:18, fontWeight:850 }}>After play: Pay by UPI QR on this screen or pay Cash at the counter.</div>
            <div style={{ color:"#9fb3a6", marginTop:8 }}>This display is read-only. Session controls are available only to Q Club staff.</div>
          </section>
        ) : null}

        {data && state === "PAYMENT" && bill ? (
          <section style={{ textAlign:"center", paddingTop:28 }}>
            <div style={{ fontWeight:900 }}>SESSION ENDED • PAYMENT DUE</div>
            <div style={{ color:"#9fb3a6", marginTop:8 }}>FINAL BILL</div><div style={{ fontSize:"clamp(58px,11vw,108px)", fontWeight:950 }}>{money(bill.due_inr)}</div>
            {payment?.qr_url ? <><div style={{ fontSize:24, fontWeight:900, marginTop:18 }}>PAY BY UPI HERE</div><iframe title="Secure Cashfree UPI QR" src={payment.qr_url} style={{ width:"min(430px,92vw)", height:520, border:0, borderRadius:20, background:"#fff", marginTop:12 }} /></> : <div style={{ margin:"24px auto", maxWidth:620, border:"1px solid #8a6e27", borderRadius:18, padding:22 }}>UPI QR will appear here when staff selects UPI payment.</div>}
            <div style={{ margin:"24px 0 8px", color:"#9fb3a6" }}>— OR —</div><div style={{ fontSize:28, fontWeight:950 }}>PAY BY CASH AT THE COUNTER</div>
            <div style={{ marginTop:20 }}>Table / Game {money(bill.game_total_inr)} • F&B {money(bill.fnb_total_inr)}</div><div style={{ color:"#9fb3a6", marginTop:8 }}>{bill.bill_no}</div>
          </section>
        ) : null}

        {data && state === "PAID" ? (
          <section style={{ textAlign:"center", padding:"70px 0" }}><div style={{ fontSize:90 }}>✓</div><div style={{ fontSize:"clamp(34px,7vw,70px)", fontWeight:950 }}>PAYMENT RECEIVED</div><div style={{ fontSize:52, fontWeight:950, color:"#7df0ad", marginTop:16 }}>{money(bill?.total_inr)}</div><div style={{ fontSize:28, fontWeight:900 }}>PAID</div><div style={{ marginTop:30, color:"#b5c7bb", fontSize:20 }}>Thank you for playing at The Q Club</div></section>
        ) : null}
      </div>
    </main>
  );
}
