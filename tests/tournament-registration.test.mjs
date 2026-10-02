import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tournamentCheckoutRequest,createTournamentCheckout } from '../src/server/payments/tournament.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const token='t'.repeat(43);
const command=(prefix='1',overrides={})=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:token,
  tournamentId:'tour-current',
  playerId:'player-1',
  customer:{name:'Tournament Fixture',phone:'9876543210'},
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
  ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));

  const state={
    club:{name:'The Q Club'},
    players:[
      {id:'player-1',name:'Tournament Fixture',mobile:'9876543210'},
      {id:'player-2',name:'Other Player',mobile:'9123456789'},
    ],
    tournaments:[
      {id:'tour-current',name:'Current Cup',game:'snooker',isCurrent:true,registrationFee:500,participantIds:[]},
      {id:'tour-closed',name:'Closed Cup',game:'pool',isCurrent:false,registrationFee:300,participantIds:[]},
      {id:'tour-existing',name:'Existing Cup',game:'snooker',isCurrent:true,registrationFee:700,participantIds:['player-1']},
    ],
  };
  await pg.query("update public.qclub_state set state=$1,updated_at=now() where key='main'",[JSON.stringify(state)]);
  await pg.exec('set role service_role');

  const specs={
    qclub_tournament_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_tournament_id','p_player_id','p_customer_name','p_customer_phone'],
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
  order_status:'ACTIVE',payment_session_id:'tournament_fixture'
};}};

async function participants(pg,id='tour-current'){
  const state=(await pg.query("select state from public.qclub_state where key='main'")).rows[0].state;
  return state.tournaments.find(row=>row.id===id).participantIds||[];
}

test('tournament command accepts only checkout identity, tournament, existing player and customer identity',()=>{
  const parsed=tournamentCheckoutRequest(command());
  assert.match(parsed.orderId,/^qct_/);
  assert.equal(parsed.tournamentId,'tour-current');
  for(const body of [
    {...command(),amount:1},
    {...command(),registrationFee:1},
    {...command(),playerId:''},
    {...command(),tournamentId:''},
    {...command(),customer:{name:'X',phone:'123'}},
  ]) assert.throws(()=>tournamentCheckoutRequest(body),e=>e.code==='INVALID_TOURNAMENT_CHECKOUT');
});

test('tournament fee and player identity are server authoritative and duplicate registration is reserved',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.tournament_registration_reservations','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_tournament_checkout(text,text,text,text,text,text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
    const ready=await createTournamentCheckout(db,gateway,command('1'));
    assert.equal(ready.state,'ready');assert.equal(ready.amountPaise,50000);assert.equal(ready.tournamentName,'Current Cup');
    assert.deepEqual(await participants(pg),[]);
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.tournament_registration_reservations where order_id=$1 and status='reserved'",[ready.orderId])).rows[0].n,1);

    let calls=0;
    await assert.rejects(createTournamentCheckout(db,{create(){calls++;}},command('2')),e=>e.code==='REGISTRATION_ALREADY_RESERVED');
    await assert.rejects(createTournamentCheckout(db,{create(){calls++;}},command('3',{customer:{name:'Wrong',phone:'9988776655'}})),e=>e.code==='PLAYER_IDENTITY_MISMATCH');
    await assert.rejects(createTournamentCheckout(db,{create(){calls++;}},command('4',{tournamentId:'tour-closed'})),e=>e.code==='TOURNAMENT_NOT_OPEN');
    await assert.rejects(createTournamentCheckout(db,{create(){calls++;}},command('5',{tournamentId:'tour-existing'})),e=>e.code==='ALREADY_REGISTERED');
    assert.equal(calls,0);
  }finally{await f.close();}
});

test('paid tournament registration appends participant exactly once and writes paid operational record',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const ready=await createTournamentCheckout(db,gateway,command('6'));
    const paid={verify:async id=>({
      order_id:id,order_currency:'INR',order_amount:500,order_status:'PAID',
      payments:[{order_id:id,payment_currency:'INR',payment_amount:500,payment_status:'SUCCESS',cf_payment_id:'tournament_payment_1'}],
    })};
    assert.equal((await fulfillPayment(db,paid,{orderId:ready.orderId,receiptToken:token})).state,'fulfilled');
    assert.deepEqual(await participants(pg),['player-1']);
    assert.equal((await pg.query("select status from qclub_private.tournament_registration_reservations where order_id=$1",[ready.orderId])).rows[0].status,'fulfilled');
    const record=(await pg.query("select payload,status from public.qclub_operational_records where record_type='tournament_registration' and record_key=$1",[ready.orderId])).rows[0];
    assert.equal(record.status,'paid');assert.equal(record.payload.paymentStatus,'Paid');assert.equal(record.payload.tournamentName,'Current Cup');
    assert.equal((await fulfillPayment(db,{verify(){throw Error('must not reverify');}},{orderId:ready.orderId,receiptToken:token})).state,'fulfilled');
    assert.deepEqual(await participants(pg),['player-1']);
  }finally{await f.close();}
});

test('terminal tournament order releases registration hold and stale discovery includes qct namespace',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const f=await fixture(),{pg,db}=f;
  try{
    const ready=await createTournamentCheckout(db,gateway,command('7'));
    const cutoff=new Date(Date.now()+2*60*60*1000).toISOString();
    const rows=(await db.rpc('qclub_payment_stale_intents',{p_before:cutoff,p_limit:10})).data;
    assert.equal(rows.some(row=>row.order_id===ready.orderId),true);
    const expired={verify:async id=>({order_id:id,order_currency:'INR',order_amount:500,order_status:'EXPIRED',payments:[]})};
    assert.equal((await fulfillPayment(db,expired,{orderId:ready.orderId,receiptToken:token})).state,'expired');
    assert.equal((await pg.query("select status from qclub_private.tournament_registration_reservations where order_id=$1",[ready.orderId])).rows[0].status,'released');
    assert.deepEqual(await participants(pg),[]);
    const retry=await createTournamentCheckout(db,gateway,command('8'));
    assert.equal(retry.state,'ready');
  }finally{await f.close();}
});

test('tournament HTTP action remains disabled without rehearsal configuration',async()=>{
  const {default:handler}=await import('../api/qclub-checkout-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method:'POST',url:'/api/qclub-checkout-rehearsal?action=tournament',query:{action:'tournament'},headers:{},body:command(),socket:{remoteAddress:'127.0.0.1'}},response);
  assert.equal(response.code,503);assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
