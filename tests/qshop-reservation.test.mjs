import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shopCheckoutRequest,createShopCheckout } from '../src/server/payments/shop.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const token='s'.repeat(43);
const command=(prefix='1',overrides={})=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:token,
  items:[
    {itemId:'cue',quantity:1},
    {itemId:'holder',optionId:'purple',quantity:2},
  ],
  customer:{name:'Shop Fixture',phone:'9876543210'},
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
  ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));

  const state={
    club:{name:'The Q Club'},
    shopCatalog:{items:[
      {id:'cue',name:'Practice Cue',price:100,stock:2,options:[]},
      {id:'holder',name:'Chalk Holder',price:50,stock:0,options:[{id:'purple',label:'Purple',stock:3}]},
      {id:'sold',name:'Sold Out',price:25,stock:0,options:[]},
    ]},
  };
  await pg.query("update public.qclub_state set state=$1,updated_at=now() where key='main'",[JSON.stringify(state)]);
  await pg.exec('set role service_role');

  const specs={
    qclub_shop_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_items','p_customer_name','p_customer_phone'],
    qclub_payment_intent:['p_order_id','p_receipt_hash'],
    qclub_payment_fulfill:['p_order_id','p_receipt_hash','p_amount_paise','p_currency','p_payment_id'],
    qclub_payment_close_terminal_service:['p_order_id','p_reason'],
    qclub_payment_stale_intents:['p_before','p_limit'],
  };
  const db={async rpc(name,args){try{
    if(!Object.hasOwn(specs,name))throw Error('Unknown RPC');
    const values=specs[name].map(k=>k==='p_items'?JSON.stringify(args[k]):args[k]);
    const params=name==='qclub_shop_checkout'
      ? ['$1::text','$2::text','$3::text','$4::jsonb','$5::text','$6::text']
      : values.map((_,i)=>'$'+(i+1));
    const result=await pg.query(`select public.${name}(${params.join(',')}) as result`,values);
    return {data:result.rows[0].result};
  }catch(error){return {error};}}};
  return {...base,db};
}

const gateway={async create(order){return {
  order_id:order.orderId,order_currency:'INR',order_amount:order.amountPaise/100,
  order_status:'ACTIVE',payment_session_id:'shop_fixture'
};}};

async function shopStock(pg,itemId,optionId=''){
  const state=(await pg.query("select state from public.qclub_state where key='main'")).rows[0].state;
  const item=state.shopCatalog.items.find(row=>row.id===itemId);
  if(optionId)return item.options.find(row=>row.id===optionId).stock;
  return item.stock;
}

test('QShop command accepts only item identity, option identity and quantity',()=>{
  const parsed=shopCheckoutRequest(command());
  assert.match(parsed.orderId,/^qcs_/);
  assert.deepEqual(parsed.items.map(x=>Object.keys(x).sort()),[
    ['itemId','optionId','quantity'],['itemId','optionId','quantity']
  ]);
  for(const body of [
    {...command(),amount:1},
    {...command(),items:[{itemId:'cue',quantity:1,price:1}]},
    {...command(),items:[{itemId:'cue',quantity:1},{itemId:'cue',quantity:1}]},
    {...command(),items:[{itemId:'cue',quantity:0}]},
    {...command(),customer:{name:'X',phone:'123'}},
  ]) assert.throws(()=>shopCheckoutRequest(body),e=>['INVALID_SHOP_CHECKOUT','INVALID_SHOP_CART'].includes(e.code));
});

test('QShop reservation freezes server price and atomically reserves base and option stock',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.shop_stock_reservations','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_shop_checkout(text,text,text,jsonb,text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','qclub_private.adjust_shop_stock(text,text,integer)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
    assert.equal((await pg.query("select has_function_privilege('service_role','qclub_private.adjust_shop_stock(text,text,integer)','EXECUTE') as allowed")).rows[0].allowed,true);

    const ready=await createShopCheckout(db,gateway,command('1'));
    assert.equal(ready.state,'ready');assert.equal(ready.amountPaise,20000);
    assert.equal(await shopStock(pg,'cue'),1);
    assert.equal(await shopStock(pg,'holder','purple'),1);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.shop_stock_reservations where order_id=$1",[ready.orderId])).rows[0].n,2);

    let calls=0;
    await assert.rejects(createShopCheckout(db,{create(){calls++;}},command('2',{items:[{itemId:'cue',quantity:2}]})),e=>e.code==='INSUFFICIENT_STOCK');
    assert.equal(calls,0);assert.equal(await shopStock(pg,'cue'),1);

    await assert.rejects(createShopCheckout(db,{create(){calls++;}},command('3',{items:[{itemId:'holder',quantity:1}]})),e=>e.code==='OPTION_REQUIRED');
    assert.equal(calls,0);assert.equal(await shopStock(pg,'holder','purple'),1);
  }finally{await f.close();}
});

test('terminal QShop payment restores reservation once; paid order consumes it without another decrement',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const first=await createShopCheckout(db,gateway,command('4'));
    const expired={verify:async id=>({order_id:id,order_currency:'INR',order_amount:200,order_status:'EXPIRED',payments:[]})};
    assert.equal((await fulfillPayment(db,expired,{orderId:first.orderId,receiptToken:token})).state,'expired');
    assert.equal(await shopStock(pg,'cue'),2);assert.equal(await shopStock(pg,'holder','purple'),3);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.shop_stock_reservations where order_id=$1 and status='released'",[first.orderId])).rows[0].n,2);
    assert.equal((await fulfillPayment(db,{verify(){throw Error('must not recheck terminal');}},{orderId:first.orderId,receiptToken:token})).state,'expired');
    assert.equal(await shopStock(pg,'cue'),2);

    const second=await createShopCheckout(db,gateway,command('5'));
    const paid={verify:async id=>({order_id:id,order_currency:'INR',order_amount:200,order_status:'PAID',payments:[{order_id:id,payment_currency:'INR',payment_amount:200,payment_status:'SUCCESS',cf_payment_id:'shop_payment_1'}]})};
    assert.equal((await fulfillPayment(db,paid,{orderId:second.orderId,receiptToken:token})).state,'fulfilled');
    assert.equal(await shopStock(pg,'cue'),1);assert.equal(await shopStock(pg,'holder','purple'),1);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.shop_stock_reservations where order_id=$1 and status='fulfilled'",[second.orderId])).rows[0].n,2);
    const receipt=(await pg.query("select payload,status from public.qclub_operational_records where record_type='qshop_receipt' and record_key=$1",[second.orderId])).rows[0];
    assert.equal(receipt.status,'paid');assert.equal(receipt.payload.paymentStatus,'Paid');assert.equal(receipt.payload.stockAdjusted,true);
  }finally{await f.close();}
});

test('stale reconciliation discovery includes expired QShop namespace without mutating frozen expiry',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{db}=f;
  try{
    const ready=await createShopCheckout(db,gateway,command('6',{items:[{itemId:'cue',quantity:1}]}));
    const cutoff=new Date(Date.now()+2*60*60*1000).toISOString();
    const rows=(await db.rpc('qclub_payment_stale_intents',{p_before:cutoff,p_limit:10})).data;
    assert.equal(rows.some(row=>row.order_id===ready.orderId),true);
  }finally{await f.close();}
});

test('QShop HTTP action remains disabled without rehearsal configuration',async()=>{
  const {default:handler}=await import('../api/qclub-checkout-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method:'POST',url:'/api/qclub-checkout-rehearsal?action=shop',query:{action:'shop'},headers:{},body:command(),socket:{remoteAddress:'127.0.0.1'}},response);
  assert.equal(response.code,503);assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
