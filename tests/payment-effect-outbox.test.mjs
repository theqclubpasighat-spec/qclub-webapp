import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFoodCheckout } from '../src/server/payments/checkout.js';
import { createMembershipCheckout } from '../src/server/payments/membership.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const foodToken='e'.repeat(43);
const membershipToken='n'.repeat(43);

async function fixture(){
  const base=await createFixtureDatabase(),pg=base.pg;
  await pg.exec(`reset role;
    create table public.qclub_operational_records(
      id uuid primary key default gen_random_uuid(),
      record_type text not null,record_key text not null,payload jsonb not null default '{}',
      source text not null default 'webapp',status text not null default 'active',
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      deleted_at timestamptz,unique(record_type,record_key)
    );
    create table public.qclub_fnb_categories(category_key text primary key,title text,active boolean not null);
    create table public.snooker_catalogue_items(
      id text primary key,name text not null,qlounge_category_key text,active boolean not null,
      show_on_qlounge boolean not null,online_order_enabled boolean not null,track_inventory boolean not null,
      selling_price_inr numeric,current_stock numeric,updated_at timestamptz not null default now()
    );
    insert into public.qclub_fnb_categories values('food','Food',true);
    insert into public.snooker_catalogue_items values('momo','Momo','food',true,true,true,false,80,null,now());
    grant select,insert,update on public.qclub_operational_records,public.snooker_catalogue_items,public.qclub_fnb_categories to service_role;
  `);
  for(const name of [
    '20260930113142_payment_fulfillment_rehearsal.sql',
    '20260930113908_food_checkout_rehearsal.sql',
    '20260930173033_checkout_recovery_rehearsal.sql',
    '20261002_online_stock_reservations_rehearsal.sql',
    '20261002_stale_payment_reconciliation_rehearsal.sql',
    '20261002_booking_slot_reservations_rehearsal.sql',
    '20261002_qshop_stock_reservations_rehearsal.sql',
    '20261002_tournament_registration_rehearsal.sql',
    '20261002_membership_activation_rehearsal.sql',
    '20261002_payment_effect_outbox_rehearsal.sql',
    '20261002_payment_effect_recovery_rehearsal.sql',
  ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));

  const state={
    club:{name:'The Q Club'},
    memberships:[{id:'membership_bronze',tier:'Bronze',price:799,note:'Non-transferable'}],
    memberRegistry:[],
  };
  await pg.query("update public.qclub_state set state=$1,updated_at=now() where key='main'",[JSON.stringify(state)]);
  await pg.exec('set role service_role');

  const specs={
    qclub_food_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_items','p_customer_name','p_customer_phone'],
    qclub_membership_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_membership_id','p_customer_name','p_customer_phone'],
    qclub_payment_intent:['p_order_id','p_receipt_hash'],
    qclub_payment_fulfill:['p_order_id','p_receipt_hash','p_amount_paise','p_currency','p_payment_id'],
    qclub_payment_close_terminal_service:['p_order_id','p_reason'],
    qclub_payment_effect_claim:['p_effect_type','p_worker_id'],
    qclub_payment_effect_complete:['p_id','p_worker_id','p_success','p_error'],
    qclub_payment_effect_summary:[],
    qclub_payment_effect_retry_failed:['p_id'],
  };
  const db={async rpc(name,args){try{
    if(!Object.hasOwn(specs,name))throw Error('Unknown RPC');
    const values=specs[name].map(k=>k==='p_items'?JSON.stringify(args[k]):args[k]);
    const params=name==='qclub_food_checkout'
      ? ['$1::text','$2::text','$3::text','$4::jsonb','$5::text','$6::text']
      : values.map((_,i)=>'$'+(i+1));
    const result=await pg.query(`select public.${name}(${params.join(',')}) as result`,values);
    return {data:result.rows[0].result};
  }catch(error){return {error};}}};
  return {...base,db};
}

const checkoutGateway={async create(order){return {
  order_id:order.orderId,order_currency:'INR',order_amount:order.amountPaise/100,
  order_status:'ACTIVE',payment_session_id:'effect_fixture'
};}};
const paidGateway=(amount,id)=>({verify:async orderId=>({
  order_id:orderId,order_currency:'INR',order_amount:amount,order_status:'PAID',
  payments:[{order_id:orderId,payment_currency:'INR',payment_amount:amount,payment_status:'SUCCESS',cf_payment_id:id}],
})});

