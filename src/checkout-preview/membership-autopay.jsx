import React, {useState, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const key='qclub.autopay.sandbox.v1';
async function request(action,body) {
  const response=await fetch('/api/qclub-checkout-rehearsal?action=subscription-'+action,{
    method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'
  });
  if(!response.ok) throw Error('Unable to complete this request. Check status before retrying.');
  return response.json();
}
function Membership() {
  const [tiers,setTiers]=useState([]),[form,setForm]=useState({name:'',phone:'',email:'',tierId:''});
  const [quote,setQuote]=useState(null),[membership,setMembership]=useState(null),[message,setMessage]=useState('');
  const [busy,setBusy]=useState(false),lock=useRef(false);
  const [owner,setOwner]=useState(()=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}});
  async function run(fn) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setMessage('');
    try {await fn();} catch(e){setMessage(e.message);} finally{lock.current=false;setBusy(false);}
  }
  useEffect(()=>{run(async()=>{
    const data=await request('tiers');setTiers(data.tiers);
    setForm(f=>({...f,tierId:data.tiers[0]?.id||''}));
    if(owner)setMembership(await request('status',owner));
  });},[]);
  const update=e=>setForm({...form,[e.target.name]:e.target.value});
  function review(e) {
    e.preventDefault();run(async()=>{
      const identity=owner || {id:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')};
      setQuote(await request('quote',{...form,...identity}));setOwner(identity);
    });
  }
  async function checkout() {
    localStorage.setItem(key,JSON.stringify(owner));
    const {session}=await request('checkout',{...form,...owner,...quote});
    const result=await window.Cashfree({mode:'sandbox'}).subscriptionsCheckout({subsSessionId:session,redirectTarget:'_self'});
    if(result?.error)throw Error('Checkout did not finish. Check your membership status.');
  }
  const refresh=()=>run(async()=>setMembership(await request('status',owner)));
  const closed=['CANCELLED','CUSTOMER_CANCELLED','COMPLETED','EXPIRED','LINK_EXPIRED'].includes(membership?.status);
  return <main className="checkout-shell"><h1>Q Club membership</h1><p>Cashfree sandbox · Test members only</p>
    {membership?<section className="panel"><h2>My Membership</h2><p>{membership.tier} · ₹{membership.amount} per month</p>
      <p>AutoPay status · {membership.status}</p><p>Benefits valid through · {membership.paidUntil||'Awaiting first payment'}</p>
      {membership.nextDebit&&<p>Next debit · {new Date(membership.nextDebit).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})}</p>}
      {membership.failed&&<p>A collection failed. Check your payment history.</p>}
       {['INITIALIZED','BANK_APPROVAL_PENDING'].includes(membership.status)&&<button disabled={busy} onClick={()=>run(async()=>{
        const {session}=await request('checkout',owner);
        const result=await window.Cashfree({mode:'sandbox'}).subscriptionsCheckout({subsSessionId:session,redirectTarget:'_self'});
        if(result?.error)throw Error('Unable to resume checkout.');
      })}>Resume authorisation</button>}
      <button disabled={busy} onClick={refresh}>Refresh status</button>
      {!closed&&<button disabled={busy} onClick={()=>run(async()=>{if(window.confirm('Cancel future automatic payments?'))setMembership(await request('cancel',owner));})}>Cancel AutoPay</button>}
    </section>:quote?<section className="panel"><h2>{quote.tier} · ₹{quote.amount} per month</h2>
      <p>First membership debit · {quote.firstDate} (IST). Mandate verification uses a refundable ₹1.</p>
      <p>You can cancel AutoPay anytime from My Membership. Your benefits continue through the period you have paid for.</p>
      <button className="primary" disabled={busy} onClick={()=>run(checkout)}>Subscribe with AutoPay</button>
      <button disabled={busy} onClick={()=>setQuote(null)}>Back</button></section>:
      <form className="panel" onSubmit={review}><label>Membership tier<select name="tierId" value={form.tierId} onChange={update}>{tiers.map(t=><option key={t.id} value={t.id}>{t.tier} · ₹{t.price}/month</option>)}</select></label>
      <label>Full name<input required name="name" value={form.name} onChange={update}/></label>
      <label>Mobile number<input required type="tel" pattern="[6-9][0-9]{9}" name="phone" value={form.phone} onChange={update}/></label>
      <label>Email<input required type="email" name="email" value={form.email} onChange={update}/></label>
      <button disabled={busy||!tiers.length}>Review subscription</button></form>}
    {owner&&!membership&&<button disabled={busy} onClick={refresh}>Check membership status</button>}
    <p role="status">{message}</p></main>;
}
createRoot(document.getElementById('root')).render(<Membership/>);
