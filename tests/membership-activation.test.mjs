import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { membershipCheckoutRequest,createMembershipCheckout } from '../src/server/payments/membership.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const token='m'.repeat(43);
const command=(prefix='1',overrides={})=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:token,
  membershipId:'membership_bronze',
  customer:{name:'Membership Fixture',phone:'9876543210'},
  ...overrides,
});

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
    create table public.qclub_fnb_categories(category_key text primary key,active boolean not null);
    create table public.snooker_catalogue_items(
      id text primary key,name text not null,qlounge_category_key text,active boolean not null,
      show_on_qlounge boolean not null,online_order_enabled boolean not null,track_inventory boolean not null,
      selling_price_inr numeric,current_stock numeric,updated_at timestamptz not null default now()
    );
    insert into public.qclub_fnb_categories values('food',true);
    insert into public.snooker_catalogue_items values('plain','Plain','food',true,true,true,false,10,null,now());
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
  ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));

  const state={
    club:{name:'The Q Club'},
    memberships:[
      {id:'membership_bronze',tier:'Bronze',price:799,note:'Non-transferable'},
      {id:'membership_silver',tier:'Silver',price:1399,note:'Non-transferable'},
      {id:'membership_invalid',tier:'No Price',price:0},
    ],
    memberRegistry:[],
  };
  await pg.query("update public.qclub_state set state=$1,updated_at=now() where key='main'",[JSON.stringify(state)]);
  await pg.exec('set role service_role');

  const specs={
    qclub_membership_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_membership_id','p_customer_name','p_customer_phone'],
    qclub_payment_intent:['p_order_id','p_receipt_hash'],
    qclub_payment_fulfill:['p_order_id','p_receipt_hash','p_amount_paise','p_currency','p_payment_id'],
    qclub_payment_close_terminal_service:['p_order_id','p_reason'],
    qclub_payment_stale_intents:['p_before','p_limit'],
  };
  const db={async rpc(name,args){try{
    if(!Object.hasOwn(specs,name))throw Error('Unknown RPC');
    const values=specs[name].map(k=>args[k]);
    const result=await pg.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values);
    return {data:result.rows[0].result};
  }catch(error){return {error};}}};
  return {...base,db};
}

const gateway={async create(order){return {
  order_id:order.orderId,order_currency:'INR',order_amount:order.amountPaise/100,
  order_status:'ACTIVE',payment_session_id:'membership_fixture'
};}};

const paidGateway=(amount,paymentId)=>({verify:async id=>({
  order_id:id,order_currency:'INR',order_amount:amount,order_status:'PAID',
  payments:[{order_id:id,payment_currency:'INR',payment_amount:amount,payment_status:'SUCCESS',cf_payment_id:paymentId}],
})});

async function registry(pg){
  return (await pg.query("select state from public.qclub_state where key='main'")).rows[0].state.memberRegistry||[];
}

test('membership command accepts only catalogue identity and customer identity',()=>{
  const parsed=membershipCheckoutRequest(command());
  assert.match(parsed.orderId,/^qcm_/);
  assert.equal(parsed.membershipId,'membership_bronze');
  for(const body of [
    {...command(),amount:1},
    {...command(),validUntil:'2099-01-01'},
    {...command(),tier:'Bronze'},
    {...command(),membershipId:''},
    {...command(),customer:{name:'X',phone:'123'}},
  ]) assert.throws(()=>membershipCheckoutRequest(body),e=>e.code==='INVALID_MEMBERSHIP_CHECKOUT');
});