const foodCommand=prefix=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:foodToken,
  items:[{itemId:'momo',quantity:2}],
  customer:{name:'Effect Fixture',phone:'9876543210'},
});
const membershipCommand=prefix=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:membershipToken,
  membershipId:'membership_bronze',
  customer:{name:'Membership Effect',phone:'9123456789'},
});

test('post-payment outbox is private and service-only claim/complete RPCs are not client executable',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg}=f;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.payment_effect_outbox','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_effect_claim(text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_effect_complete(uuid,text,boolean,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
  }finally{await f.close();}
});

test('paid food atomically enqueues one WhatsApp effect and one print effect without duplicate replay',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const ready=await createFoodCheckout(db,checkoutGateway,foodCommand('1'));
    assert.equal((await fulfillPayment(db,paidGateway(160,'effect_payment_1'),{orderId:ready.orderId,receiptToken:foodToken})).state,'fulfilled');
    let rows=(await pg.query("select effect_type,payload,status from qclub_private.payment_effect_outbox where order_id=$1 order by effect_type",[ready.orderId])).rows;
    assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.effect_type),['print_food','whatsapp_success']);
    assert.equal(rows.find(x=>x.effect_type==='whatsapp_success').payload.label,'food_success');
    assert.equal(rows.find(x=>x.effect_type==='whatsapp_success').payload.provider,'msg91');
    assert.equal(rows.find(x=>x.effect_type==='print_food').payload.items.length,1);

    assert.equal((await fulfillPayment(db,{verify(){throw Error('must not reverify');}},{orderId:ready.orderId,receiptToken:foodToken})).state,'fulfilled');
    rows=(await pg.query("select * from qclub_private.payment_effect_outbox where order_id=$1",[ready.orderId])).rows;
    assert.equal(rows.length,2);
  }finally{await f.close();}
});

test('effect claim is exclusive, failure retries, and successful acknowledgement is durable',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{db}=f;
  try{
    const ready=await createFoodCheckout(db,checkoutGateway,foodCommand('2'));
    await fulfillPayment(db,paidGateway(160,'effect_payment_2'),{orderId:ready.orderId,receiptToken:foodToken});

    const first=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-a'})).data;
    assert.ok(first.job?.id);assert.equal(first.job.attempts,1);
    const blocked=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-b'})).data;
    assert.equal(blocked.job,null);

    assert.equal((await db.rpc('qclub_payment_effect_complete',{p_id:first.job.id,p_worker_id:'printer-a',p_success:false,p_error:'paper out'})).data.status,'pending');
    const retry=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-b'})).data;
    assert.equal(retry.job.id,first.job.id);assert.equal(retry.job.attempts,2);
    assert.equal((await db.rpc('qclub_payment_effect_complete',{p_id:retry.job.id,p_worker_id:'printer-b',p_success:true,p_error:null})).data.status,'sent');
    assert.equal((await db.rpc('qclub_payment_effect_complete',{p_id:retry.job.id,p_worker_id:'any-worker',p_success:true,p_error:null})).data.status,'sent');
  }finally{await f.close();}
});

test('membership WhatsApp effect is queued only after activation and includes server-derived validity',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const ready=await createMembershipCheckout(db,checkoutGateway,membershipCommand('3'));
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.payment_effect_outbox")).rows[0].n,0);
    await fulfillPayment(db,paidGateway(799,'effect_membership_1'),{orderId:ready.orderId,receiptToken:membershipToken});
    const job=(await pg.query("select payload from qclub_private.payment_effect_outbox where order_id=$1 and effect_type='whatsapp_success'",[ready.orderId])).rows[0].payload;
    assert.equal(job.label,'membership_success');assert.equal(job.context,'membership');
    assert.match(job.data.validUntil,/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    assert.equal(job.data.tier,'Bronze');
  }finally{await f.close();}
});

