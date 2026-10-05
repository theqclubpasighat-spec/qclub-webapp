import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteLegacyOrder} from '../src/server/payments/legacy-quote.js';
import {applyLegacyFulfillment,fulfillLegacyOrder} from '../src/server/payments/legacy-fulfillment.js';
import {mutateLegacyState} from '../src/server/payments/legacy-state.js';
import {createFixtureDatabase} from './support/rehearsal-db.mjs';

const fixture=()=>({admin:{mainPin:'fixture-secret'},club:{name:'Original'},menuCatalog:{snacks:{items:[{id:'food1',name:'Snack',price:80,inStock:true}]}},shopCatalog:{items:[{id:'shop1',name:'Tip',price:100,stock:5}]},memberships:[{tier:'Gold',price:1499}],memberRegistry:[],membersPage:[],players:[],tournaments:[{id:'tour1',name:'Cup',registrationFee:99,participantIds:[]}],booking:{tables:[{id:'T1',label:'Liberwin',pricePerHour:600,memberPricePerHour:500}],requests:[]}});
const record=context=>({order_id:'order_fixture_'+context,context,expectedAmount:context==='food'?160:100,customer_name:'Fixture',customer_phone:'9000000000',order_tags:{food_items_json:JSON.stringify([{id:'food1',name:'Snack',qty:2,price:80,lineTotal:160}]),shop_items_json:JSON.stringify([{itemId:'shop1',name:'Tip',qty:1,price:100,lineTotal:100}]),tier:'Gold',tournament_id:'tour1',booking_item_id:'T1',booking_date:'2026-10-10',booking_time_slot:'13:00',booking_duration_hours:'1'}});

test('catalogue prices replace browser line prices and reject underpayment and unavailable stock',()=>{
 const state=fixture(),tags={context:'food',food_items_json:JSON.stringify([{id:'food1',qty:2,price:1}])};
 assert.throws(()=>quoteLegacyOrder(state,tags,{},2),/PRICE_CHANGED/);
 const quote=quoteLegacyOrder(state,tags,{},160);assert.equal(JSON.parse(quote.tags.food_items_json)[0].price,80);
 assert.throws(()=>quoteLegacyOrder(state,{context:'shop',shop_items_json:JSON.stringify([{itemId:'shop1',qty:3},{itemId:'shop1',qty:3}])},{},600),/OUT_OF_STOCK/);
 assert.throws(()=>quoteLegacyOrder(state,{context:'shop',shop_items_json:JSON.stringify([{itemId:'shop1',qty:-1}])},{},100),/INVALID_QUANTITY/);
 assert.throws(()=>quoteLegacyOrder(state,{context:'membership',tier:'Gold'},{},1),/PRICE_CHANGED/);
 assert.throws(()=>quoteLegacyOrder(state,{context:'tournament',tournament_id:'tour1'},{},1),/PRICE_CHANGED/);
 assert.throws(()=>quoteLegacyOrder(state,{context:'booking',booking_item_id:'T1',booking_duration_hours:'1',booking_type:'member'},{name:'Fixture',phone:'9000000000'},500),/MEMBERSHIP_VERIFICATION_REQUIRED/);
});

for(const context of ['food','shop','booking','membership','tournament'])test(`${context} effects are atomic-state transitions and idempotent`,()=>{
 const state=fixture(),payment=record(context);state.paymentOrders=[payment];
 applyLegacyFulfillment(state,payment,'2026-10-05T06:00:00Z');
 const once=structuredClone(state);applyLegacyFulfillment(state,payment,'2026-10-06T06:00:00Z');assert.deepEqual(state,once);
 assert.equal(payment.fulfilled,true);assert.equal(state.admin.mainPin,'fixture-secret');assert.equal(state.speakerAlerts.length,1);
 if(context==='shop'){assert.equal(state.shopCatalog.items[0].stock,4);assert.equal(state.shopReceipts.length,1);}
 if(context==='food'){assert.equal(state.foodOrders.length,1);assert.equal(state.foodOrders[0].printMeta.status,'pending_auto_print');}
 if(context==='booking')assert.equal(state.booking.requests[0].status,'verified');
 if(context==='membership'){assert.equal(state.memberRegistry.length,1);assert.equal(state.memberRegistry[0].validUntil,'2026-11-05');}
 if(context==='tournament')assert.equal(state.tournaments[0].participantIds.length,1);
});

test('legacy browser-completed membership is not issued twice',()=>{
 const state=fixture(),payment={...record('membership'),fulfilled:true,fulfillmentCompletionType:'client_acknowledged'};
 applyLegacyFulfillment(state,payment);assert.equal(state.memberRegistry.length,0);
});

test('real database concurrent callbacks preserve staff edits and deduct stock once',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
 const {pg,db}=await createFixtureDatabase();
 try{
  const state=fixture(),payment=record('shop');state.paymentOrders=[payment];
  await pg.query("update public.qclub_state set state=$1 where key='main'",[JSON.stringify(state)]);
  const verify=async order_id=>({order_id,order_status:'PAID',order_currency:'INR',order_amount:100});
  await Promise.all([fulfillLegacyOrder(db,payment.order_id,verify),fulfillLegacyOrder(db,payment.order_id,verify),mutateLegacyState(db,state=>{state.club.name='Staff edited';})]);
  const saved=(await pg.query("select state from public.qclub_state where key='main'")).rows[0].state;
  assert.equal(saved.club.name,'Staff edited');assert.equal(saved.shopCatalog.items[0].stock,4);assert.equal(saved.shopReceipts.length,1);assert.equal(saved.speakerAlerts.length,1);
  await assert.rejects(fulfillLegacyOrder(db,payment.order_id,async()=>({order_id:payment.order_id,order_status:'ACTIVE',order_currency:'INR',order_amount:100})),/PAYMENT_NOT_VERIFIED/);
 }finally{await pg.close();}
});
