import React, { useMemo, useState } from "react";
import DailyRegisterChargeModal from "./daily-register-charge-modal.jsx";
import {
  mergeRegisterRows, normalizeRegisterSearch, pasighatBusinessDate, validateRegisterAllocation,
} from "../lib/daily-register.js";

const box = { background: "#152329", border: "1px solid #34494c", borderRadius: 12, padding: 15 };
const muted = { opacity: .72, fontSize: 13 };
const layout = { display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" };
const formatInr = value => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function DailyRegisterPage({
  selectedDate, onDateChange, dayRows, dayLoading, dayError, dayLimited,
  playerTabs, customers, fnbTabs, catalogue, sessions, tables, rules, busy, previewMode,
  onOpenCustomer, onAddFnb, onCreateCustomer, onOpenTables, onOpenHistory,
  onPostAllocations, onConfigureGameCharge, onContinueGame, onPostRegisterFrames,
}) {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCustomerId, setNewCustomerId] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [itemId, setItemId] = useState("");
  const [allocations, setAllocations] = useState({});
  const [batchId, setBatchId] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [posting, setPosting] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [showHandover, setShowHandover] = useState(false);
  const [chargeCustomer, setChargeCustomer] = useState(null);
  const [bulkResults, setBulkResults] = useState(null);
  const today = pasighatBusinessDate();
  const isToday = selectedDate === today;
  const exampleDayRows = [
    { customer_id:"demo-kiron",name:"KIRON TALI",first_activity_at:selectedDate+"T04:00:00+05:30",activity_count:3 },
    { customer_id:"demo-kamin",name:"KAMIN MIZE",first_activity_at:selectedDate+"T04:15:00+05:30",activity_count:4 },
    { customer_id:"demo-wilson",name:"WILSON",first_activity_at:selectedDate+"T04:35:00+05:30",activity_count:3 },
    { customer_id:"demo-mibom",name:"MIBOM MIBANG",first_activity_at:selectedDate+"T06:00:00+05:30",activity_count:2 },
    { customer_id:"demo-katem",name:"KATEM YOMPANG",first_activity_at:selectedDate+"T06:05:00+05:30",activity_count:1 },
  ];
  const exampleTabs = [
    {customer_id:"demo-kiron",name:"KIRON TALI",current_due_inr:950,player_unbilled_inr:200,active_locations:[]},
    {customer_id:"demo-kamin",name:"KAMIN MIZE",current_due_inr:1150,player_unbilled_inr:400,active_locations:[]},
    {customer_id:"demo-wilson",name:"WILSON",current_due_inr:550,player_unbilled_inr:400,active_locations:[]},
    {customer_id:"demo-mibom",name:"MIBOM MIBANG",current_due_inr:300,player_unbilled_inr:0,active_locations:[{table_id:"table_3",game_type:"NORMAL_SNOOKER"}]},
    {customer_id:"demo-katem",name:"KATEM YOMPANG",current_due_inr:150,player_unbilled_inr:0,active_locations:[]},
  ];
  const exampleFnbTabs = [
    {customer_id:"demo-kiron",lines:[{status:"ACTIVE",item_name_snapshot:"Red Bull",quantity:1},{status:"ACTIVE",item_name_snapshot:"Classic Low Smell",quantity:1}]},
    {customer_id:"demo-kamin",lines:[{status:"ACTIVE",item_name_snapshot:"Monster",quantity:1},{status:"ACTIVE",item_name_snapshot:"Classic Ultramild",quantity:1}]},
    {customer_id:"demo-wilson",lines:[{status:"ACTIVE",item_name_snapshot:"Red Bull",quantity:1}]},
    {customer_id:"demo-mibom",lines:[{status:"ACTIVE",item_name_snapshot:"Red Bull",quantity:2}]},
    {customer_id:"demo-katem",lines:[{status:"ACTIVE",item_name_snapshot:"Red Bull",quantity:1}]},
  ];
  const shownDayRows = demoMode ? exampleDayRows : dayRows;
  const shownOpenTabs = demoMode ? exampleTabs : playerTabs;
  const shownFnbTabs = demoMode ? exampleFnbTabs : fnbTabs;
  const rows = useMemo(() => mergeRegisterRows(shownDayRows, shownOpenTabs, selectedDate, today, search),
    [demoMode, dayRows, playerTabs, selectedDate, today, search]);
  const openCount = rows.filter(x => x.open_tab).length;
  const playingCount = rows.filter(x => (x.open_tab?.active_locations || []).length > 0).length;
  const openDue = rows.reduce((sum, x) => sum + Number(x.open_tab?.current_due_inr || 0), 0);
  const registerUnavailable = Boolean(dayError && !demoMode);
  const shownMetric = value => registerUnavailable ? "—" : value;

  const item = (catalogue || []).find(x => String(x.id) === String(itemId));
  const selectable = (catalogue || []).filter(x => x.sell_in_ledger !== false && !x.requires_price_configuration && !x.is_unpriced && Number(x.selling_price_inr) > 0);
  const registerIds = rows.map(row => row.customer_id);
  const suggestions = newName.trim().length >= 2
    ? (customers || []).filter(x => normalizeRegisterSearch(x.name).includes(normalizeRegisterSearch(newName))).slice(0, 5)
    : [];
  let batch = null;
  let allocationError = "";
  try {
    if (itemId) batch = validateRegisterAllocation(item, allocations, registerIds);
  } catch (error) { allocationError = error.message; }

  const setQuantity = (id, quantity) => {
    if (bulkResults) return; // Freeze an in-flight/partially posted batch to avoid duplicate ownership.
    setAllocations(current => ({ ...current, [id]: Math.max(0, Math.min(100, Math.floor(Number(quantity) || 0))) }));
    setBulkError("");
  };
  const resetBatch = () => {
    setAllocations({});
    setBatchId("");
    setBulkResults(null);
    setBulkError("");
  };
  const changeItem = next => {
    setItemId(next);
    resetBatch();
  };
  const beginNew = () => {
    setShowNew(true);
    setNewName("");
    setNewPhone("");
    setNewCustomerId("");
  };
  const createCustomer = async () => {
    if (!newName.trim() || busy || previewMode) return;
    try {
      await onCreateCustomer({ name: newName.trim(), phone: newPhone.trim(), customer_id: newCustomerId || null });
      setShowNew(false);
    } catch (error) {
      setBulkError(error.message || "Unable to open customer account.");
    }
  };
  const postBulk = async () => {
    if (!batch || busy || posting || previewMode) return;
    const id = batchId || ("daily-bulk-" + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36)));
    setBatchId(id);
    setBulkError("");
    setPosting(true);
    try {
      const result = await onPostAllocations({ item, recipients: batch.recipients, batch_id: id });
      setBulkResults(result);
      if (!result.ok) {
        setBulkError("Some allocations could not be confirmed. Keep this batch unchanged and retry using the same request ID.");
      } else {
        setBulkError("");
      }
    } catch (error) {
      setBulkError(error.message || "Unable to complete allocation. Do not start a duplicate batch.");
    } finally {
      setPosting(false);
    }
  };
  const livePreviewNotice = previewMode ? (
    <div style={{ ...box, borderColor: "#b78c35", background: "#3a301d" }}>
      <strong>Preview safety</strong>
      <div style={muted}>This preview may read the production database. New-account and allocated-order posting are disabled here to prevent test purchases changing real balances. View current accounts and examine the workflow without posting sales.</div>
    </div>
  ) : null;

  return (
    <section aria-label="Daily customer register" style={{ display: "grid", gap: 14 }}>
      {livePreviewNotice}
      {previewMode ? <button className="ql-btn gold" style={{ width: "fit-content" }} onClick={() => setDemoMode(value => !value)}>{demoMode ? "Return to live read-only data" : "Show Kiron / Kamin / Wilson example"}</button> : null}
      {demoMode ? <div style={{ ...box, borderColor:"#b78c35" }}>SIMULATED REGISTER — sample balances and products are illustrative, not actual sales or current catalogue prices. No customer or financial records are created.</div> : null}
      <div style={{ ...box, background: "#102a25", borderColor: "#3e8b78" }}>
        <div style={{ ...layout, justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 750, letterSpacing: 1.2, opacity: .8 }}>THE Q CLUB · PASIGHAT</div>
            <h2 style={{ margin: "4px 0 6px" }}>Daily Register</h2>
            <div style={muted}>One customer account across refreshments, frames, games and tables.</div>
          </div>
          <div>
            <label className="ql-label" htmlFor="qclub-register-date">Business date (IST)</label>
            <input id="qclub-register-date" type="date" className="ql-input" value={selectedDate} max={today}
              onChange={e => onDateChange(e.target.value)} style={{ minWidth: 180 }} />
          </div>
        </div>
        <div style={{ ...layout, marginTop: 14 }}>
          <div style={{ ...box, flex: "1 1 105px", background: "#122822" }}><div style={muted}>Customers shown</div><strong style={{ fontSize: 24 }}>{shownMetric(rows.length)}</strong></div>
          <div style={{ ...box, flex: "1 1 105px", background: "#122822" }}><div style={muted}>Open accounts</div><strong style={{ fontSize: 24 }}>{shownMetric(openCount)}</strong></div>
          <div style={{ ...box, flex: "1 1 105px", background: "#122822" }}><div style={muted}>Playing now</div><strong style={{ fontSize: 24 }}>{shownMetric(playingCount)}</strong></div>
          <div style={{ ...box, flex: "1 1 120px", background: "#122822" }}><div style={muted}>Due on shown open tabs</div><strong style={{ fontSize: 24 }}>{shownMetric(formatInr(openDue))}</strong></div>
        </div>
        <div style={{ ...muted, marginTop: 9 }}>Outstanding amount is not today's sales. Previous balances remain separate in the customer's activity. {isToday ? "Older unpaid tabs appear as carried forward." : "Showing customers active on the selected historical date."}</div>
      </div>

      <div style={{ ...layout, alignItems: "stretch" }}>
        <button className="ql-btn primary" disabled={!isToday || busy || demoMode} onClick={beginNew}>+ Customer / Open Tab</button>
        <button className="ql-btn gold" disabled={!isToday || busy} onClick={() => { setShowBulk(value => !value); resetBatch(); }}>Allocate F&B to several people</button>
        <button className="ql-btn" onClick={onOpenTables}>🎱 Tables & Games</button>
        <button className="ql-btn ghost" onClick={onOpenHistory}>Ledger History</button>
        <button className="ql-btn ghost" onClick={() => setShowHandover(value => !value)}>Shift handover overview</button>
      </div>


      {chargeCustomer ? (
        <DailyRegisterChargeModal
          customer={chargeCustomer}
          tables={tables}
          rules={rules}
          sessions={sessions}
          busy={busy}
          previewMode={previewMode}
          demoMode={demoMode}
          onClose={() => setChargeCustomer(null)}
          onPost={onPostRegisterFrames}
          onStartTimed={onConfigureGameCharge}
          onContinue={onContinueGame}
        />
      ) : null}

      {showHandover ? (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>Shift handover overview · read-only</h3>
          <div style={muted}>This does not stop timers, post payments, settle customer accounts or create an audited handover. The confirmed staff-to-staff signoff is a separate development task.</div>
          <div style={{ ...layout, marginTop: 12 }}>
            <strong>{(sessions || []).filter(x => ["ACTIVE","PAUSED"].includes(x.status)).length} active/paused tables</strong>
            <strong>{(playerTabs || []).length} current Club Tabs</strong>
          </div>
          {(sessions || []).filter(x => ["ACTIVE","PAUSED"].includes(x.status)).map(session =>
            <div key={session.session_id} style={{ padding: 9, borderBottom:"1px solid #34494c" }}>
              {String(session.table_id || "").replace("table_","T")} · {String(session.game_type || "").replaceAll("_"," ")} · {session.status}
            </div>
          )}
          <div style={{ ...muted, marginTop: 10 }}>Before leaving, staff should reconcile paper notes, unfinished frames, running timers, payments and unposted F&B. This view does not confirm the physical handover.</div>
        </div>
      ) : null}

      {showNew ? (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>Open customer account without starting a game</h3>
          <div style={layout}>
            <label style={{ flex: "2 1 240px" }}><span className="ql-label">Customer name</span>
              <input className="ql-input" value={newName} onChange={e => { setNewName(e.target.value.toUpperCase()); setNewCustomerId(""); }} placeholder="Name, e.g. KIRON TALI" />
            </label>
            <label style={{ flex: "1 1 180px" }}><span className="ql-label">Mobile (optional)</span>
              <input className="ql-input" inputMode="numeric" value={newPhone} onChange={e => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit number" />
            </label>
          </div>
          {suggestions.length ? (
            <div style={{ ...layout, marginTop: 8 }} aria-label="Existing customers">
              <span style={muted}>Choose existing:</span>
              {suggestions.map(x => <button type="button" className="ql-btn ghost" key={x.customer_id}
                onClick={() => { setNewName(x.name); setNewPhone(x.phone || ""); setNewCustomerId(x.customer_id); }}>{x.name}{x.phone ? " · " + x.phone.slice(-4) : ""}</button>)}
            </div>
          ) : null}
          {bulkError ? <div className="ql-error" style={{ marginTop: 8 }}>{bulkError}</div> : null}
          <div style={{ ...layout, marginTop: 12 }}>
            <button className="ql-btn primary" disabled={busy || !newName.trim() || previewMode || (newPhone.length > 0 && newPhone.length !== 10)} onClick={createCustomer}>Open Club Tab</button>
            <button className="ql-btn ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
          <div style={{ ...muted, marginTop: 8 }}>Creates or reuses a customer-linked F&B tab; no table clock starts and no amount is charged.</div>
        </div>
      ) : null}

      {showBulk ? (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>Allocate one catalogue item to multiple payers</h3>
          <div style={muted}>For example, assign two Red Bulls to Mibom and one to Katem, or one chicken leg piece to each selected customer. Quantities are charged to the named payer, not the table.</div>
          <label style={{ display: "block", marginTop: 12 }}>
            <span className="ql-label">Catalogue item</span>
            <select className="ql-select" value={itemId} onChange={e => changeItem(e.target.value)}>
              <option value="">Choose an item</option>
              {selectable.map(x => <option key={x.id} value={x.id}>{x.name} · {formatInr(x.selling_price_inr)} {x.track_inventory ? "(stock " + Number(x.current_stock || 0) + ")" : ""}</option>)}
            </select>
          </label>
          <div style={{ ...layout, justifyContent: "space-between", marginTop: 12 }}>
            <strong>Charge to</strong>
            <button className="ql-btn ghost" disabled={Boolean(bulkResults)} onClick={() => {
              const next = {};
              for (const row of rows) next[row.customer_id] = 1;
              setAllocations(next);
            }}>1 each (all shown)</button>
          </div>
          <div style={{ maxHeight: 270, overflow: "auto", marginTop: 8 }}>
            {rows.map(row => <div key={row.customer_id} style={{ ...layout, justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #34494c" }}>
              <span>{row.name} <span style={muted}>{row.carried_forward ? "· carry-forward" : ""}</span></span>
              <div style={layout}>
                <button className="ql-btn ghost" disabled={Boolean(bulkResults)} onClick={() => setQuantity(row.customer_id, Number(allocations[row.customer_id] || 0) - 1)}>−</button>
                <input aria-label={"Quantity for " + row.name} className="ql-input" type="number" min="0" max="100" step="1" style={{ width: 66, textAlign: "center" }}
                  disabled={Boolean(bulkResults)} value={Number(allocations[row.customer_id] || 0)}
                  onChange={e => setQuantity(row.customer_id, e.target.value)} />
                <button className="ql-btn ghost" disabled={Boolean(bulkResults)} onClick={() => setQuantity(row.customer_id, Number(allocations[row.customer_id] || 0) + 1)}>+</button>
              </div>
            </div>)}
          </div>
          <div style={{ ...layout, justifyContent: "space-between", marginTop: 12 }}>
            <strong>{batch ? batch.totalQuantity + " item(s) · " + formatInr(batch.totalInr) : allocationError || "Choose item and quantities"}</strong>
            <div style={layout}>
              <button className="ql-btn ghost" onClick={() => { setShowBulk(false); resetBatch(); }}>Close</button>
              {bulkResults?.ok ? <button className="ql-btn gold" onClick={resetBatch}>New allocation</button> : null}
              <button className="ql-btn primary" disabled={!batch || busy || posting || previewMode || bulkResults?.ok} onClick={postBulk}>
                {posting ? "Posting…" : bulkResults ? "Retry same batch" : "Post allocated charges"}
              </button>
            </div>
          </div>
          {bulkResults?.results?.length ? (
            <div style={{ ...muted, marginTop: 8 }}>
              {bulkResults.results.map(x => <div key={x.customer_id}>{x.ok ? "✓" : "⚠"} {x.name} — {x.ok ? "Posted (idempotent)" : x.error}</div>)}
            </div>
          ) : null}
          {bulkError ? <div className="ql-error" style={{ marginTop: 10 }}>{bulkError}</div> : null}
        </div>
      ) : null}

      <div style={box}>
        <div style={{ ...layout, justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Customers · {selectedDate}</h3>
          <input className="ql-input" style={{ width: "min(100%, 300px)" }} value={search} placeholder="Search name or phone"
            onChange={e => setSearch(e.target.value)} aria-label="Search daily register" />
        </div>
        {dayError && !demoMode ? <div className="ql-error" style={{ marginTop: 12 }}>Unable to load full day register: {dayError}</div> : null}
        {dayLimited ? <div className="ql-error" style={{ marginTop: 12 }}>Large-day result limit reached. Do not use this sheet for closing until pagination is implemented.</div> : null}
        {dayLoading ? <div style={{ ...muted, padding: 12 }}>Loading daily activity…</div> : null}
        <div style={{ marginTop: 10 }}>
          {rows.map((row, index) => {
            const locations = row.open_tab?.active_locations || [];
            const fnb = (shownFnbTabs || []).find(tab => tab.customer_id === row.customer_id);
            const lines = (fnb?.lines || []).filter(x => x.status === "ACTIVE").slice(-3);
            const summary = [
              lines.length ? lines.map(x => x.item_name_snapshot + " ×" + Number(x.quantity)).join(" · ") : null,
              row.open_tab && Number(row.open_tab.player_unbilled_inr || 0) > 0 ? "Game/Table " + formatInr(row.open_tab.player_unbilled_inr) : null,
              locations.length ? locations.map(x => x.table_id.replace("table_", "T") + " " + x.game_type.replaceAll("_", " ")).join(" · ") : null,
            ].filter(Boolean).join(" • ");
            return <div key={row.customer_id} style={{ borderBottom: "1px solid #34494c", padding: "12px 0", display: "grid", gap: 7 }}>
              <div style={{ ...layout, justifyContent: "space-between" }}>
                <div style={{ flex: "1 1 220px" }}>
                  <div style={{ fontWeight: 800 }}>{index + 1}. {row.name}</div>
                  <div style={muted}>{summary || (row.carried_forward ? "Earlier account carried forward" : "Customer visited · see activity")} {row.phone ? " · " + row.phone.slice(-4) : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong style={{ fontSize: 18 }}>{row.open_tab ? formatInr(row.open_tab.current_due_inr) : "Settled / no open tab"}</strong>
                  <div style={muted}>{row.carried_forward ? "CARRY-FORWARD" : locations.length ? "PLAYING" : row.open_tab ? "TAB OPEN" : "DAY ACTIVITY"}</div>
                </div>
              </div>
              <div style={layout}>
                <button className="ql-btn" onClick={() => onOpenCustomer(row)} disabled={busy || demoMode}>View account / Checkout</button>
                <button className="ql-btn ghost" onClick={() => onAddFnb(row)} disabled={busy || demoMode || previewMode || !isToday}>+ Add F&B</button>
                <button className="ql-btn gold" type="button" onClick={() => setChargeCustomer(row)} disabled={busy || !isToday}>+ Add Table / Frame Charges</button>
              </div>
            </div>;
          })}
          {!rows.length && !dayLoading && !registerUnavailable ? <div className="ql-empty">No customer activity on this date. Open a customer tab to create the first row.</div> : null}
        </div>
      </div>
    </section>
  );
}
