import { createHash } from 'node:crypto';
import { tokenHash } from '../security/foundation.js';
import { SecurityError } from '../security/errors.js';
import { amountInPaise } from './fulfillment.js';

const fail=(status,code)=>{throw new SecurityError(status,code);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));

export function shopCheckoutRequest(body){
  if(!only(body,['checkoutId','receiptToken','items','customer'])
    || typeof body.checkoutId!=='string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.checkoutId)
    || typeof body.receiptToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken)
    || !only(body.customer,['name','phone'])
    || typeof body.customer.name!=='string'||!body.customer.name.trim()||body.customer.name.length>120
    || typeof body.customer.phone!=='string'||!/^[6-9][0-9]{9}$/.test(body.customer.phone)
    || !Array.isArray(body.items)||body.items.length<1||body.items.length>30
  ) fail(400,'INVALID_SHOP_CHECKOUT');

  const seen=new Set();
  const items=body.items.map(row=>{
    if(!only(row,['itemId','optionId','quantity'])
      || typeof row.itemId!=='string'||!row.itemId||row.itemId.length>160
      || (row.optionId!==undefined&&row.optionId!==null&&(typeof row.optionId!=='string'||row.optionId.length>160))
      || !Number.isInteger(row.quantity)||row.quantity<1||row.quantity>20
    ) fail(400,'INVALID_SHOP_CART');
    const optionId=String(row.optionId||'');
    const key=`${row.itemId}\u0000${optionId}`;
    if(seen.has(key))fail(400,'INVALID_SHOP_CART');
    seen.add(key);
    return {itemId:row.itemId,optionId:optionId||null,quantity:row.quantity};
  }).sort((a,b)=>a.itemId.localeCompare(b.itemId)||(a.optionId||'').localeCompare(b.optionId||''));

  const customer={name:body.customer.name.trim(),phone:body.customer.phone};
  return {
    orderId:`qcs_${body.checkoutId}`,
    checkoutId:body.checkoutId,
    receiptHash:tokenHash(body.receiptToken),
    requestHash:createHash('sha256').update(JSON.stringify({items,customer})).digest('hex'),
    items,customer,
  };
}

export async function createShopCheckout(db,gateway,body){
  const request=shopCheckoutRequest(body);
  const result=await db.rpc('qclub_shop_checkout',{
    p_order_id:request.orderId,
    p_receipt_hash:request.receiptHash,
    p_request_hash:request.requestHash,
    p_items:request.items,
    p_customer_name:request.customer.name,
    p_customer_phone:request.customer.phone,
  });
  if(result.error)fail(503,'SHOP_UNAVAILABLE');
  if(!result.data?.ok)fail(409,result.data?.reason||'SHOP_CONFLICT');
  if(result.data.status==='fulfilled')return {ok:true,state:'fulfilled',orderId:request.orderId};

  const expiresAt=String(result.data.expires_at||'');
  if(!Number.isFinite(Date.parse(expiresAt)))fail(503,'SHOP_UNAVAILABLE');
  const order=await gateway.create({
    orderId:request.orderId,checkoutId:request.checkoutId,
    amountPaise:Number(result.data.amount_paise),customer:request.customer,expiresAt,
  });
  if(order.order_id!==request.orderId||order.order_currency!=='INR'||amountInPaise(order.order_amount)!==Number(result.data.amount_paise))fail(422,'PAYMENT_MISMATCH');
  if(order.order_status==='PAID')return {ok:true,state:'verify_payment',orderId:request.orderId};
  if(order.order_status!=='ACTIVE'||typeof order.payment_session_id!=='string'||!order.payment_session_id||order.payment_session_id.length>4096)fail(503,'SHOP_UNAVAILABLE');
  return {ok:true,state:'ready',orderId:request.orderId,amountPaise:Number(result.data.amount_paise),paymentSessionId:order.payment_session_id,expiresAt};
}
