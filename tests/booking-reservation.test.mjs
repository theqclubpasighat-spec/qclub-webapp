import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBookingCheckout,bookingCheckoutRequest } from '../src/server/payments/booking.js';
import { fulfillPayment } from '../src/server/payments/fulfillment.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const token='b'.repeat(43);
const ymd=(days=1)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const command=(prefix='1',overrides={})=>({
  checkoutId:`${prefix}2345678-1234-4123-8123-123456789abc`,
  receiptToken:token,
  itemId:'table1',
  bookingDate:ymd(1),
  startTime:'12:00',
  durationHours:2,
  bookingType:'nonmember',
  customer:{name:'Booking Fixture',phone:'9876543210'},
  note:'Window seat if possible',
  ...overrides,
});

async function bookingFixture(statePatch={}){
  const fixture=await createFixtureDatabase(),pg=fixture.pg;
  await pg.exec(`reset role;
    create table public.qclub_operational_records(
      id uuid primary key default gen_random_uuid(),
      record_type text not null,
      record_key text not null,
      payload jsonb not null default '{}',
      source text not null default 'webapp',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz,
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
    '20261002_stale_payment_reconciliation_rehearsal.sql',
    '20261002_booking_slot_reservations_rehearsal.sql'
  ]) await pg.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));

  const date=ymd(1);
  const state={
    club:{name:'The Q Club'},
    booking:{
      tables:[
        {id:'table1',label:'Liberwin',pricePerHour:400,memberPricePerHour:300},
        {id:'table2',label:'Wiraka 777',pricePerHour:400,memberPricePerHour:300},
      ],
      blockedSlots:[],
      requests:[],
    },
    memberRegistry:[
      {id:'m1',name:'Fixture Member',mobile:'9876543210',status:'active',validUntil:ymd(30),tier:'Gold'}
    ],
    ...statePatch,
  };
  await pg.query("update public.qclub_state set state=$1,updated_at=now() where key='main'",[JSON.stringify(state)]);
  await pg.exec('set role service_role');

  const specs={
    qclub_booking_checkout:['p_order_id','p_receipt_hash','p_request_hash','p_item_id','p_booking_date','p_start_time','p_duration_hours','p_booking_type','p_customer_name','p_customer_phone','p_note'],
    qclub_payment_intent:['p_order_id','p_receipt_hash'],
    qclub_payment_fulfill:['p_order_id','p_receipt_hash','p_amount_paise','p_currency','p_payment_id'],
    qclub_payment_close_terminal_service:['p_order_id','p_reason'],
    qclub_payment_stale_intents:['p_before','p_limit'],
  };
  const db={async rpc(name,args){try{
    const values=specs[name].map(k=>args[k]);
    const result=await pg.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values);
    return {data:result.rows[0].result};
  }catch(error){return {error};}}};
  return {...fixture,db,date};
}

const activeGateway={async create(order){return {
  order_id:order.orderId,order_currency:'INR',order_amount:order.amountPaise/100,
  order_status:'ACTIVE',payment_session_id:'booking_fixture'
};}};

test('booking command accepts only frozen server inputs',()=>{
  const parsed=bookingCheckoutRequest(command());
  assert.match(parsed.orderId,/^qcb_/);
  assert.equal(parsed.note,'Window seat if possible');
  for(const body of [
    {...command(),amount:1},
    {...command(),bookingType:'vip'},
    {...command(),durationHours:6},
    {...command(),startTime:'12:10'},
    {...command(),customer:{name:'X',phone:'123'}},
  ]) assert.throws(()=>bookingCheckoutRequest(body),e=>e.code==='INVALID_BOOKING');
});

test('server-priced booking hold blocks overlapping checkouts but permits an adjacent slot',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await bookingFixture(),{pg,db}=fixture;
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await pg.query(`select has_table_privilege('${role}','qclub_private.booking_slot_reservations','SELECT,INSERT,UPDATE,DELETE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.qclub_booking_checkout(text,text,text,text,date,text,integer,text,text,text,text)','EXECUTE') as allowed`)).rows[0].allowed,false);
      assert.equal((await pg.query(`select has_function_privilege('${role}','qclub_private.booking_time_minutes(text)','EXECUTE') as allowed`)).rows[0].allowed,false);
    }
    assert.equal((await pg.query("select has_function_privilege('service_role','qclub_private.booking_time_minutes(text)','EXECUTE') as allowed")).rows[0].allowed,true);
        const first=await createBookingCheckout(db,activeGateway,command('1'));
    assert.equal(first.state,'ready');assert.equal(first.amountPaise,80000);
    const hold=(await pg.query("select * from qclub_private.booking_slot_reservations where order_id=$1",[first.orderId])).rows[0];
    assert.equal(hold.start_minutes,720);assert.equal(hold.end_minutes,840);assert.equal(hold.status,'reserved');

    let calls=0;
    await assert.rejects(createBookingCheckout(db,{create(){calls++;}},command('2',{startTime:'13:00',durationHours:1})),e=>e.code==='SLOT_UNAVAILABLE');
    assert.equal(calls,0);

    const adjacent=await createBookingCheckout(db,activeGateway,command('3',{startTime:'14:00',durationHours:1}));
    assert.equal(adjacent.amountPaise,40000);
  }finally{await fixture.close();}
});

test('blocked, legacy active and operational booking windows are enforced server-side',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const date=ymd(1);
  const fixture=await bookingFixture({
    club:{name:'The Q Club'},
    booking:{
      tables:[{id:'table1',label:'Liberwin',pricePerHour:400,memberPricePerHour:300}],
      blockedSlots:[{id:'b1',itemId:'table1',bookingDate:date,timeSlot:'15:00 to 16:00',durationHours:1}],
      requests:[{id:'r1',itemId:'table1',bookingDate:date,timeSlot:'17:00',durationHours:2,endTime:'19:00',status:'pending'}],
    },
    memberRegistry:[{id:'m1',name:'Fixture Member',mobile:'9876543210',status:'active',validUntil:ymd(30)}],
  });
  const {pg,db}=fixture;
  try{
    await pg.query(`insert into public.qclub_operational_records(record_type,record_key,payload,source,status)
      values('booking_request','paid-existing',$1,'fixture','paid_verified')`,[
      JSON.stringify({itemId:'table1',bookingDate:date,timeSlot:'20:00',durationHours:1,endTime:'21:00',status:'paid_verified'})
    ]);
    for(const [prefix,start] of [['4','15:00'],['5','17:30'],['6','20:00']]){
      await assert.rejects(createBookingCheckout(db,activeGateway,command(prefix,{bookingDate:date,startTime:start,durationHours:1})),e=>e.code==='SLOT_UNAVAILABLE');
    }
    assert.equal((await pg.query("select count(*)::int as n from qclub_private.booking_slot_reservations")).rows[0].n,0);
  }finally{await fixture.close();}
});

test('member rate requires active registry name and mobile match valid on booking date',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await bookingFixture(),{db}=fixture;
  try{
    const member=await createBookingCheckout(db,activeGateway,command('7',{
      bookingType:'member',customer:{name:'Fixture Member',phone:'9876543210'},durationHours:2
    }));
    assert.equal(member.amountPaise,60000);
    await assert.rejects(createBookingCheckout(db,activeGateway,command('8',{
      bookingType:'member',customer:{name:'Fixture Member',phone:'9876543211'},startTime:'15:00',durationHours:1
    })),e=>e.code==='MEMBER_VERIFICATION_REQUIRED');
  }finally{await fixture.close();}
});

test('Cashfree terminal state releases a booking hold; paid booking remains unavailable',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await bookingFixture(),{pg,db}=fixture;
  try{
    const first=await createBookingCheckout(db,activeGateway,command('9'));
    const expired={verify:async id=>({order_id:id,order_currency:'INR',order_amount:800,order_status:'EXPIRED',payments:[]})};
    assert.equal((await fulfillPayment(db,expired,{orderId:first.orderId,receiptToken:token})).state,'expired');
    assert.equal((await pg.query("select status from qclub_private.booking_slot_reservations where order_id=$1",[first.orderId])).rows[0].status,'released');

    const replacement=await createBookingCheckout(db,activeGateway,command('a'));
    const paid={verify:async id=>({order_id:id,order_currency:'INR',order_amount:800,order_status:'PAID',payments:[{order_id:id,payment_currency:'INR',payment_amount:800,payment_status:'SUCCESS',cf_payment_id:'booking_payment_1'}]})};
    assert.equal((await fulfillPayment(db,paid,{orderId:replacement.orderId,receiptToken:token})).state,'fulfilled');
    assert.equal((await pg.query("select status from qclub_private.booking_slot_reservations where order_id=$1",[replacement.orderId])).rows[0].status,'fulfilled');
    assert.equal((await pg.query("select status from public.qclub_operational_records where record_type='booking_request' and record_key=$1",[replacement.orderId])).rows[0].status,'paid_verified');

    await assert.rejects(createBookingCheckout(db,activeGateway,command('b')),e=>e.code==='SLOT_UNAVAILABLE');
  }finally{await fixture.close();}
});

test('stale discovery includes expired qcb booking holds for the same trusted reconciler',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await bookingFixture(),{pg,db}=fixture;
  try{
    const ready=await createBookingCheckout(db,activeGateway,command('c'));
    // Payment terms are immutable by design. Move the trusted reconciliation cutoff
    // beyond the frozen one-hour expiry rather than mutating expires_at in the fixture.
    const cutoff=new Date(Date.now()+2*60*60*1000).toISOString();
    const rows=(await db.rpc('qclub_payment_stale_intents',{p_before:cutoff,p_limit:10})).data;
    assert.equal(rows.some(row=>row.order_id===ready.orderId),true);
  }finally{await fixture.close();}
});

test('booking HTTP action remains disabled without rehearsal configuration',async()=>{
  const {default:handler}=await import('../api/qclub-checkout-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method:'POST',url:'/api/qclub-checkout-rehearsal?action=booking',query:{action:'booking'},headers:{},body:command(),socket:{remoteAddress:'127.0.0.1'}},response);
  assert.equal(response.code,503);assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
