import React, { useEffect, useMemo, useState } from 'react';
import { messageFor } from './client.mjs';

const todayLocal=()=>{
  const d=new Date();
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(value)||0);
const when=value=>value ? new Date(value).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : '—';

export default function StaffOperationsPanel({client,actor}) {
  const [data,setData]=useState({shifts:[],attendance:[],expenses:[]});
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [shift,setShift]=useState({staffId:'staff-game-marshall',startsAt:'',endsAt:'',note:''});
  const [expense,setExpense]=useState({businessDate:todayLocal(),category:'SUPPLIES',amountInr:'',description:'',paymentMethod:'CASH'});
  const openAttendance=useMemo(()=>data.attendance.find(row=>!row.clock_out)||null,[data.attendance]);

  async function load(){
    const next=await client.staffOps();
    setData({shifts:next.shifts||[],attendance:next.attendance||[],expenses:next.expenses||[]});
  }
  useEffect(()=>{
    let active=true;
    client.staffOps().then(next=>{
      if(active)setData({shifts:next.shifts||[],attendance:next.attendance||[],expenses:next.expenses||[]});
    }).catch(error=>{if(active)setNotice(messageFor(error));});
    return()=>{active=false;};
  },[actor.role]);

  async function run(work,success){
    if(busy)return;
    setBusy(true);setNotice('');
    try{await work();await load();setNotice(success);}
    catch(error){setNotice(messageFor(error));}
    finally{setBusy(false);}
  }
  async function submitShift(e){
    e.preventDefault();
    const start=new Date(shift.startsAt),end=new Date(shift.endsAt);
    if(!shift.staffId.trim()||Number.isNaN(start.getTime())||Number.isNaN(end.getTime())){
      setNotice('Choose a valid staff member and shift time.');return;
    }
    await run(()=>client.createShift({staffId:shift.staffId.trim(),startsAt:start.toISOString(),endsAt:end.toISOString(),note:shift.note}),'Shift scheduled.');
    setShift(current=>({...current,startsAt:'',endsAt:'',note:''}));
  }
  async function cancelShift(row){
    const reason=window.prompt('Reason for cancelling this shift?');
    if(!reason?.trim())return;
    await run(()=>client.cancelShift(row.id,reason.trim()),'Shift cancelled.');
  }
  async function clock(command){
    await run(()=>client.clockAttendance(command,''),command==='CLOCK_IN'?'Clocked in.':'Clocked out.');
  }
  async function submitExpense(e){
    e.preventDefault();
    const amount=Number(expense.amountInr);
    if(!Number.isFinite(amount)||amount<=0){setNotice('Enter a valid expense amount.');return;}
    await run(()=>client.createExpense({...expense,amountInr:amount}),'Expense recorded.');
    setExpense(current=>({...current,amountInr:'',description:''}));
  }
  async function voidExpense(row){
    const reason=window.prompt('Reason for voiding this expense?');
    if(!reason?.trim())return;
    await run(()=>client.voidExpense(row.id,reason.trim()),'Expense voided.');
  }

  return <section className="card staff-ops">
    <div className="staff-ops-heading"><div><h2>Staff operations</h2><p>Server-backed shifts, attendance and expenses. Records are saved with the signed-in identity.</p></div><button type="button" className="quiet" disabled={busy} onClick={()=>run(load,'Records refreshed.')}>Refresh</button></div>
    {notice&&<div className="notice" role="status">{notice}</div>}

    {actor.role==='STAFF'&&<section className="ops-section" aria-labelledby="attendance-title">
      <h3 id="attendance-title">Attendance</h3>
      <p>{openAttendance?<>Clocked in since <strong>{when(openAttendance.clock_in)}</strong>.</>:<>You are currently <strong>clocked out</strong>.</>}</p>
      <button id="staff-clock-button" type="button" className="primary" disabled={busy} onClick={()=>clock(openAttendance?'CLOCK_OUT':'CLOCK_IN')}>{openAttendance?'Clock out':'Clock in'}</button>
    </section>}

    {actor.role==='ADMIN'&&<section className="ops-section" aria-labelledby="shift-form-title">
      <h3 id="shift-form-title">Schedule shift</h3>
      <form className="ops-form" onSubmit={submitShift}>
        <label htmlFor="shift-staff">Staff ID</label><input id="shift-staff" value={shift.staffId} maxLength={120} disabled={busy} onChange={e=>setShift({...shift,staffId:e.target.value})}/>
        <label htmlFor="shift-start">Starts</label><input id="shift-start" type="datetime-local" value={shift.startsAt} disabled={busy} onChange={e=>setShift({...shift,startsAt:e.target.value})}/>
        <label htmlFor="shift-end">Ends</label><input id="shift-end" type="datetime-local" value={shift.endsAt} disabled={busy} onChange={e=>setShift({...shift,endsAt:e.target.value})}/>
        <label htmlFor="shift-note">Note</label><input id="shift-note" value={shift.note} maxLength={1000} disabled={busy} onChange={e=>setShift({...shift,note:e.target.value})}/>
        <button id="schedule-shift" className="primary" disabled={busy}>Schedule shift</button>
      </form>
    </section>}

    <section className="ops-section" aria-labelledby="expense-form-title">
      <h3 id="expense-form-title">Record expense</h3>
      <form className="ops-form" onSubmit={submitExpense}>
        <label htmlFor="expense-date">Business date</label><input id="expense-date" type="date" value={expense.businessDate} disabled={busy} onChange={e=>setExpense({...expense,businessDate:e.target.value})}/>
        <label htmlFor="expense-category">Category</label><select id="expense-category" value={expense.category} disabled={busy} onChange={e=>setExpense({...expense,category:e.target.value})}>
          {['SUPPLIES','MAINTENANCE','FOOD_STOCK','UTILITIES','TRANSPORT','OTHER'].map(value=><option key={value}>{value}</option>)}
        </select>
        <label htmlFor="expense-amount">Amount (₹)</label><input id="expense-amount" type="number" min="0.01" max="10000000" step="0.01" value={expense.amountInr} disabled={busy} onChange={e=>setExpense({...expense,amountInr:e.target.value})}/>
        <label htmlFor="expense-method">Paid by</label><select id="expense-method" value={expense.paymentMethod} disabled={busy} onChange={e=>setExpense({...expense,paymentMethod:e.target.value})}>{['CASH','UPI','BANK','OTHER'].map(value=><option key={value}>{value}</option>)}</select>
        <label htmlFor="expense-description">Description</label><textarea id="expense-description" rows={3} maxLength={2000} value={expense.description} disabled={busy} onChange={e=>setExpense({...expense,description:e.target.value})}/>
        <button id="record-expense" className="primary" disabled={busy}>Record expense</button>
      </form>
    </section>

    <section className="ops-section"><h3>Shifts</h3>
      <div className="ops-list">{data.shifts.length?data.shifts.map(row=><article className="ops-row" key={row.id}><div><strong>{row.staff_id}</strong><small>{when(row.starts_at)} → {when(row.ends_at)}</small><small>{row.status}{row.note?' · '+row.note:''}</small></div>{actor.role==='ADMIN'&&row.status==='SCHEDULED'?<button type="button" className="quiet" disabled={busy} onClick={()=>cancelShift(row)}>Cancel</button>:null}</article>):<p>No shifts recorded.</p>}</div>
    </section>
    <section className="ops-section"><h3>Attendance history</h3>
      <div className="ops-list">{data.attendance.length?data.attendance.map(row=><article className="ops-row" key={row.id}><div><strong>{row.staff_id}</strong><small>{when(row.clock_in)} → {when(row.clock_out)}</small></div></article>):<p>No attendance recorded.</p>}</div>
    </section>
    <section className="ops-section"><h3>Expense history</h3>
      <div className="ops-list">{data.expenses.length?data.expenses.map(row=><article className="ops-row" key={row.id}><div><strong>{money(row.amount_inr)} · {row.category}</strong><small>{row.business_date} · {row.payment_method} · {row.recorded_by}</small><small>{row.status}{row.description?' · '+row.description:''}</small></div>{actor.role==='ADMIN'&&row.status==='POSTED'?<button type="button" className="quiet" disabled={busy} onClick={()=>voidExpense(row)}>Void</button>:null}</article>):<p>No expenses recorded.</p>}</div>
    </section>
  </section>;
}
