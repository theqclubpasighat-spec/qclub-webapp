import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createCheckoutClient} from '../src/checkout-preview/client.mjs';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
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
test('starting another purchase freshly verifies completion and preserves only the last reference',async()=>{
 const disk=storage(),seen=[];
 const fetcher=async(path,options)=>{const body=JSON.parse(options.body);seen.push({path,body});return {ok:true,json:async()=>({state:'fulfilled',orderId:body.orderId})};};
 const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher});const first=client.prepare(items,customer);
 await client.verify();await client.newOrder();
 assert.equal(seen.length,2);assert.equal(seen[1].path,'/api/qclub-payment-rehearsal');
 assert.equal(client.current(),null);
 const restored=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher});
 assert.equal(restored.current(),null);assert.equal(restored.lastReference(),`qcr_${first.body.checkoutId}`);
 assert.deepEqual(JSON.parse(disk.getItem('qclub.rehearsal.checkout.last-reference.v1')),{orderId:`qcr_${first.body.checkoutId}`});
 const second=restored.prepare(items,customer);
 assert.notEqual(second.body.checkoutId,first.body.checkoutId);assert.notEqual(second.body.receiptToken,first.body.receiptToken);
});
test('pending, mismatched and interrupted verification never release the original checkout',async()=>{
 for(const kind of ['pending','mismatch','interrupted']){
  const disk=storage();
  const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher:async(_path,options)=>{
   if(kind==='interrupted')throw Error('offline');
   const body=JSON.parse(options.body);return {ok:true,json:async()=>({state:kind==='pending'?'pending':'fulfilled',orderId:kind==='mismatch'?'qcr_other':body.orderId})};
  }});const saved=client.prepare(items,customer);
  await assert.rejects(client.newOrder());assert.deepEqual(client.current(),saved);
  assert.deepEqual(createCheckoutClient({storage:disk,crypto:webcrypto}).current(),saved);
 }
});
test('receipt storage failure and overlapping taps preserve the active order',async()=>{
 const disk=storage();let release;
 const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher:()=>new Promise(resolve=>release=resolve)});
 const saved=client.prepare(items,customer),pending=client.newOrder();
 await assert.rejects(client.newOrder(),error=>error.code==='REQUEST_IN_PROGRESS');
 disk.setItem=()=>{throw Error('full');};
 release({ok:true,json:async()=>({state:'fulfilled',orderId:`qcr_${saved.body.checkoutId}`})});
 await assert.rejects(pending,error=>error.code==='RECOVERY_UNAVAILABLE');assert.deepEqual(client.current(),saved);
 assert.deepEqual(createCheckoutClient({storage:disk,crypto:webcrypto}).current(),saved);
});

test('cart correction requires durable server closure and preserves the saved details for editing',async()=>{
 const disk=storage(),requests=[];
 const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher:async(path,options)=>{
  const body=JSON.parse(options.body);requests.push({path,body});return {ok:true,json:async()=>({state:'closed',orderId:`qcr_${body.checkoutId}`})};
 }});const original=client.prepare(items,customer);
 assert.deepEqual(await client.editCart(),original);assert.equal(client.current(),null);
 assert.deepEqual(requests[0],{path:'/api/qclub-checkout-recovery-rehearsal',body:{checkoutId:original.body.checkoutId,receiptToken:original.body.receiptToken}});
 const restored=createCheckoutClient({storage:disk,crypto:webcrypto});assert.equal(restored.current(),null);
 assert.notEqual(restored.prepare(items,customer).body.checkoutId,original.body.checkoutId);
});
test('existing orders, missing-order errors and interrupted correction keep recovery proof',async()=>{
 for(const state of ['existing','404','offline','mismatch']){
  const disk=storage();const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher:async(_path,options)=>{
   if(state==='offline')throw Error('offline');const b=JSON.parse(options.body);
   return {ok:state!=='404',status:404,json:async()=>({state:state==='mismatch'?'closed':state,orderId:state==='mismatch'?'wrong':`qcr_${b.checkoutId}`,error:'ORDER_NOT_FOUND'})};
  }});const original=client.prepare(items,customer);
  await assert.rejects(client.editCart());assert.deepEqual(client.current(),original);
  assert.deepEqual(createCheckoutClient({storage:disk,crypto:webcrypto}).current(),original);
 }
});
test('failed local removal after server closure can retry the same correction safely',async()=>{
 const disk=storage(),remove=disk.removeItem;
 const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher:async(_path,options)=>({ok:true,json:async()=>({state:'closed',orderId:`qcr_${JSON.parse(options.body).checkoutId}`})})});
 const original=client.prepare(items,customer);disk.removeItem=()=>{throw Error('storage blocked');};
 await assert.rejects(client.editCart(),e=>e.code==='RECOVERY_UNAVAILABLE');assert.deepEqual(client.current(),original);
 disk.removeItem=remove;assert.deepEqual(await client.editCart(),original);assert.equal(client.current(),null);
});

test('Cashfree return reconciles only the exact saved order',async()=>{
 const disk=storage(),requests=[];
 const client=createCheckoutClient({storage:disk,crypto:webcrypto,fetcher:async(path,options)=>{
  const body=JSON.parse(options.body);requests.push({path,body});return {ok:true,json:async()=>({state:'fulfilled',orderId:body.orderId})};
 }});
 const saved=client.prepare(items,customer),orderId=`qcr_${saved.body.checkoutId}`;
 assert.equal((await client.resumeReturn(orderId)).state,'fulfilled');
 assert.equal(requests[0].path,'/api/qclub-payment-rehearsal');
 await assert.rejects(client.resumeReturn('qcr_00000000-0000-4000-8000-000000000000'),e=>e.code==='RETURN_ORDER_MISMATCH');
 assert.deepEqual(client.current(),saved);
});
