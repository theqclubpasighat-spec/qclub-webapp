import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFixtureDatabase} from './support/rehearsal-db.mjs';
import {prepareSubscription,sandboxSubscriptions,syncSubscription,subscriptionWebhook} from '../src/server/payments/membership-autopay.js';

const id='12345678-1234-4321-8123-123456789abc';
const cmd={id,token:'a'.repeat(64),name:'Fixture',phone:'9876543210',email:'fixture@example.test',tierId:'bronze',amount:1};
const state={memberships:[{id:'bronze',tier:'Bronze',price:799}],memberRegistry:[{mobile:cmd.phone,validUntil:'2027-01-30'}]};
const sub=prepareSubscription(state,cmd,Date.parse('2027-01-01'));
const remote={subscription_id:'qcsub_'+id,subscription_status:'ACTIVE',plan_details:{plan_type:'PERIODIC',plan_recurring_amount:799,plan_interval_type:'MONTH',plan_intervals:1,plan_max_amount:799,plan_currency:'INR'}};
const env={QCLUB_REHEARSAL_PUBLIC_URL:'https://preview.example.test',QCLUB_REHEARSAL_CASHFREE_ID:'test',QCLUB_REHEARSAL_CASHFREE_SECRET:'test-secret'};
test('price comes from catalogue and first collection follows paid coverage',()=>{
  assert.equal(sub.amount,799);assert.equal(sub.first_date,'2027-01-31');
  assert.throws(()=>prepareSubscription({...state,memberRegistry:[...state.memberRegistry,...state.memberRegistry]},cmd));
});
test('sandbox uses a refundable auth, scheduled periodic fee, and stable retry key',async()=>{
  const calls=[];const gateway=sandboxSubscriptions(env,async(url,options)=>{calls.push({url,options});return Response.json(remote);});
  await gateway(sub,'create');await gateway(sub,'create');await gateway(sub,'cancel');
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.authorization_details.authorization_amount_refund,true);
  assert.equal(body.plan_details.plan_interval_type,'MONTH');assert.equal(body.plan_details.plan_amount,799);
  assert.equal(calls[0].options.headers['x-idempotency-key'],calls[1].options.headers['x-idempotency-key']);
  assert.match(calls[2].url,/^https:\/\/sandbox.cashfree.com\/pg\/subscriptions\/qcsub_.*\/manage$/);
  assert.equal(JSON.parse(calls[2].options.body).action,'CANCEL');
  assert.throws(()=>sandboxSubscriptions({...env,VERCEL_ENV:'production'}));
});
test('forged notification is rejected before database or gateway access',async()=>{
  await assert.rejects(subscriptionWebhook(null,env,'{}',{}),/INVALID_WEBHOOK_SIGNATURE/);
});
test('auth and failed debits grant nothing; mismatched fee fails closed',async()=>{
  const db={rpc(){assert.fail('unexpected fulfilment');},from(){return {update(){return this;},eq(){return this;},select(){return this;},maybeSingle(){return {data:{paid_until:null}};}};}};
  const payments=[{payment_type:'AUTH',payment_status:'SUCCESS',payment_amount:1},{payment_type:'CHARGE',payment_status:'FAILED'}];
  const gateway=async(_,action)=>action==='status'?remote:payments;
  const result=await syncSubscription(db,gateway,sub);assert.equal(result.paidUntil,null);assert.equal(result.failed,true);
  payments.push({payment_type:'CHARGE',payment_status:'SUCCESS',payment_amount:1});
  await assert.rejects(syncSubscription(db,gateway,sub),/PAYMENT_MISMATCH/);
});
test('atomic renewal protects month-end, duplicate callbacks, and out-of-order charges',async()=>{
  const {pg,close}=await createFixtureDatabase();
  try{
    await pg.exec('reset role');
    await pg.exec(await readFile(new URL('../scripts/rehearsal/membership-autopay.sql',import.meta.url),'utf8'));
    await pg.exec('set role service_role');
    await pg.query('insert into public.qclub_autopay(id,owner_hash,tier_id,tier,amount,name,phone,email,first_date) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id,sub.owner_hash,sub.tier_id,sub.tier,sub.amount,sub.name,sub.phone,sub.email,sub.first_date]);
    const pay=(payment,cycle,amount=799)=>pg.query('select public.qclub_autopay_paid($1,$2,$3,$4)',[id,payment,cycle,amount]);
    await pay('renewal','2027-02-28');await pay('first','2027-01-31');await pay('first','2027-01-31');
    await assert.rejects(pay('second-id-same-cycle','2027-01-31'));
    await assert.rejects(pay('incorrect-fee','2027-03-31',1));
    const data=await pg.query("select state->'memberRegistry' as members from public.qclub_state where key='main'");
    assert.equal(data.rows[0].members.length,1);assert.equal(data.rows[0].members[0].validUntil,'2027-03-30');
    assert.equal((await pg.query('select count(*)::int as n from public.qclub_autopay_receipts')).rows[0].n,2);
    await pg.exec('reset role;set role anon');
    await assert.rejects(pg.query('select * from public.qclub_autopay'));
  }finally{await close();}
});