test('membership price is server authoritative and only one payment may be pending per phone',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.membership_reservations','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_membership_checkout(text,text,text,text,text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
    const ready=await createMembershipCheckout(db,gateway,command('1'));
    assert.equal(ready.state,'ready');assert.equal(ready.amountPaise,79900);assert.equal(ready.tier,'Bronze');
    let calls=0;
    await assert.rejects(createMembershipCheckout(db,{create(){calls++;}},command('2')),e=>e.code==='MEMBERSHIP_PAYMENT_ALREADY_PENDING');
    await assert.rejects(createMembershipCheckout(db,{create(){calls++;}},command('3',{membershipId:'membership_invalid',customer:{name:'Other',phone:'9123456789'}})),e=>e.code==='MEMBERSHIP_NOT_AVAILABLE');
    assert.equal(calls,0);
  }finally{await f.close();}
});

test('paid membership activates one month and renewal extends from current expiry without duplicate member rows',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const first=await createMembershipCheckout(db,gateway,command('4'));
    assert.equal((await fulfillPayment(db,paidGateway(799,'membership_payment_1'),{orderId:first.orderId,receiptToken:token})).state,'fulfilled');
    let rows=await registry(pg);
    assert.equal(rows.length,1);
    assert.equal(rows[0].name,'Membership Fixture');assert.equal(rows[0].tier,'Bronze');assert.equal(rows[0].status,'active');
    const firstExpiry=rows[0].validUntil;
    const expectedFirst=(await pg.query("select (((clock_timestamp() at time zone 'Asia/Kolkata')::date+interval '1 month')::date)::text as d")).rows[0].d;
    assert.equal(firstExpiry,expectedFirst);

    const second=await createMembershipCheckout(db,gateway,command('5',{membershipId:'membership_silver'}));
    assert.equal(second.amountPaise,139900);
    assert.equal((await fulfillPayment(db,paidGateway(1399,'membership_payment_2'),{orderId:second.orderId,receiptToken:token})).state,'fulfilled');
    rows=await registry(pg);
    assert.equal(rows.length,1);assert.equal(rows[0].tier,'Silver');
    const expectedSecond=(await pg.query("select (($1::date+interval '1 month')::date)::text as d",[firstExpiry])).rows[0].d;
    assert.equal(rows[0].validUntil,expectedSecond);
    assert.equal((await pg.query("select count(*)::int as n from public.qclub_operational_records where record_type='membership_activation'")).rows[0].n,2);
  }finally{await f.close();}
});

test('membership identity mismatch is rejected and terminal payment releases pending renewal',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const first=await createMembershipCheckout(db,gateway,command('6'));
    assert.equal((await fulfillPayment(db,paidGateway(799,'membership_payment_3'),{orderId:first.orderId,receiptToken:token})).state,'fulfilled');

    let calls=0;
    await assert.rejects(createMembershipCheckout(db,{create(){calls++;}},command('7',{customer:{name:'Different Name',phone:'9876543210'}})),e=>e.code==='MEMBERSHIP_IDENTITY_MISMATCH');
    assert.equal(calls,0);

    const pending=await createMembershipCheckout(db,gateway,command('8'));
    const cutoff=new Date(Date.now()+2*60*60*1000).toISOString();
    const stale=(await db.rpc('qclub_payment_stale_intents',{p_before:cutoff,p_limit:10})).data;
    assert.equal(stale.some(row=>row.order_id===pending.orderId),true);
    const expired={verify:async id=>({order_id:id,order_currency:'INR',order_amount:799,order_status:'EXPIRED',payments:[]})};
    assert.equal((await fulfillPayment(db,expired,{orderId:pending.orderId,receiptToken:token})).state,'expired');
    assert.equal((await pg.query("select status from qclub_private.membership_reservations where order_id=$1",[pending.orderId])).rows[0].status,'released');
    assert.equal((await createMembershipCheckout(db,gateway,command('9'))).state,'ready');
  }finally{await f.close();}
});

test('membership HTTP action remains disabled without rehearsal configuration',async()=>{
  const {default:handler}=await import('../api/qclub-checkout-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method:'POST',url:'/api/qclub-checkout-rehearsal?action=membership',query:{action:'membership'},headers:{},body:command(),socket:{remoteAddress:'127.0.0.1'}},response);
  assert.equal(response.code,503);assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
