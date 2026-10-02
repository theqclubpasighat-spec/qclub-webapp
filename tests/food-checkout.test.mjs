import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutRequest,createFoodCheckout } from '../src/server/payments/checkout.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { sandboxCheckout } from '../src/server/payments/sandbox-checkout.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';
const body=()=>({checkoutId:'12345678-1234-4123-8123-123456789abc',receiptToken:'a'.repeat(43),customer:{name:'Fixture customer',phone:'9876543210'},items:[{itemId:'momo',quantity:2}]});
test('checkout accepts IDs/quantities only and rejects browser pricing, options and duplicate lines',()=>{
  const original=body();const b=checkoutRequest(original);assert.equal(b.orderId,`qcr_${original.checkoutId}`);
  for(const change of [{amount:1},{customer:{name:'Fixture',phone:'bad'}},{items:[{itemId:'momo',quantity:2,price:1}]},{items:[{itemId:'momo',quantity:1,selectedOptionId:'untrusted'}]},{items:[{itemId:'momo',quantity:1},{itemId:'momo',quantity:1}]},{items:[{itemId:'momo',quantity:0.5}]}])assert.throws(()=>checkoutRequest({...original,...change}));
});
test('sandbox creation reuses order/idempotency identity and recovers duplicate-order responses',async()=>{
  const calls=[];const req=checkoutRequest(body());
  const gateway=sandboxCheckout({QCLUB_REHEARSAL_CASHFREE_ID:'fixture',QCLUB_REHEARSAL_CASHFREE_SECRET:'fixture',QCLUB_REHEARSAL_PUBLIC_URL:'https://preview.example.test'},async(url,options)=>{calls.push({url,options});return options.method==='POST'?{ok:false,status:409}:{ok:true,json:async()=>({order_id:req.orderId})};});
  await gateway.create({...req,amountPaise:16000});
  assert.equal(calls[0].url,'https://sandbox.cashfree.com/pg/orders');assert.equal(calls[0].options.headers['x-idempotency-key'],body().checkoutId);
  const created=JSON.parse(calls[0].options.body);assert.equal(created.order_amount,160);assert.equal(created.order_meta.return_url,'https://preview.example.test/__checkout-preview?order_id={order_id}');assert.equal(created.order_meta.notify_url,'https://preview.example.test/api/qclub-payment-rehearsal?action=webhook');
  assert.equal(calls[1].options.method,'GET');assert.ok(calls[1].url.endsWith(req.orderId));
  assert.equal(calls[0].options.redirect,'error');
  assert.throws(()=>sandboxCheckout({CASHFREE_APP_ID:'production',CASHFREE_SECRET_KEY:'production'}));assert.throws(()=>sandboxCheckout({QCLUB_REHEARSAL_CASHFREE_ID:'fixture',QCLUB_REHEARSAL_CASHFREE_SECRET:'fixture',QCLUB_REHEARSAL_PUBLIC_URL:'https://www.theqclubpasighat.com'}),e=>e.code==='REHEARSAL_PUBLIC_URL_FORBIDDEN');
});
test('real Postgres food checkout freezes server price and joins payment finalization',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
 const fixture=await createFixtureDatabase(),pg=fixture.pg;
 try{
  await pg.exec(`reset role;
   create table public.qclub_operational_records(id uuid primary key default gen_random_uuid(),record_type text not null,record_key text not null,payload jsonb not null,source text not null,status text not null,updated_at timestamptz,unique(record_type,record_key));
   create table public.qclub_fnb_categories(category_key text primary key,active boolean not null);
   create table public.snooker_catalogue_items(id text primary key,name text,qlounge_category_key text,active boolean,show_on_qlounge boolean,online_order_enabled boolean,track_inventory boolean,selling_price_inr numeric);
   insert into public.qclub_fnb_categories values('food',true);
   insert into public.snooker_catalogue_items values('momo','Momo','food',true,true,true,false,80),('tracked','Stock item','food',true,true,true,true,40),('offline','Counter only','food',true,true,false,false,70);
   grant select,insert,update on public.qclub_operational_records,public.snooker_catalogue_items,public.qclub_fnb_categories to service_role;`);
  for(const name of ['20260930113142_payment_fulfillment_rehearsal.sql','20260930113908_food_checkout_rehearsal.sql','20260930173033_checkout_recovery_rehearsal.sql'])await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  assert.equal((await pg.query("select has_function_privilege('anon','public.qclub_food_checkout(text,text,text,jsonb,text,text)','EXECUTE') as allowed")).rows[0].allowed,false);
  await pg.exec('set role service_role');
  const db={async rpc(name,args){try{
   const names={qclub_food_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_items','p_customer_name','p_customer_phone'],qclub_payment_intent:['p_order_id','p_receipt_hash'],qclub_payment_fulfill:['p_order_id','p_receipt_hash','p_amount_paise','p_currency','p_payment_id']};
   const values=names[name].map(k=>k==='p_items'?JSON.stringify(args[k]):args[k]);
   return {data:(await pg.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values)).rows[0].result};
  }catch(error){return {error};}}};
  let attempts=0;const seen=[];
  const gateway={async create(order){attempts++;seen.push(order);if(attempts===1)throw Error('Simulated lost gateway response');return {order_id:order.orderId,order_currency:'INR',order_amount:order.amountPaise/100,order_status:'ACTIVE',payment_session_id:'fixture-session'};}};
  await assert.rejects(createFoodCheckout(db,gateway,body()),/lost gateway/);
  await pg.exec("update public.snooker_catalogue_items set selling_price_inr=95 where id='momo'");
  const ready=await createFoodCheckout(db,gateway,body());assert.equal(ready.amountPaise,16000);assert.equal(ready.state,'ready');
  assert.equal(seen[0].orderId,seen[1].orderId);assert.equal(seen[0].checkoutId,seen[1].checkoutId);
  assert.equal((await pg.query('select count(*)::int as n from qclub_private.payment_intents')).rows[0].n,1);
  await assert.rejects(createFoodCheckout(db,gateway,{...body(),items:[{itemId:'momo',quantity:1}]}),e=>e.code==='CHECKOUT_CONFLICT');
  await assert.rejects(createFoodCheckout(db,gateway,{...body(),receiptToken:'b'.repeat(43)}),e=>e.code==='CHECKOUT_CONFLICT');
  for(const [itemId,code] of [['tracked','STOCK_RESERVATION_REQUIRED'],['offline','ITEM_UNAVAILABLE'],['missing','ITEM_UNAVAILABLE']])await assert.rejects(createFoodCheckout(db,gateway,{...body(),checkoutId:'22345678-1234-4123-8123-123456789abc',items:[{itemId,quantity:1}]}),e=>e.code===code);
  const proof={order_id:ready.orderId,order_currency:'INR',order_amount:160,order_status:'PAID',payments:[{order_id:ready.orderId,payment_currency:'INR',payment_amount:160,payment_status:'SUCCESS',cf_payment_id:'food_payment_1'}]};
  assert.equal((await fulfillPayment(db,{verify:async()=>proof},{orderId:ready.orderId,receiptToken:body().receiptToken})).state,'fulfilled');
  const record=(await pg.query('select payload from public.qclub_operational_records')).rows[0].payload;
  assert.equal(record.total,160);assert.equal(record.items[0].price,80);assert.equal(record.items[0].quantity,2);
  assert.equal((await createFoodCheckout(db,{create(){throw Error('must not create again');}},body())).state,'fulfilled');
 }finally{await fixture.close();}
});
test('checkout endpoint is disabled without rehearsal configuration',async()=>{
 const {default:handler}=await import('../api/qclub-checkout-rehearsal.js');
 const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;}};
 await handler({method:'POST',body:body()},res);assert.equal(res.code,503);assert.equal(res.data.error,'SECURITY_REHEARSAL_DISABLED');
});