test('terminal unpaid order never creates post-payment effects',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const ready=await createFoodCheckout(db,checkoutGateway,foodCommand('4'));
    const expired={verify:async id=>({order_id:id,order_currency:'INR',order_amount:160,order_status:'EXPIRED',payments:[]})};
    assert.equal((await fulfillPayment(db,expired,{orderId:ready.orderId,receiptToken:foodToken})).state,'expired');
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.payment_effect_outbox where order_id=$1",[ready.orderId])).rows[0].n,0);
  }finally{await f.close();}
});


test('aggregate queue health and manual dead-letter retry recover a failed effect without touching payment fulfilment',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const ready=await createFoodCheckout(db,checkoutGateway,foodCommand('5'));
    await fulfillPayment(db,paidGateway(160,'effect_payment_5'),{orderId:ready.orderId,receiptToken:foodToken});
    const claimed=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-dead'})).data.job;
    assert.ok(claimed?.id);

    // Drive the same job to the dead-letter state without changing the paid order.
    for(let attempt=1;attempt<=10;attempt++){
      const result=(await db.rpc('qclub_payment_effect_complete',{
        p_id:claimed.id,p_worker_id:'printer-dead',p_success:false,p_error:'printer offline'
      })).data;
      if(attempt<10){
        assert.equal(result.status,'pending');
        const next=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-dead'})).data.job;
        assert.equal(next.id,claimed.id);
      }else assert.equal(result.status,'failed');
    }

    let summary=(await db.rpc('qclub_payment_effect_summary',{})).data;
    assert.equal(Number(summary.failed),1);
    assert.equal(Number(summary.pending),1); // food WhatsApp remains untouched
    assert.equal(summary.oldest_failed_at!=null,true);

    const paidBefore=(await pg.query("select status,gateway_payment_id from qclub_private.payment_intents where order_id=$1",[ready.orderId])).rows[0];
    const operationalBefore=(await pg.query("select count(*)::int as n from public.qclub_operational_records where record_key=$1",[ready.orderId])).rows[0].n;

    const retried=(await db.rpc('qclub_payment_effect_retry_failed',{p_id:claimed.id})).data;
    assert.equal(retried.ok,true);assert.equal(retried.status,'pending');assert.equal(retried.effectType,'print_food');

    summary=(await db.rpc('qclub_payment_effect_summary',{})).data;
    assert.equal(Number(summary.failed),0);assert.equal(Number(summary.pending),2);
    const row=(await pg.query("select status,attempts,worker_id,claimed_at,last_error from qclub_private.payment_effect_outbox where id=$1",[claimed.id])).rows[0];
    assert.equal(row.status,'pending');assert.equal(row.attempts,0);assert.equal(row.worker_id,null);assert.equal(row.claimed_at,null);assert.equal(row.last_error,null);

    const paidAfter=(await pg.query("select status,gateway_payment_id from qclub_private.payment_intents where order_id=$1",[ready.orderId])).rows[0];
    const operationalAfter=(await pg.query("select count(*)::int as n from public.qclub_operational_records where record_key=$1",[ready.orderId])).rows[0].n;
    assert.deepEqual(paidAfter,paidBefore);assert.equal(operationalAfter,operationalBefore);

    const next=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-recovered'})).data.job;
    assert.equal(next.id,claimed.id);assert.equal(next.attempts,1);
  }finally{await f.close();}
});

test('effect recovery RPCs are service-only and refuse retry of sent or active jobs',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_effect_summary()','EXECUTE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_effect_retry_failed(uuid)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
    const ready=await createFoodCheckout(db,checkoutGateway,foodCommand('6'));
    await fulfillPayment(db,paidGateway(160,'effect_payment_6'),{orderId:ready.orderId,receiptToken:foodToken});
    const job=(await db.rpc('qclub_payment_effect_claim',{p_effect_type:'print_food',p_worker_id:'printer-active'})).data.job;
    let retry=(await db.rpc('qclub_payment_effect_retry_failed',{p_id:job.id})).data;
    assert.equal(retry.ok,false);assert.equal(retry.conflict,true);assert.equal(retry.status,'processing');
    await db.rpc('qclub_payment_effect_complete',{p_id:job.id,p_worker_id:'printer-active',p_success:true,p_error:null});
    retry=(await db.rpc('qclub_payment_effect_retry_failed',{p_id:job.id})).data;
    assert.equal(retry.ok,false);assert.equal(retry.conflict,true);assert.equal(retry.status,'sent');
  }finally{await f.close();}
});
