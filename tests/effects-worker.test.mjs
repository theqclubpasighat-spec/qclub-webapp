import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeEffectWorker,
  effectWorkerCommand,
  dispatchWhatsappEffect,
  whatsappEffectMessage,
} from '../src/server/payments/effects.js';

const secret='rehearsal-effect-secret-1234567890';

test('effect worker authorization requires the exact configured high-entropy secret',()=>{
  assert.equal(authorizeEffectWorker({headers:{'x-qclub-effect-secret':secret}},{QCLUB_REHEARSAL_EFFECT_SECRET:secret}),true);
  assert.equal(authorizeEffectWorker({headers:{'x-qclub-effect-secret':'wrong'}},{QCLUB_REHEARSAL_EFFECT_SECRET:secret}),false);
  assert.equal(authorizeEffectWorker({headers:{'x-qclub-effect-secret':'short'}},{QCLUB_REHEARSAL_EFFECT_SECRET:'short'}),false);
});

test('effect worker command exposes only claim and complete operations',async()=>{
  const calls=[];
  const db={async rpc(name,args){calls.push({name,args});if(name==='qclub_payment_effect_claim')return {data:{ok:true,job:{id:'00000000-0000-4000-8000-000000000001',orderId:'qcr_x',effectType:'print_food',payload:{},attempts:1}}};return {data:{ok:true,status:'sent'}};}};
  const claimed=await effectWorkerCommand(db,{command:'claim',effectType:'print_food',workerId:'android-printer'});
  assert.equal(claimed.job.effectType,'print_food');
  assert.deepEqual(calls[0],{name:'qclub_payment_effect_claim',args:{p_effect_type:'print_food',p_worker_id:'android-printer'}});
  const completed=await effectWorkerCommand(db,{command:'complete',id:'00000000-0000-4000-8000-000000000001',workerId:'android-printer',success:true});
  assert.equal(completed.status,'sent');
  assert.equal(calls[1].name,'qclub_payment_effect_complete');
  for(const body of [
    {command:'claim',effectType:'unknown',workerId:'x'},
    {command:'complete',id:'bad',workerId:'x',success:true},
    {command:'anything'},
  ]) await assert.rejects(effectWorkerCommand(db,body),e=>e.code==='INVALID_EFFECT_COMMAND');
});

test('WhatsApp effect formatting uses approved message shapes without trusting arbitrary params',()=>{
  const membership=whatsappEffectMessage({payload:{label:'membership_success',phone:'9876543210',amount:799,data:{customerName:'Member',tier:'Bronze',activatedAt:'2026-10-02T09:30:00Z',validUntil:'2026-11-02'}}});
  assert.equal(membership.label,'membership_success');
  assert.equal(membership.params[0],'Member');
  assert.equal(membership.params[1],'Bronze');
  assert.equal(membership.params[3],'2026-11-02');
  const tournament=whatsappEffectMessage({payload:{label:'tournament_success',phone:'9876543210',amount:500,data:{customerName:'Player',tournamentName:'Current Cup',tournamentFee:500}}});
  assert.deepEqual(tournament.params,['Player','Current Cup','500']);
});

test('MSG91 dispatch is disabled by default and does not claim a queued message',async()=>{
  let calls=0;
  const db={rpc(){calls++;}};
  await assert.rejects(dispatchWhatsappEffect(db,{}),e=>e.code==='REHEARSAL_MSG91_LIVE_DISABLED');
  assert.equal(calls,0);
});

test('explicit rehearsal live MSG91 dispatch claims, sends fixed endpoint request and acknowledges success',async()=>{
  const calls=[];
  const job={
    id:'00000000-0000-4000-8000-000000000002',
    orderId:'qct_12345678-1234-4123-8123-123456789abc',
    effectType:'whatsapp_success',
    payload:{label:'tournament_success',phone:'9876543210',amount:500,data:{customerName:'Player',tournamentName:'Current Cup',tournamentFee:500}},
    attempts:1,
  };
  const db={async rpc(name,args){calls.push({name,args});if(name==='qclub_payment_effect_claim')return {data:{ok:true,job}};return {data:{ok:true,status:'sent'}};}};
  let request;
  const fetcher=async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return {ok:true,status:200,text:async()=>''};};
  const env={
    QCLUB_REHEARSAL_MSG91_MODE:'live',
    MSG91_AUTH_KEY:'fixture-auth',
    MSG91_SENDER_NUMBER:'919999999999',
    MSG91_TOURNAMENT_SUCCESS_TEMPLATE:'tournament_success_fixture',
  };
  const result=await dispatchWhatsappEffect(db,env,fetcher);
  assert.equal(result.job.id,job.id);
  assert.equal(request.url,'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/');
  assert.equal(request.options.headers.authkey,'fixture-auth');
  assert.equal(request.body.payload.to,'919876543210');
  assert.equal(request.body.payload.template.name,'tournament_success_fixture');
  assert.deepEqual(request.body.payload.template.components[0].parameters.map(x=>x.text),['Player','Current Cup','500']);
  assert.equal(calls.at(-1).name,'qclub_payment_effect_complete');
  assert.equal(calls.at(-1).args.p_success,true);
});

test('failed MSG91 dispatch requeues the claimed effect instead of changing payment fulfilment',async()=>{
  const calls=[];
  const job={
    id:'00000000-0000-4000-8000-000000000003',
    orderId:'qcr_12345678-1234-4123-8123-123456789abc',
    effectType:'whatsapp_success',
    payload:{label:'food_success',phone:'9876543210',amount:160,data:{customerName:'Customer',orderNo:'QC-1'}},
    attempts:1,
  };
  const db={async rpc(name,args){calls.push({name,args});if(name==='qclub_payment_effect_claim')return {data:{ok:true,job}};return {data:{ok:true,status:'pending'}};}};
  const env={
    QCLUB_REHEARSAL_MSG91_MODE:'live',
    MSG91_AUTH_KEY:'fixture-auth',
    MSG91_SENDER_NUMBER:'919999999999',
    MSG91_FOOD_SUCCESS_TEMPLATE:'food_success_fixture',
  };
  await assert.rejects(dispatchWhatsappEffect(db,env,async()=>({ok:false,status:503,text:async()=>'upstream unavailable'})),e=>e.code==='MSG91_SEND_FAILED');
  const completion=calls.find(x=>x.name==='qclub_payment_effect_complete');
  assert.equal(completion.args.p_success,false);
  assert.match(completion.args.p_error,/upstream unavailable/);
});

test('HTTP effect actions remain disabled without rehearsal configuration',async()=>{
  const {default:handler}=await import('../api/qclub-payment-rehearsal.js');
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  const req={method:'POST',url:'/api/qclub-payment-rehearsal?action=effects',query:{action:'effects'},headers:{},body:undefined,async *[Symbol.asyncIterator](){yield Buffer.from('{}');}};
  await handler(req,response);
  assert.equal(response.code,503);
  assert.equal(response.body.error,'SECURITY_REHEARSAL_DISABLED');
});
