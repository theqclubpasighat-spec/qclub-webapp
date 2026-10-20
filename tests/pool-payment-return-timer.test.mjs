import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';

const server=fs.readFileSync(new URL('../src/server/snooker-v1.js',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../src/components/table-customer-page.jsx',import.meta.url),'utf8');
const pay=fs.readFileSync(new URL('../src/components/qclub-pay-page.jsx',import.meta.url),'utf8');
test('Pool checkout returns to signed Ledger status, not legacy order lookup',()=>{
  const claim=server.slice(server.indexOf('async function claimPoolQrSession'),server.indexOf('async function createPublicTableRequest'));
  assert.match(claim,/return_url: paymentLinkUrl\(\{ id: paymentId, bill_id: bill.id, expires_at: expiry \}\)/);
  assert.doesNotMatch(claim,/return_url:.*payment-status/);
  assert.match(pay,/pending && !returnedFromCheckout/);
  assert.match(pay,/do not pay again/);
});
test('Return signature accepts ISO expiry while retaining legacy signature verification',()=>{
  const body=server.slice(server.indexOf('function paymentLinkSignature('),server.indexOf('function paymentLinkUrl('));
  const context={createHmac,paymentLinkSecret:()=> 'test-only-secret'};
  vm.createContext(context);vm.runInContext(body,context);
  const payment={id:'p1',bill_id:'b1',expires_at:'2026-10-20T10:00:00.000Z'};
  const sig=context.paymentLinkSignature(payment);
  const db={...payment,expires_at:'2026-10-20T10:00:00+00:00'};
  assert.equal(sig,context.paymentLinkSignature({...db,expires_at:new Date(db.expires_at).toISOString()}));
  assert.notEqual(sig,context.paymentLinkSignature({...payment,id:'p2'}));
  assert.match(server,/secureEqual\(signature, paymentLinkSignature\(data\)\)/);
});
test('Display ticks between polls, preserves free allowance, freezes ended sessions',()=>{
  const expression=page.match(/const displayedSeconds=([\s\S]*?);\n/)[1];
  const seconds=(session,now)=>vm.runInNewContext(expression,{displayedSession:session,clockNow:now});
  const session={status:'ACTIVE',timer_running:true,elapsed_seconds:226,setup_allowance_seconds:180,received_at:1000};
  assert.deepEqual([1000,2000,3000,4000].map(now=>Math.floor(seconds(session,now))),[46,47,48,49]);
  assert.equal(seconds({...session,elapsed_seconds:0},1000),-180);
  assert.equal(seconds({...session,elapsed_seconds:0},181000),0);
  for(const status of ['PAUSED','ENDED','FINALIZED'])assert.equal(seconds({...session,status},9000),46);
  assert.equal(seconds({...session,timer_running:false},9000),46);
  assert.match(page,/setInterval\(\(\)=>setClockNow\(performance.now\(\)\),200\)/);
});
