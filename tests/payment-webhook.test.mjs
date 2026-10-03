import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { processCashfreeWebhook,verifyCashfreeWebhook } from '../src/server/payments/webhook.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const secret='fixture-secret';
const orderId='qcr_12345678-1234-4123-8123-123456789abc';
const payload=()=>JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:orderId,order_amount:160,order_currency:'INR'},payment:{payment_status:'SUCCESS',cf_payment_id:'payment_webhook_1'}}});
const headers=raw=>{const timestamp='1790925000';return {'x-webhook-timestamp':timestamp,'x-webhook-signature':createHmac('sha256',secret).update(timestamp+raw).digest('base64')};};

test('Cashfree webhook signature is strict over timestamp plus the exact raw body',()=>{
 const raw=payload();
 assert.equal(verifyCashfreeWebhook(raw,headers(raw),secret),true);
 assert.throws(()=>verifyCashfreeWebhook(raw+' ',headers(raw),secret),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');
 assert.throws(()=>verifyCashfreeWebhook(raw,{},secret),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');
});

test('successful webhook re-verifies Cashfree and fulfils once without browser receipt proof',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
 const fixture=await createFixtureDatabase(),pg=fixture.pg;
 try{
  await pg.exec(`reset role;
   create table public.qclub_operational_records(id uuid primary key default gen_random_uuid(),record_type text not null,record_key text not null,payload jsonb not null default '{}',source text not null default 'webapp',status text not null default 'active',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,unique(record_type,record_key));
   grant select,insert,update on public.qclub_operational_records to service_role;`);
  await pg.exec(await readFile(new URL('../supabase/migrations/20260930113142_payment_fulfillment_rehearsal.sql',import.meta.url),'utf8'));
  for(const role of ['anon','authenticated']){
   assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_intent_service(text)','EXECUTE') as allowed`)).rows[0].allowed,false);
   assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_fulfill_service(text,bigint,text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
  }
  await pg.exec('set role service_role');
  await pg.query(`insert into qclub_private.payment_intents(order_id,receipt_hash,amount_paise,record_type,record_key,payload,expires_at)
    values($1,$2,16000,'q_lounge_order',$1,$3,clock_timestamp()-interval '1 hour')`,[orderId,'a'.repeat(64),JSON.stringify({id:orderId,items:[{id:'momo',qty:2,price:80}],customerName:'Fixture'})]);
  const db={async rpc(name,args){try{
   const specs={qclub_payment_intent_service:['p_order_id'],qclub_payment_fulfill_service:['p_order_id','p_amount_paise','p_currency','p_payment_id']};
   const values=specs[name].map(k=>args[k]);
   return {data:(await pg.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values)).rows[0].result};
  }catch(error){return {error};}}};
  let verifies=0;
  const gateway={async verify(id){verifies++;return {order_id:id,order_currency:'INR',order_amount:160,order_status:'PAID',payments:[{order_id:id,payment_currency:'INR',payment_amount:160,payment_status:'SUCCESS',cf_payment_id:'payment_webhook_1'}]};}};
  const raw=payload();
  assert.equal((await processCashfreeWebhook({db,gateway,rawBody:raw,headers:headers(raw),secret})).state,'fulfilled');
  assert.equal(verifies,1);
  assert.equal((await pg.query('select count(*)::int as n from public.qclub_operational_records')).rows[0].n,1);
  assert.equal((await pg.query('select status from qclub_private.payment_intents where order_id=$1',[orderId])).rows[0].status,'fulfilled');
  assert.equal((await processCashfreeWebhook({db,gateway,rawBody:raw,headers:headers(raw),secret})).state,'fulfilled');
  assert.equal(verifies,1);
 }finally{await fixture.close();}
});

test('non-success webhook never triggers gateway verification',async()=>{
 const raw=JSON.stringify({data:{order:{order_id:orderId},payment:{payment_status:'FAILED'}}});
 let calls=0;
 const result=await processCashfreeWebhook({db:{},gateway:{verify(){calls++;}},rawBody:raw,headers:headers(raw),secret});
 assert.equal(result.state,'ignored');assert.equal(calls,0);
});

test('webhook endpoint remains disabled unless rehearsal mode is explicitly enabled',async()=>{
 const {default:handler}=await import('../api/qclub-payment-rehearsal.js');
 const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
 await handler({method:'POST',url:'/api/qclub-payment-rehearsal?action=webhook',query:{action:'webhook'},headers:{},async *[Symbol.asyncIterator](){}},response);
 assert.equal(response.code,503);assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
