import { createHash } from 'node:crypto';
import { tokenHash } from '../security/foundation.js';
import { SecurityError } from '../security/errors.js';
import { amountInPaise } from './fulfillment.js';
const fail=(status,code)=>{throw new SecurityError(status,code);};
function only(value,keys){return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>keys.includes(k));}
export function checkoutRequest(body) {
  if(!only(body,['checkoutId','receiptToken','items','customer']) || typeof body.checkoutId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.checkoutId) || typeof body.receiptToken!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken))fail(400,'INVALID_CHECKOUT');
  if(!only(body.customer,['name','phone']) || typeof body.customer.name!=='string' || !body.customer.name.trim() || body.customer.name.length>120 || typeof body.customer.phone!=='string' || !/^[6-9]\d{9}$/.test(body.customer.phone))fail(400,'INVALID_CUSTOMER');
  if(!Array.isArray(body.items) || !body.items.length || body.items.length>30)fail(400,'INVALID_CART');
  const ids=new Set();
  const items=body.items.map(row=>{
    if(!only(row,['itemId','quantity']) || typeof row.itemId!=='string' || !row.itemId || row.itemId.length>160 || !Number.isInteger(row.quantity) || row.quantity<1 || row.quantity>20 || ids.has(row.itemId))fail(400,'INVALID_CART');
    ids.add(row.itemId);return {itemId:row.itemId,quantity:row.quantity};
  }).sort((a,b)=>a.itemId.localeCompare(b.itemId));
  const customer={name:body.customer.name.trim(),phone:body.customer.phone};
  return {orderId:`qcr_${body.checkoutId}`,receiptHash:tokenHash(body.receiptToken),requestHash:createHash('sha256').update(JSON.stringify({items,customer})).digest('hex'),items,customer,checkoutId:body.checkoutId};
}
export async function createFoodCheckout(db,gateway,body) {
  const request=checkoutRequest(body);
  const {data,error}=await db.rpc('qclub_food_checkout',{p_order_id:request.orderId,p_receipt_hash:request.receiptHash,p_request_hash:request.requestHash,p_items:request.items,p_customer_name:request.customer.name,p_customer_phone:request.customer.phone});
  if(error)fail(503,'CHECKOUT_UNAVAILABLE');
  if(!data?.ok)fail(409,data?.reason || 'CHECKOUT_CONFLICT');
  if(data.status==='fulfilled')return {ok:true,state:'fulfilled',orderId:request.orderId};
  const expiresAt=String(data.expires_at||'');
  if(!expiresAt||!Number.isFinite(Date.parse(expiresAt)))fail(503,'CHECKOUT_UNAVAILABLE');
  const order=await gateway.create({orderId:request.orderId,checkoutId:request.checkoutId,amountPaise:Number(data.amount_paise),customer:request.customer,expiresAt});
  if(order.order_id!==request.orderId || order.order_currency!=='INR' || amountInPaise(order.order_amount)!==Number(data.amount_paise))fail(422,'PAYMENT_MISMATCH');
  if(order.order_status==='PAID')return {ok:true,state:'verify_payment',orderId:request.orderId};
  if(order.order_status!=='ACTIVE' || typeof order.payment_session_id!=='string' || !order.payment_session_id || order.payment_session_id.length>4096)fail(503,'CHECKOUT_UNAVAILABLE');
  return {ok:true,state:'ready',orderId:request.orderId,amountPaise:Number(data.amount_paise),paymentSessionId:order.payment_session_id,expiresAt};
}
