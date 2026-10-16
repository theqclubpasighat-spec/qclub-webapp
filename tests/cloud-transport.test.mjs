import test from 'node:test';
import assert from 'node:assert/strict';
import { writeState } from '../src/cloud.js';

const revision='2026-10-16T09:00:00.123456+00:00';
function fixture(t, {token='fixture-session', current={}, response={ok:true,updatedAt:revision},status=200}={}) {
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  calls.push({url,...options});
  return options.method==='PATCH'
   ? {ok:status===200,status,json:async()=>response}
   : {ok:true,status:200,json:async()=>({state:current,updatedAt:revision})};
 });
 const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>token}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'sessionStorage',original);else delete globalThis.sessionStorage;});
 return calls;
}
test('cloud save rejects missing session or revision before making a request',async t=>{
 const calls=fixture(t,{token:''});
 await assert.rejects(writeState({club:{}}),/Secure session required/);
 assert.equal(calls.length,0);
 globalThis.sessionStorage.getItem=()=> 'fixture-session';
 await assert.rejects(writeState({club:{}}),/missing cloud revision/);
 assert.equal(calls.length,0);
});
test('cloud patch keeps exact revision and excludes server-owned data and rotated signed links',async t=>{
 const path='job-applications/photos/fixture.png';
 const current={club:{name:'Old'},jobApplications:[{id:'app',photo:{path,url:'https://private/new',bucket:'qclub-applicant-documents'}}]};
 const calls=fixture(t,{current});
 await writeState({__cloudUpdatedAt:revision,club:{name:'New'},jobApplications:[{id:'app',photo:{path,url:'https://private/old'}}],admin:{pin:'never-send'},paymentOrders:[{id:'never-send'}],whatsappPersistence:{secret:'never-send'}});
 assert.equal(calls.length,2);
 assert.equal(calls[1].headers.Authorization,'Bearer fixture-session');
 assert.equal(calls[1].cache,'no-store');
 assert.deepEqual(JSON.parse(calls[1].body),{baseUpdatedAt:revision,patch:{club:{name:'New'}}});
});
test('unchanged cloud content does not trigger a write',async t=>{
 const calls=fixture(t,{current:{club:{name:'Same'}}});
 await writeState({__cloudUpdatedAt:revision,club:{name:'Same'}});
 assert.equal(calls.length,1);
 assert.equal(calls[0].method,undefined);
});
test('revision conflict is surfaced without retrying or replacing the original revision',async t=>{
 const calls=fixture(t,{current:{club:{name:'Other admin'}},status:409,response:{error:'STATE_CONFLICT'}});
 const stale='2026-10-15T00:00:00.000001+00:00';
 await assert.rejects(writeState({__cloudUpdatedAt:stale,club:{name:'My draft'}}),/STATE_CONFLICT/);
 assert.equal(calls.length,2);
 assert.equal(JSON.parse(calls[1].body).baseUpdatedAt,stale);
});
