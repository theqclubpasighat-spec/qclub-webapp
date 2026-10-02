import { createHash } from 'node:crypto';
import { tokenHash } from '../security/foundation.js';
import { SecurityError } from '../security/errors.js';
import { amountInPaise } from './fulfillment.js';

const fail=(status,code)=>{throw new SecurityError(status,code);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));

export function tournamentCheckoutRequest(body){
  if(!only(body,['checkoutId','receiptToken','tournamentId','customer'])
    || typeof body.checkoutId!=='string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.checkoutId)
    || typeof body.receiptToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken)
    || typeof body.tournamentId!=='string'||!body.tournamentId||body.tournamentId.length>160
    || !only(body.customer,['name','phone'])
    || typeof body.customer.name!=='string'||!body.customer.name.trim()||body.customer.name.length>120
    || typeof body.customer.phone!=='string'||!/^[6-9][0-9]{9}$/.test(body.customer.phone)
  ) fail(400,'INVALID_TOURNAMENT_CHECKOUT');

  const normalized={
    tournamentId:body.tournamentId,
    customer:{name:body.customer.name.trim(),phone:body.customer.phone},
  };
  return {
    ...normalized,
    checkoutId:body.checkoutId,
    orderId:`qct_${body.checkoutId}`,
    receiptHash:tokenHash(body.receiptToken),
    requestHash:createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
  };
}

export async function createTournamentCheckout(db,gateway,body){
  const request=tournamentCheckoutRequest(body);
  const result=await db.rpc('qclub_tournament_checkout',{
    p_order_id:request.orderId,
    p_receipt_hash:request.receiptHash,
    p_request_hash:request.requestHash,
    p_tournament_id:request.tournamentId,
    p_customer_name:request.customer.name,
    p_customer_phone:request.customer.phone,
  });
  if(result.error)fail(503,'TOURNAMENT_UNAVAILABLE');
  if(!result.data?.ok)fail(409,result.data?.reason||'TOURNAMENT_CONFLICT');
  if(result.data.status==='fulfilled')return {ok:true,state:'fulfilled',orderId:request.orderId};

  const expiresAt=String(result.data.expires_at||'');
  if(!Number.isFinite(Date.parse(expiresAt)))fail(503,'TOURNAMENT_UNAVAILABLE');
  const order=await gateway.create({
    orderId:request.orderId,
    checkoutId:request.checkoutId,
    amountPaise:Number(result.data.amount_paise),
    customer:request.customer,
    expiresAt,
  });
  if(order.order_id!==request.orderId||order.order_currency!=='INR'||amountInPaise(order.order_amount)!==Number(result.data.amount_paise))fail(422,'PAYMENT_MISMATCH');
  if(order.order_status==='PAID')return {ok:true,state:'verify_payment',orderId:request.orderId};
  if(order.order_status!=='ACTIVE'||typeof order.payment_session_id!=='string'||!order.payment_session_id||order.payment_session_id.length>4096)fail(503,'TOURNAMENT_UNAVAILABLE');
  return {
    ok:true,state:'ready',orderId:request.orderId,
    amountPaise:Number(result.data.amount_paise),
    paymentSessionId:order.payment_session_id,
    expiresAt,
    tournamentName:String(result.data.tournament_name||'Tournament'),
  };
}
