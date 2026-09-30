import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fulfillPayment,amountInPaise,sandboxGateway } from '../src/server/payments/fulfillment.js';
import { tokenHash } from '../src/server/security/foundation.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';
const token='a'.repeat(43),body={orderId:'fixture_order',receiptToken:token};
const evidence=()=>({order_id:body.orderId,order_amount:120.5,order_currency:'INR',order_status:'PAID',payments:[{order_id:body.orderId,payment_status:'SUCCESS',payment_currency:'INR',payment_amount:120.5,cf_payment_id:'payment_1'}]});
test('amount checks reject rounding, malformed amounts and zero values',()=>{
  assert.equal(amountInPaise('120.50'),12050);assert.equal(amountInPaise(0.1),10);
  for(const value of [0,-1,'1.001','1e2','Infinity',null,'',' 10'])assert.throws(()=>amountInPaise(value));
});
test('browser command rejects injected amount, paid flags and missing receipt proof',async()=>{
  let called=false;const db={rpc(){called=true;}};
  for(const b of [{...body,paid:true},{...body,amount:1},{orderId:'x'},{...body,orderId:['fixture_order']},null])await assert.rejects(fulfillPayment(db,{},b),e=>e.code==='INVALID_PAYMENT_COMMAND');
  assert.equal(called,false);
});
test('unverified or mismatched gateway responses cannot fulfill an order',async()=>{
  let writes=0;
  const db={async rpc(name){if(name==='qclub_payment_intent')return {data:{amount_paise:12050,status:'pending'}};writes++;return {data:{ok:true}};}};
  for(const fields of [{order_amount:1},{order_currency:'USD'},{order_id:'another'},{payments:[]},{payments:[{...evidence().payments[0],payment_amount:1}]}])await assert.rejects(fulfillPayment(db,{verify:async()=>({...evidence(),...fields})},body),e=>e.code==='PAYMENT_MISMATCH');
  assert.equal((await fulfillPayment(db,{verify:async()=>({...evidence(),order_status:'ACTIVE'})},body)).state,'pending');
  assert.equal(writes,0);
  await assert.rejects(fulfillPayment({rpc:async()=>({data:null})},{verify(){throw Error('must not call');}},body),e=>e.status===404);
});
test('gateway adapter uses only sandbox GETs, dedicated credentials and no redirects',async()=>{
  const requests=[];
  const gateway=sandboxGateway({QCLUB_REHEARSAL_CASHFREE_ID:'test',QCLUB_REHEARSAL_CASHFREE_SECRET:'fixture'},async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.endsWith('/payments')?evidence().payments:evidence()};});
  await gateway.verify(body.orderId);
  assert.equal(requests.length,2);
  for(const r of requests){assert.ok(r.url.startsWith('https://sandbox.cashfree.com/pg/orders/'));assert.equal(r.options.method,'GET');assert.equal(r.options.redirect,'error');}
  assert.throws(()=>sandboxGateway({CASHFREE_APP_ID:'real',CASHFREE_SECRET_KEY:'real'}),e=>e.code==='SANDBOX_GATEWAY_REQUIRED');
});
test('Postgres finalization is atomic, retry-safe and preserves staff work and shared state',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await createFixtureDatabase(),pg=fixture.pg;
  try{
    await pg.exec(`reset role;
      create table public.qclub_operational_records(id uuid primary key default gen_random_uuid(),record_type text not null,record_key text not null,payload jsonb not null default '{}',source text not null default 'webapp',status text not null default 'active',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,unique(record_type,record_key));
      grant select,insert,update on public.qclub_operational_records to service_role;`);
    await pg.exec(await readFile(new URL('../supabase/migrations/20260930113142_payment_fulfillment_rehearsal.sql',import.meta.url),'utf8'));
    const access=await pg.query("select has_function_privilege('anon','public.qclub_payment_fulfill(text,text,bigint,text,text)','EXECUTE') as allowed");assert.equal(access.rows[0].allowed,false);
    await pg.exec('set role service_role');
    const before=(await pg.query("select state from public.qclub_state where key='main'")).rows[0].state;
    const seed=async(id,type='q_lounge_order')=>pg.query('insert into qclub_private.payment_intents(order_id,receipt_hash,amount_paise,record_type,record_key,payload) values($1,$2,12050,$3,$1,$4)',[id,tokenHash(token),type,JSON.stringify({id,items:[{id:'fixture-item',qty:1,price:120.5}],customerName:'Synthetic customer',printStatus:'pending_auto_print'})]);
    await seed(body.orderId);
    await assert.rejects(pg.query("update qclub_private.payment_intents set amount_paise=1 where order_id=$1",[body.orderId]),/IMMUTABLE_PAYMENT_TERMS/);
    assert.equal((await pg.query("select public.qclub_payment_fulfill($1,$2,1,'INR','wrong_amount') as result",[body.orderId,tokenHash(token)])).rows[0].result.conflict,true);
    assert.equal((await pg.query("select public.qclub_payment_intent($1,$2) as result",[body.orderId,tokenHash('wrong')])).rows[0].result,null);
    const db={async rpc(name,args){
      try{
        const values=name==='qclub_payment_intent'?[args.p_order_id,args.p_receipt_hash]:[args.p_order_id,args.p_receipt_hash,args.p_amount_paise,args.p_currency,args.p_payment_id];
        const r=await pg.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values);return {data:r.rows[0].result};
      }catch(error){return {error};}
    }};
    assert.equal((await fulfillPayment(db,{verify:async()=>evidence()},body)).state,'fulfilled');
    await pg.query("update public.qclub_operational_records set status='served',payload=payload||'{\"printStatus\":\"printed\"}'::jsonb where record_key=$1",[body.orderId]);
    assert.equal((await fulfillPayment(db,{verify(){throw Error('unneeded retry');}},body)).state,'fulfilled');
    const replay=await pg.query("select public.qclub_payment_fulfill($1,$2,12050,'INR','payment_1') as result",[body.orderId,tokenHash(token)]);assert.equal(replay.rows[0].result.ok,true);
    const existing=(await pg.query('select * from public.qclub_operational_records')).rows;assert.equal(existing.length,1);assert.equal(existing[0].status,'served');assert.equal(existing[0].payload.printStatus,'printed');
    await seed('fixture_second','qshop_receipt');
    // A payment ID reused for another order fails after INSERT: the entire transaction rolls back.
    await assert.rejects(pg.query("select public.qclub_payment_fulfill('fixture_second',$1,12050,'INR','payment_1')",[tokenHash(token)]),/unique/);
    assert.equal((await pg.query("select count(*)::int as n from public.qclub_operational_records where record_key='fixture_second'")).rows[0].n,0);
    assert.equal((await pg.query("select status from qclub_private.payment_intents where order_id='fixture_second'")).rows[0].status,'pending');
    await seed('fixture_booking','booking_request');
    const booked=await pg.query("select public.qclub_payment_fulfill('fixture_booking',$1,12050,'INR','payment_2') as result",[tokenHash(token)]);assert.equal(booked.rows[0].result.ok,true);
    assert.equal((await pg.query("select status from public.qclub_operational_records where record_key='fixture_booking'")).rows[0].status,'paid_verified');
    await seed('fixture_collision');
    await pg.query("insert into public.qclub_operational_records(record_type,record_key,payload,status) values('q_lounge_order','fixture_collision','{}','staff-existing')");
    assert.equal((await pg.query("select public.qclub_payment_fulfill('fixture_collision',$1,12050,'INR','payment_3') as result",[tokenHash(token)])).rows[0].result.conflict,true);
    assert.equal((await pg.query("select status from qclub_private.payment_intents where order_id='fixture_collision'")).rows[0].status,'pending');
    assert.deepEqual((await pg.query("select state from public.qclub_state where key='main'")).rows[0].state,before);
  }finally{await fixture.close();}
});
test('payment HTTP entry defaults to disabled',async()=>{
  const {default:handler}=await import('../api/qclub-payment-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method:'POST',body},response);
  assert.equal(response.code,503);assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
