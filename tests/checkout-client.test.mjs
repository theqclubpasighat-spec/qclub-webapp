import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createCheckoutClient} from '../src/checkout-preview/client.mjs';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const items=[{itemId:'momo',quantity:2}],customer={name:'Fixture',phone:'9876543210'};
test('checkout refresh and interrupted request retain the exact same identity and receipt token',async()=>{
 const disk=storage(),seen=[];let fail=true;
 const fetcher=async(path,options)=>{const body=JSON.parse(options.body);seen.push({path,body});if(fail){fail=false;throw Error('lost connection');}return {ok:true,json:async()=>({orderId:`qcr_${body.checkoutId}`,state:'ready',amountPaise:16000,paymentSessionId:'test'})};};
 const first=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher});const saved=first.prepare(items,customer);
 assert.match(saved.body.receiptToken,/^[A-Za-z0-9_-]{43}$/);await assert.rejects(first.start(),e=>e.code==='CONNECTION_INTERRUPTED');
 const refreshed=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher});await refreshed.start();assert.deepEqual(seen[0].body,seen[1].body);
 assert.deepEqual(refreshed.prepare([{itemId:'different',quantity:1}],customer),saved);
});
test('unavailable recovery storage stops checkout before a network call',()=>{
 let calls=0;const client=createCheckoutClient({storage:{getItem:()=>null,setItem(){throw Error('full');}},crypto:webcrypto,fetcher(){calls++;}});
 assert.throws(()=>client.prepare(items,customer),e=>e.code==='RECOVERY_UNAVAILABLE');assert.equal(calls,0);assert.equal(client.current(),null);
});
test('double taps cannot start concurrent order creation',async()=>{
 let release;const client=createCheckoutClient({storage:storage(),crypto:webcrypto,fetcher:()=>new Promise(resolve=>release=resolve)});const saved=client.prepare(items,customer);
 const pending=client.start();await assert.rejects(client.start(),e=>e.code==='REQUEST_IN_PROGRESS');
 release({ok:true,json:async()=>({state:'ready',orderId:`qcr_${saved.body.checkoutId}`,amountPaise:16000,paymentSessionId:'fixture'})});await pending;
});
test('payment check sends only receipt proof and never invents a paid status',async()=>{
 const requests=[];const client=createCheckoutClient({storage:storage(),crypto:webcrypto,fetcher:async(path,options)=>{requests.push({path,options});const b=JSON.parse(options.body);return {ok:true,json:async()=>({state:'pending',orderId:b.orderId})};}});
 client.prepare(items,customer);assert.equal((await client.verify()).state,'pending');
 assert.deepEqual(Object.keys(JSON.parse(requests[0].options.body)).sort(),['orderId','receiptToken']);assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.cache,'no-store');
});
test('expired attempts remain recoverable evidence and cannot silently start a new order',async()=>{
 let time=100000,calls=0;const client=createCheckoutClient({storage:storage(),crypto:webcrypto,now:()=>time,fetcher(){calls++;}});const first=client.prepare(items,customer);
 time+=25*3600000;await assert.rejects(client.start(),e=>e.code==='RECOVERY_EXPIRED');assert.deepEqual(client.current(),first);assert.equal(calls,0);
});
