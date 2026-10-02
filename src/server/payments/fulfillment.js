import { SecurityError } from '../security/errors.js';
import { tokenHash } from '../security/foundation.js';
const fail=(status,code)=>{throw new SecurityError(status,code);};

export function amountInPaise(value) {
  const text=String(value);
  if(!/^\d{1,7}(\.\d{1,2})?$/.test(text)) fail(422,'PAYMENT_MISMATCH');
  const [whole,part='']=text.split('.');
  const result=Number(whole)*100+Number(part.padEnd(2,'0'));
  if(!Number.isSafeInteger(result)||result<=0)fail(422,'PAYMENT_MISMATCH');
  return result;
}

function sameAmount(payment,intent){
  return payment?.order_id && payment.order_id===intent.orderId
    && payment.payment_currency==='INR'
    && amountInPaise(payment.payment_amount)===Number(intent.amount_paise);
}

async function verifiedEvidence(gateway,orderId,intent) {
  const evidence=await gateway.verify(orderId);
  if(evidence.order_id!==orderId || evidence.order_currency!=='INR' || amountInPaise(evidence.order_amount)!==Number(intent.amount_paise))fail(422,'PAYMENT_MISMATCH');
  const payments=Array.isArray(evidence.payments)?evidence.payments:[];
  const scoped={...intent,orderId};
  const success=payments.find(p=>p?.payment_status==='SUCCESS'&&p?.order_id===orderId);
  if(success){
    if(!sameAmount(success,scoped)||!/^[A-Za-z0-9_-]{1,100}$/.test(String(success.cf_payment_id||'')))fail(422,'PAYMENT_MISMATCH');
    return {evidence,payment:success,terminal:false,pending:false};
  }
  if(evidence.order_status==='PAID')fail(422,'PAYMENT_MISMATCH');
  const pending=payments.some(p=>p?.payment_status==='PENDING'&&p?.order_id===orderId);
  const terminal=!pending&&['EXPIRED','TERMINATED'].includes(String(evidence.order_status||'').toUpperCase());
  return {evidence,payment:null,terminal,pending:pending||['ACTIVE','TERMINATION_REQUESTED'].includes(String(evidence.order_status||'').toUpperCase())};
}

async function closeTerminal(db,orderId,reason){
  const result=await db.rpc('qclub_payment_close_terminal_service',{p_order_id:orderId,p_reason:reason});
  if(result.error)fail(503,'FULFILLMENT_UNAVAILABLE');
  if(!result.data?.ok)fail(result.data?.conflict?409:404,result.data?.conflict?'FULFILLMENT_CONFLICT':'ORDER_NOT_FOUND');
  return {ok:true,state:'expired',orderId,reason:result.data.terminal_reason||reason};
}

// Browser verification requires the private receipt capability.
export async function fulfillPayment(db,gateway,body) {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['orderId','receiptToken'].includes(k)) || typeof body.orderId!=='string' || typeof body.receiptToken!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.orderId||'') || !/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken||''))fail(400,'INVALID_PAYMENT_COMMAND');
  const args={p_order_id:body.orderId,p_receipt_hash:tokenHash(body.receiptToken)};
  const lookup=await db.rpc('qclub_payment_intent',args);
  if(lookup.error)fail(503,'PAYMENT_UNAVAILABLE');
  const intent=lookup.data;
  if(!intent)fail(404,'ORDER_NOT_FOUND');
  if(intent.status==='fulfilled')return {ok:true,state:'fulfilled',orderId:body.orderId};
  if(intent.terminal_at)return {ok:true,state:'expired',orderId:body.orderId,reason:intent.terminal_reason||'EXPIRED'};
  const proof=await verifiedEvidence(gateway,body.orderId,intent);
  if(proof.payment){
    const result=await db.rpc('qclub_payment_fulfill',{...args,p_amount_paise:Number(intent.amount_paise),p_currency:'INR',p_payment_id:String(proof.payment.cf_payment_id)});
    if(result.error)fail(503,'FULFILLMENT_UNAVAILABLE');
    if(!result.data?.ok)fail(result.data?.conflict?409:404,result.data?.conflict?'FULFILLMENT_CONFLICT':'ORDER_NOT_FOUND');
    return {ok:true,state:'fulfilled',orderId:body.orderId};
  }
  if(proof.terminal)return closeTerminal(db,body.orderId,String(proof.evidence.order_status).toUpperCase());
  return {ok:true,state:'pending',orderId:body.orderId};
}

// Webhooks have no browser receipt token. This path is service-role only and re-reads Cashfree
// before finalizing, so webhook payload status/amount are never trusted as payment proof.
export async function fulfillPaymentFromGateway(db,gateway,orderId) {
  if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(orderId))fail(400,'INVALID_PAYMENT_COMMAND');
  const lookup=await db.rpc('qclub_payment_intent_service',{p_order_id:orderId});
  if(lookup.error)fail(503,'PAYMENT_UNAVAILABLE');
  const intent=lookup.data;
  if(!intent)fail(404,'ORDER_NOT_FOUND');
  if(intent.status==='fulfilled')return {ok:true,state:'fulfilled',orderId};
  if(intent.terminal_at)return {ok:true,state:'expired',orderId,reason:intent.terminal_reason||'EXPIRED'};
  const proof=await verifiedEvidence(gateway,orderId,intent);
  if(proof.payment){
    const result=await db.rpc('qclub_payment_fulfill_service',{p_order_id:orderId,p_amount_paise:Number(intent.amount_paise),p_currency:'INR',p_payment_id:String(proof.payment.cf_payment_id)});
    if(result.error)fail(503,'FULFILLMENT_UNAVAILABLE');
    if(!result.data?.ok)fail(result.data?.conflict?409:404,result.data?.conflict?'FULFILLMENT_CONFLICT':'ORDER_NOT_FOUND');
    return {ok:true,state:'fulfilled',orderId};
  }
  if(proof.terminal)return closeTerminal(db,orderId,String(proof.evidence.order_status).toUpperCase());
  return {ok:true,state:'pending',orderId};
}

export function sandboxGateway(env,fetcher=fetch) {
  if(!env.QCLUB_REHEARSAL_CASHFREE_ID || !env.QCLUB_REHEARSAL_CASHFREE_SECRET)fail(503,'SANDBOX_GATEWAY_REQUIRED');
  return {async verify(id){
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))fail(400,'INVALID_PAYMENT_COMMAND');
    async function read(suffix){
      let response;
      try {response=await fetcher(`https://sandbox.cashfree.com/pg/orders/${id}${suffix}`,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'x-client-id':env.QCLUB_REHEARSAL_CASHFREE_ID,'x-client-secret':env.QCLUB_REHEARSAL_CASHFREE_SECRET,'x-api-version':'2025-01-01',Accept:'application/json'}});}catch{fail(503,'GATEWAY_UNAVAILABLE');}
      if(!response.ok)fail(503,'GATEWAY_UNAVAILABLE');
      try{return await response.json();}catch{fail(503,'GATEWAY_UNAVAILABLE');}
    }
    const order=await read('');
    if(!order || typeof order!=='object'||Array.isArray(order))fail(503,'GATEWAY_UNAVAILABLE');
    const payments=await read('/payments');
    if(!Array.isArray(payments))fail(503,'GATEWAY_UNAVAILABLE');
    return {...order,payments};
  }};
}
