import { createHmac,timingSafeEqual } from 'node:crypto';
import { SecurityError } from '../security/errors.js';
import { fulfillPaymentFromGateway } from './fulfillment.js';

const fail=(status,code)=>{throw new SecurityError(status,code);};

function headerValue(headers,name){
  const value=headers?.[name]??headers?.[name.toLowerCase()]??headers?.[name.toUpperCase()];
  return Array.isArray(value)?String(value[0]||'').trim():String(value||'').trim();
}

export function verifyCashfreeWebhook(rawBody,headers,secret){
  if(typeof rawBody!=='string'||!rawBody.length||rawBody.length>1024*1024)fail(400,'INVALID_WEBHOOK');
  if(!secret)fail(503,'SANDBOX_GATEWAY_REQUIRED');
  const signature=headerValue(headers,'x-webhook-signature');
  const timestamp=headerValue(headers,'x-webhook-timestamp');
  if(!signature||!/^\d{8,20}$/.test(timestamp))fail(401,'INVALID_WEBHOOK_SIGNATURE');
  const expected=createHmac('sha256',secret).update(timestamp+rawBody).digest('base64');
  const a=Buffer.from(expected,'utf8'),b=Buffer.from(signature,'utf8');
  if(a.length!==b.length||!timingSafeEqual(a,b))fail(401,'INVALID_WEBHOOK_SIGNATURE');
  return true;
}

export function cashfreeWebhookEvent(rawBody){
  let body;
  try{body=JSON.parse(rawBody);}catch{fail(400,'INVALID_WEBHOOK');}
  const order=body?.data?.order;
  const payment=body?.data?.payment;
  const orderId=String(order?.order_id||'');
  const paymentStatus=String(payment?.payment_status||'').toUpperCase();
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(orderId)||!paymentStatus)fail(400,'INVALID_WEBHOOK');
  return {orderId,paymentStatus};
}

export async function processCashfreeWebhook({db,gateway,rawBody,headers,secret}){
  verifyCashfreeWebhook(rawBody,headers,secret);
  const event=cashfreeWebhookEvent(rawBody);
  if(event.paymentStatus!=='SUCCESS')return {ok:true,state:'ignored',orderId:event.orderId};
  return fulfillPaymentFromGateway(db,gateway,event.orderId);
}
