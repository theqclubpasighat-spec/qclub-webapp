import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createCheckoutClient,checkoutMessage} from './client.mjs';
import './style.css';
let client,initialError;
try{client=createCheckoutClient({storage:window.sessionStorage,crypto:window.crypto});}catch(error){initialError=error;}
let sdkPromise;
function cashfreeSdk(){
 if(window.Cashfree)return Promise.resolve(window.Cashfree);
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://sdk.cashfree.com/js/v3/cashfree.js';script.async=true;
  const timer=setTimeout(()=>{script.remove();sdkPromise=null;reject(Error('SDK_TIMEOUT'));},12000);
  script.onload=()=>{clearTimeout(timer);if(window.Cashfree)resolve(window.Cashfree);else{sdkPromise=null;reject(Error('SDK_UNAVAILABLE'));}};
  script.onerror=()=>{clearTimeout(timer);script.remove();sdkPromise=null;reject(Error('SDK_UNAVAILABLE'));};document.head.append(script);
 });return sdkPromise;
}
function Checkout(){
 const [menu,setMenu]=useState([]),[item,setItem]=useState(''),[qty,setQty]=useState(1),[cart,setCart]=useState([]);
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[attempt,setAttempt]=useState(()=>client?.current());
 const [order,setOrder]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(initialError?checkoutMessage(initialError):'');
 const [lastReference,setLastReference]=useState(()=>client?.lastReference());
 const lock=useRef(false);
 async function run(work){if(lock.current)return;lock.current=true;setBusy(true);setNotice('');try{await work();}catch(error){setNotice(checkoutMessage(error));}finally{lock.current=false;setBusy(false);}}
 async function loadMenu(){await run(async()=>{const data=await client.menu();if(!Array.isArray(data.items))throw Error();setMenu(data.items);setItem(data.items[0]?.id||'');});}
 useEffect(()=>{if(client&&!attempt)loadMenu();},[]);
 async function start(e){e?.preventDefault();await run(async()=>{
  if(!client.current()){const saved=client.prepare(cart.map(x=>({itemId:x.id,quantity:x.quantity})),{name,phone});setAttempt(saved);}
  const result=await client.start();setOrder(result);
  if(result.state==='verify_payment')setOrder(await client.verify());
 });}
 async function check(){await run(async()=>setOrder(await client.verify()));}
 async function newOrder(){await run(async()=>{
  const completed=await client.newOrder();
  setLastReference(completed.orderId);setAttempt(null);setOrder(null);setCart([]);setMenu([]);setItem('');setName('');setPhone('');
  const data=await client.menu();if(!Array.isArray(data.items))throw Error();setMenu(data.items);setItem(data.items[0]?.id||'');
 });}
 async function pay(){await run(async()=>{
  const factory=await cashfreeSdk();const cf=factory({mode:'sandbox'});
  // Even a rejected/closed modal must be reconciled by the server before another attempt.
  try { await cf.checkout({paymentSessionId:order.paymentSessionId,redirectTarget:'_modal'}); }
  finally { setOrder(await client.verify()); }
 });}
 function add(){const selected=menu.find(x=>x.id===item);if(!selected)return;setCart(rows=>{const old=rows.find(x=>x.id===item);return old?rows.map(x=>x.id===item?{...x,quantity:Math.min(20,x.quantity+qty)}:x):[...rows,{...selected,quantity:qty}];});}
 const total=cart.reduce((n,x)=>n+x.price*x.quantity,0);
 return <main className="checkout-shell"><div className="test-banner">SANDBOX PREVIEW · No live orders</div><header><span>Q CLUB</span><small>Q Lounge</small></header>
 <h1>{attempt?'Your order':'A break between frames.'}</h1><p className="muted">{attempt?'Keep this tab open until your payment is confirmed.':'Food checkout rehearsal. Use test details only.'}</p>
 {notice&&<div className="message" role="status">{notice}</div>}
 {!attempt&&lastReference&&<p className="reference">Previous order reference: {lastReference}</p>}
 {initialError?null:attempt?<section className="panel"><h2>{order?.state==='fulfilled'?'Payment confirmed':order?.state==='pending'?'Payment not confirmed yet':'Check your order'}</h2>
 <p className="reference">Reference: qcr_{attempt.body.checkoutId}</p>
 {order?.state==='fulfilled'?<><p>Your test order is recorded. Do not pay again for this order.</p><button disabled={busy} onClick={newOrder}>Start a new order</button></>:<>
 {order?.state==='ready'&&<><p className="amount">₹{(order.amountPaise/100).toFixed(2)}</p><button className="primary" disabled={busy} onClick={pay}>Pay in sandbox</button></>}
 <button disabled={busy} onClick={check}>Check payment status</button><button disabled={busy} onClick={start}>Resume this order</button>
 <p className="muted">If money was debited, check the status before attempting payment again. Refreshing this tab keeps the same order.</p></>}
 </section>:<form onSubmit={start}>
 <section className="panel"><h2>Choose your food</h2>{menu.length===0?<><p>No eligible items are available in this rehearsal.</p><button type="button" disabled={busy} onClick={loadMenu}>Reload menu</button></>:<>
 <label htmlFor="food">Item</label><select id="food" value={item} onChange={e=>setItem(e.target.value)}>{menu.map(x=><option key={x.id} value={x.id}>{x.name} · ₹{x.price}</option>)}</select>
 <div className="add-row"><div><label htmlFor="quantity">Quantity</label><input id="quantity" type="number" min="1" max="20" value={qty} onChange={e=>setQty(Math.max(1,Math.min(20,Math.trunc(Number(e.target.value))||1)))}/></div><button type="button" disabled={busy} onClick={add}>Add to order</button></div></>}
 {cart.map(x=><div className="cart-row" key={x.id}><span>{x.quantity} × {x.name}</span><button type="button" aria-label={`Remove ${x.name}`} onClick={()=>setCart(rows=>rows.filter(y=>y.id!==x.id))}>Remove</button></div>)}
 <p className="estimate">Estimated total <strong>₹{total.toFixed(2)}</strong></p><small>The server confirms the final amount before payment.</small></section>
 <section className="panel"><h2>Your details</h2><label htmlFor="name">Name</label><input id="name" value={name} required maxLength={120} autoComplete="name" onChange={e=>setName(e.target.value)}/><label htmlFor="phone">Mobile number</label><input id="phone" value={phone} required pattern="[6-9][0-9]{9}" maxLength={10} inputMode="tel" autoComplete="tel-national" onChange={e=>setPhone(e.target.value)}/></section>
 <button className="primary submit" disabled={busy||cart.length===0}>{busy?'Preparing…':'Create test order'}</button></form>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Checkout/>);
