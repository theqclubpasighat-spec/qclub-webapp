import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { closeUnusedCheckout } from '../src/server/payments/checkout-recovery.js';
import { createFoodCheckout } from '../src/server/payments/checkout.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';
const command=(prefix='1')=>({checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,receiptToken:'a'.repeat(43)});
const cart=identity=>({...identity,items:[{itemId:'momo',quantity:2}],customer:{name:'Fixture',phone:'9876543210'}});

test('recovery accepts only the checkout identity and receipt capability',async()=>{
 let calls=0;const db={rpc(){calls++;throw Error('unexpected');}};
 for(const body of [null,[],{...command(),paid:true},{...command(),receiptToken:'short'},{...command(),checkoutId:'invalid'}]) {
  await assert.rejects(closeUnusedCheckout(db,body),e=>e.code==='INVALID_CHECKOUT');
 }
 assert.equal(calls,0);
});

test('Postgres recovery closes only unused IDs and blocks delayed creation without losing existing orders',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
 const fixture=await createFixtureDatabase(),pg=fixture.pg;
 try{
  await pg.exec(`reset role;
   create table public.qclub_operational_records(id uuid primary key default gen_random_uuid(),record_type text not null,record_key text not null,payload jsonb not null,source text not null,status text not null,updated_at timestamptz,unique(record_type,record_key));
   create table public.qclub_fnb_categories(category_key text primary key,active boolean not null);
   create table public.snooker_catalogue_items(id text primary key,name text,qlounge_category_key text,active boolean,show_on_qlounge boolean,online_order_enabled boolean,track_inventory boolean,selling_price_inr numeric);
   insert into public.qclub_fnb_categories values('food',true);
   insert into public.snooker_catalogue_items values('momo','Momo','food',true,true,true,false,80);
   grant select,insert,update on public.qclub_operational_records,public.snooker_catalogue_items,public.qclub_fnb_categories to service_role;`);
  for(const name of ['20260930113142_payment_fulfillment_rehearsal.sql','20260930113908_food_checkout_rehearsal.sql','20260930173033_checkout_recovery_rehearsal.sql'])await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  for(const role of ['anon','authenticated']){
   assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_close_unused_checkout(text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
   assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.closed_checkouts','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
  }
  assert.equal((await pg.query("select relrowsecurity from pg_class where oid='qclub_private.closed_checkouts'::regclass")).rows[0].relrowsecurity,true);
  await pg.exec('set role service_role');
  const db={async rpc(name,args){try{
   const names={qclub_food_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_items','p_customer_name','p_customer_phone'],qclub_close_unused_checkout:['p_order_id','p_receipt_hash']};
   if(!names[name])throw Error('Unknown RPC');
   const values=names[name].map(k=>k==='p_items'?JSON.stringify(args[k]):args[k]);
   return {data:(await pg.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values)).rows[0].result};
  }catch(error){return {error};}}};
  const sharedBefore=(await pg.query('select state from public.qclub_state')).rows;
  let gatewayCalls=0;
  const unexpectedGateway={async create(){gatewayCalls++;throw Error('must not create');}};
  // Closure wins. Repeating after a lost response is harmless; delayed creation cannot revive it.
  assert.equal((await closeUnusedCheckout(db,command())).state,'closed');
  assert.equal((await closeUnusedCheckout(db,command())).state,'closed');
  await assert.rejects(closeUnusedCheckout(db,{...command(),receiptToken:'b'.repeat(43)}),e=>e.code==='CHECKOUT_CONFLICT');
  await assert.rejects(createFoodCheckout(db,unexpectedGateway,cart(command())),e=>e.code==='CHECKOUT_CLOSED');
  assert.equal(gatewayCalls,0);
  assert.equal((await pg.query('select count(*)::int as n from qclub_private.closed_checkouts')).rows[0].n,1);
  // Creation wins. Hold the gateway response while recovery runs after the intent commits.
  let release,entered;
  const gatewayEntered=new Promise(resolve=>entered=resolve);
  const creating=createFoodCheckout(db,{create(order){entered();return new Promise(resolve=>release=()=>resolve({order_id:order.orderId,order_currency:'INR',order_amount:160,order_status:'ACTIVE',payment_session_id:'fixture'}));}},cart(command('2')));
  await gatewayEntered;
  assert.equal((await closeUnusedCheckout(db,command('2'))).state,'existing');
  release();assert.equal((await creating).state,'ready');
  const before=(await pg.query('select * from qclub_private.payment_intents')).rows;
  assert.equal((await closeUnusedCheckout(db,command('2'))).state,'existing');
  await assert.rejects(closeUnusedCheckout(db,{...command('2'),receiptToken:'b'.repeat(43)}),e=>e.code==='CHECKOUT_CONFLICT');
  assert.deepEqual((await pg.query('select * from qclub_private.payment_intents')).rows,before);
  // A lost gateway response still leaves a private order, so recovery must not release it.
  await assert.rejects(createFoodCheckout(db,{async create(){throw Error('lost response');}},cart(command('3'))),/lost response/);
  assert.equal((await closeUnusedCheckout(db,command('3'))).state,'existing');
  await pg.query(`insert into qclub_private.payment_intents(order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload,expires_at)
    select $1,receipt_hash,request_hash,amount_paise,record_type,$1,payload,clock_timestamp()-interval '1 day'
    from qclub_private.payment_intents where order_id=$2`,[`qcr_${command('4').checkoutId}`,`qcr_${command('2').checkoutId}`]);
  assert.equal((await closeUnusedCheckout(db,command('4'))).state,'existing');
  assert.equal((await pg.query('select count(*)::int as n from qclub_private.closed_checkouts')).rows[0].n,1);
  assert.deepEqual((await pg.query('select state from public.qclub_state')).rows,sharedBefore);
  await assert.rejects(pg.exec('delete from qclub_private.closed_checkouts'),/permission denied/);
 }finally{await fixture.close();}
});

test('recovery HTTP endpoint remains disabled without the rehearsal gate',async()=>{
 const {default:handler}=await import('../api/qclub-checkout-recovery-rehearsal.js');
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
 await handler({method:'POST',body:command()},res);
 assert.equal(res.code,503);assert.equal(res.body.error,'SECURITY_REHEARSAL_DISABLED');
});
