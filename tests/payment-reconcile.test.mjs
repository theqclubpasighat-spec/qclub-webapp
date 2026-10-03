import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileStalePayments } from '../src/server/payments/reconcile.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const makeOrder=n=>`qcr_${String(n).padStart(8,'0')}-1234-4123-8123-${String(n).padStart(12,'0')}`;

test('reconciler is bounded, continues after per-order errors, and returns counts only',async()=>{
  const rows=[1,2,3,4,5].map(n=>({order_id:makeOrder(n),expires_at:'2026-10-02T00:00:00Z'}));
  const intents=new Map(rows.map((row,i)=>[row.order_id,{amount_paise:1000,status:'pending',terminal_at:null,terminal_reason:null,mode:i}]));
  const db={async rpc(name,args){
    if(name==='qclub_payment_stale_intents')return {data:rows};
    if(name==='qclub_payment_intent_service')return {data:intents.get(args.p_order_id)};
    if(name==='qclub_payment_fulfill_service')return {data:{ok:true}};
    if(name==='qclub_payment_close_terminal_service')return {data:{ok:true,terminal_reason:args.p_reason}};
    return {error:new Error('unexpected rpc')};
  }};
  const gateway={async verify(id){
    const mode=intents.get(id).mode;
    if(mode===0)return {order_id:id,order_currency:'INR',order_amount:10,order_status:'PAID',payments:[{order_id:id,payment_currency:'INR',payment_amount:10,payment_status:'SUCCESS',cf_payment_id:'pay_1'}]};
    if(mode===1)return {order_id:id,order_currency:'INR',order_amount:10,order_status:'EXPIRED',payments:[]};
    if(mode===2)return {order_id:id,order_currency:'INR',order_amount:10,order_status:'ACTIVE',payments:[]};
    if(mode===3)throw Error('gateway outage');
    return {order_id:id,order_currency:'INR',order_amount:10,order_status:'TERMINATION_REQUESTED',payments:[]};
  }};
  const result=await reconcileStalePayments(db,gateway,{before:new Date('2026-10-02T01:00:00Z'),limit:20});
  assert.deepEqual(result,{ok:true,checked:5,fulfilled:1,released:1,pending:2,errors:1});
  assert.deepEqual(Object.keys(result).sort(),['checked','errors','fulfilled','ok','pending','released']);
});

test('stale discovery is service-role only, expired-food-only and capped at twenty',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await createFixtureDatabase(),pg=fixture.pg;
  try{
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
      insert into public.snooker_catalogue_items values('plain','Plain','food',true,true,true,false,10,null,now());
      grant select,insert,update on public.qclub_operational_records,public.snooker_catalogue_items,public.qclub_fnb_categories to service_role;
    `);
    for(const name of [
      '20260930113142_payment_fulfillment_rehearsal.sql',
      '20260930113908_food_checkout_rehearsal.sql',
      '20260930173033_checkout_recovery_rehearsal.sql',
      '20261002_online_stock_reservations_rehearsal.sql',
      '20261002_stale_payment_reconciliation_rehearsal.sql'
    ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));

    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_payment_stale_intents(timestamptz,integer)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }

    await pg.exec('set role service_role');
    const now='2026-10-02T08:00:00Z';
    for(let i=1;i<=25;i++){
      await pg.query(`insert into qclub_private.payment_intents(order_id,receipt_hash,amount_paise,record_type,record_key,payload,expires_at)
        values($1,$2,1000,'q_lounge_order',$1,'{}',$3)`,[makeOrder(i),'a'.repeat(64),'2026-10-02T07:00:00Z']);
    }
    await pg.query(`insert into qclub_private.payment_intents(order_id,receipt_hash,amount_paise,record_type,record_key,payload,expires_at)
      values($1,$2,1000,'q_lounge_order',$1,'{}','2026-10-02T09:00:00Z')`,[makeOrder(90),'b'.repeat(64)]);
    await pg.query(`insert into qclub_private.payment_intents(order_id,receipt_hash,amount_paise,record_type,record_key,payload,expires_at,terminal_at,terminal_reason)
      values($1,$2,1000,'q_lounge_order',$1,'{}','2026-10-02T07:00:00Z','2026-10-02T07:30:00Z','EXPIRED')`,[makeOrder(91),'c'.repeat(64)]);
    await pg.query(`insert into qclub_private.payment_intents(order_id,receipt_hash,amount_paise,record_type,record_key,payload,expires_at)
      values('booking_old',$1,1000,'booking_request','booking_old','{}','2026-10-02T07:00:00Z')`,['d'.repeat(64)]);

    const capped=(await pg.query("select public.qclub_payment_stale_intents($1,99) as rows",[now])).rows[0].rows;
    assert.equal(capped.length,20);
    assert.ok(capped.every(x=>/^qcr_/.test(x.order_id)));
    const five=(await pg.query("select public.qclub_payment_stale_intents($1,5) as rows",[now])).rows[0].rows;
    assert.equal(five.length,5);
  }finally{await fixture.close();}
});

test('reconcile HTTP action remains disabled without rehearsal configuration',async()=>{
  const {default:handler}=await import('../api/qclub-payment-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method:'POST',url:'/api/qclub-payment-rehearsal?action=reconcile',query:{action:'reconcile'},headers:{'x-qclub-reconcile-secret':'x'.repeat(32)},async *[Symbol.asyncIterator](){}},response);
  assert.equal(response.code,503);
  assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
