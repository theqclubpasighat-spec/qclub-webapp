import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFoodCheckout } from '../src/server/payments/checkout.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const token='a'.repeat(43);
const command=(prefix='1',items=[{itemId:'tracked',quantity:2}])=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:token,
  customer:{name:'Stock Fixture',phone:'9876543210'},
  items,
});

async function stockFixture(){
  const fixture=await createFixtureDatabase(),pg=fixture.pg;
  await pg.exec(`reset role;
    create table public.qclub_operational_records(
      id uuid primary key default gen_random_uuid(),record_type text not null,record_key text not null,
      payload jsonb not null,source text not null,status text not null,updated_at timestamptz,
      unique(record_type,record_key)
    );
    create table public.qclub_fnb_categories(category_key text primary key,active boolean not null);
    create table public.snooker_catalogue_items(
      id text primary key,name text not null,qlounge_category_key text,active boolean not null,
      show_on_qlounge boolean not null,online_order_enabled boolean not null,track_inventory boolean not null,
      selling_price_inr numeric,current_stock numeric,updated_at timestamptz not null default now()
    );
    insert into public.qclub_fnb_categories values('food',true);
    insert into public.snooker_catalogue_items values
      ('tracked','Tracked Drink','food',true,true,true,true,40,3,now()),
      ('a_tracked','Tracked First','food',true,true,true,true,20,2,now()),
      ('z_offline','Offline Later','food',true,true,false,false,50,null,now()),
      ('plain','Plain Food','food',true,true,true,false,80,null,now());
    grant select,insert,update on public.qclub_operational_records,public.snooker_catalogue_items,public.qclub_fnb_categories to service_role;
  `);
  for(const name of [
    '20260930113142_payment_fulfillment_rehearsal.sql',
    '20260930113908_food_checkout_rehearsal.sql',
    '20260930173033_checkout_recovery_rehearsal.sql',
    '20261002_online_stock_reservations_rehearsal.sql'
  ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await pg.exec('set role service_role');
  const specs={
    qclub_food_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_items','p_customer_name','p_customer_phone'],
    qclub_payment_intent:['p_order_id','p_receipt_hash'],
    qclub_payment_fulfill:['p_order_id','p_receipt_hash','p_amount_paise','p_currency','p_payment_id'],
    qclub_payment_close_terminal_service:['p_order_id','p_reason'],
  };
  const db={async rpc(name,args){try{
    const values=specs[name].map(k=>k==='p_items'?JSON.stringify(args[k]):args[k]);
    const result=await pg.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values);
    return {data:result.rows[0].result};
  }catch(error){return {error};}}};
  return {...fixture,db};
}
const activeGateway={async create(order){return {order_id:order.orderId,order_currency:'INR',order_amount:order.amountPaise/100,order_status:'ACTIVE',payment_session_id:'fixture'};}};

test('tracked checkout reserves atomically, blocks oversell, and terminal Cashfree release restores once',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await stockFixture(),{pg,db}=fixture;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.checkout_stock_reservations','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_close_terminal_service(text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
    const first=await createFoodCheckout(db,activeGateway,command('1'));
    assert.equal(first.state,'ready');assert.equal(first.amountPaise,8000);
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),1);
    assert.equal((await pg.query("select status from qclub_private.checkout_stock_reservations where order_id=$1",[first.orderId])).rows[0].status,'reserved');

    let gatewayCalls=0;
    await assert.rejects(createFoodCheckout(db,{create(){gatewayCalls++;}},command('2')),e=>e.code==='INSUFFICIENT_STOCK');
    assert.equal(gatewayCalls,0);
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),1);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.payment_intents")).rows[0].n,1);

    let verifies=0;
    const expired={verify:async id=>{verifies++;return {order_id:id,order_currency:'INR',order_amount:80,order_status:'EXPIRED',payments:[]};}};
    const result=await fulfillPayment(db,expired,{orderId:first.orderId,receiptToken:token});
    assert.equal(result.state,'expired');assert.equal(result.reason,'EXPIRED');
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),3);
    assert.equal((await pg.query("select status from qclub_private.checkout_stock_reservations where order_id=$1",[first.orderId])).rows[0].status,'released');

    const duplicate=await fulfillPayment(db,{verify(){verifies++;throw Error('must not reverify terminal');}},{orderId:first.orderId,receiptToken:token});
    assert.equal(duplicate.state,'expired');assert.equal(verifies,1);
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),3);

    const second=await createFoodCheckout(db,activeGateway,command('2'));
    assert.equal(second.state,'ready');
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),1);
  }finally{await fixture.close();}
});

test('successful payment consumes reservation without a second stock decrement',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await stockFixture(),{pg,db}=fixture;
  try{
    const ready=await createFoodCheckout(db,activeGateway,command('3'));
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),1);
    const paid={verify:async id=>({order_id:id,order_currency:'INR',order_amount:80,order_status:'PAID',payments:[{order_id:id,payment_currency:'INR',payment_amount:80,payment_status:'SUCCESS',cf_payment_id:'stock_payment_1'}]})};
    assert.equal((await fulfillPayment(db,paid,{orderId:ready.orderId,receiptToken:token})).state,'fulfilled');
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),1);
    assert.equal((await pg.query("select status from qclub_private.checkout_stock_reservations where order_id=$1",[ready.orderId])).rows[0].status,'fulfilled');
    assert.equal((await pg.query("select count(*)::int as n from public.qclub_operational_records")).rows[0].n,1);
    const terminal=await db.rpc('qclub_payment_close_terminal_service',{p_order_id:ready.orderId,p_reason:'EXPIRED'});
    assert.equal(terminal.data.ok,false);assert.equal(terminal.data.conflict,true);
  }finally{await fixture.close();}
});

test('mixed-cart rejection leaves previously locked tracked stock untouched',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await stockFixture(),{pg,db}=fixture;
  try{
    let calls=0;
    await assert.rejects(createFoodCheckout(db,{create(){calls++;}},command('4',[
      {itemId:'a_tracked',quantity:1},{itemId:'z_offline',quantity:1}
    ])),e=>e.code==='ITEM_UNAVAILABLE');
    assert.equal(calls,0);
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='a_tracked'")).rows[0].current_stock),2);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.checkout_stock_reservations")).rows[0].n,0);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.payment_intents")).rows[0].n,0);
  }finally{await fixture.close();}
});

test('pending Cashfree transaction never releases reserved stock',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await stockFixture(),{pg,db}=fixture;
  try{
    const ready=await createFoodCheckout(db,activeGateway,command('5'));
    const evidence={verify:async id=>({order_id:id,order_currency:'INR',order_amount:80,order_status:'EXPIRED',payments:[{order_id:id,payment_currency:'INR',payment_amount:80,payment_status:'PENDING',cf_payment_id:'pending_1'}]})};
    assert.equal((await fulfillPayment(db,evidence,{orderId:ready.orderId,receiptToken:token})).state,'pending');
    assert.equal(Number((await pg.query("select current_stock from public.snooker_catalogue_items where id='tracked'")).rows[0].current_stock),1);
    assert.equal((await pg.query("select status from qclub_private.checkout_stock_reservations where order_id=$1",[ready.orderId])).rows[0].status,'reserved');
  }finally{await fixture.close();}
});
