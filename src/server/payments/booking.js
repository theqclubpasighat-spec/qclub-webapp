import { createHash } from 'node:crypto';
import { tokenHash } from '../security/foundation.js';
import { SecurityError } from '../security/errors.js';
import { amountInPaise } from './fulfillment.js';

const fail=(status,code)=>{throw new SecurityError(status,code);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));

export function bookingCheckoutRequest(body){
  if(!only(body,['checkoutId','receiptToken','itemId','bookingDate','startTime','durationHours','bookingType','customer','note'])
    || typeof body.checkoutId!=='string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.checkoutId)
    || typeof body.receiptToken!=='string'
    || !/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken)
    || typeof body.itemId!=='string'||!body.itemId||body.itemId.length>160
    || typeof body.bookingDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body.bookingDate)
    || typeof body.startTime!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(body.startTime)
    || !Number.isInteger(body.durationHours)||body.durationHours<1||body.durationHours>5
    || !['member','nonmember'].includes(body.bookingType)
    || !only(body.customer,['name','phone'])
    || typeof body.customer.name!=='string'||!body.customer.name.trim()||body.customer.name.length>120
    || typeof body.customer.phone!=='string'||!/^[6-9][0-9]{9}$/.test(body.customer.phone)
    || (body.note!==undefined&&typeof body.note!=='string')
    || String(body.note||'').length>1000
  ) fail(400,'INVALID_BOOKING');

  const normalized={
    itemId:body.itemId,
    bookingDate:body.bookingDate,
    startTime:body.startTime,
    durationHours:body.durationHours,
    bookingType:body.bookingType,
    customer:{name:body.customer.name.trim(),phone:body.customer.phone},
    note:String(body.note||'').trim(),
  };
  return {
    ...normalized,
    checkoutId:body.checkoutId,
    orderId:`qcb_${body.checkoutId}`,
    receiptHash:tokenHash(body.receiptToken),
    requestHash:createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
  };
}

export async function createBookingCheckout(db,gateway,body){
  const request=bookingCheckoutRequest(body);
  const result=await db.rpc('qclub_booking_checkout',{
    p_order_id:request.orderId,
    p_receipt_hash:request.receiptHash,
    p_request_hash:request.requestHash,
    p_item_id:request.itemId,
    p_booking_date:request.bookingDate,
    p_start_time:request.startTime,
    p_duration_hours:request.durationHours,
    p_booking_type:request.bookingType,
    p_customer_name:request.customer.name,
    p_customer_phone:request.customer.phone,
    p_note:request.note,
  });
  if(result.error)fail(503,'BOOKING_UNAVAILABLE');
  if(!result.data?.ok)fail(409,result.data?.reason||'BOOKING_CONFLICT');
  if(result.data.status==='fulfilled')return {ok:true,state:'fulfilled',orderId:request.orderId};

  const expiresAt=String(result.data.expires_at||'');
  if(!Number.isFinite(Date.parse(expiresAt)))fail(503,'BOOKING_UNAVAILABLE');
  const order=await gateway.create({
    orderId:request.orderId,
    checkoutId:request.checkoutId,
    amountPaise:Number(result.data.amount_paise),
    customer:request.customer,
    expiresAt,
  });
  if(order.order_id!==request.orderId||order.order_currency!=='INR'||amountInPaise(order.order_amount)!==Number(result.data.amount_paise))fail(422,'PAYMENT_MISMATCH');
  if(order.order_status==='PAID')return {ok:true,state:'verify_payment',orderId:request.orderId};
  if(order.order_status!=='ACTIVE'||typeof order.payment_session_id!=='string'||!order.payment_session_id||order.payment_session_id.length>4096)fail(503,'BOOKING_UNAVAILABLE');
  return {
    ok:true,
    state:'ready',
    orderId:request.orderId,
    amountPaise:Number(result.data.amount_paise),
    paymentSessionId:order.payment_session_id,
    expiresAt,
    itemLabel:String(result.data.item_label||'Booked Table'),
    slotLabel:String(result.data.slot_label||''),
  };
}
