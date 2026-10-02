import { SecurityError } from '../security/errors.js';

function fail(status,code){throw new SecurityError(status,code);}

export function rehearsalPublicOrigin(env) {
  const raw=String(env.QCLUB_REHEARSAL_PUBLIC_URL||'').trim();
  if(!raw)fail(503,'REHEARSAL_PUBLIC_URL_REQUIRED');
  let url;
  try{url=new URL(raw);}catch{fail(503,'REHEARSAL_PUBLIC_URL_INVALID');}
  const host=url.hostname.toLowerCase();
  const local=host==='localhost'||host==='127.0.0.1';
  if(url.protocol!=='https:'&&!local)fail(503,'REHEARSAL_PUBLIC_URL_INVALID');
  if(host==='theqclubpasighat.com'||host==='www.theqclubpasighat.com')fail(503,'REHEARSAL_PUBLIC_URL_FORBIDDEN');
  if(url.username||url.password)fail(503,'REHEARSAL_PUBLIC_URL_INVALID');
  return url.origin;
}

export function sandboxCheckout(env,fetcher=fetch) {
  if(!env.QCLUB_REHEARSAL_CASHFREE_ID || !env.QCLUB_REHEARSAL_CASHFREE_SECRET)fail(503,'SANDBOX_GATEWAY_REQUIRED');
  const publicOrigin=rehearsalPublicOrigin(env);
  return {async create({orderId,checkoutId,amountPaise,customer}) {
    if(!/^qcr_[0-9a-f-]{36}$/.test(orderId) || !/^[0-9a-f-]{36}$/.test(checkoutId) || !Number.isSafeInteger(amountPaise) || amountPaise<=0)fail(400,'INVALID_CHECKOUT');
    const headers={'x-client-id':env.QCLUB_REHEARSAL_CASHFREE_ID,'x-client-secret':env.QCLUB_REHEARSAL_CASHFREE_SECRET,'x-api-version':'2025-01-01',Accept:'application/json','Content-Type':'application/json'};
    async function request(method,url,body) {
      try {return await fetcher(url,{method,headers:{...headers,...(method==='POST'?{'x-idempotency-key':checkoutId}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),...(body?{body:JSON.stringify(body)}:{})});}
      catch {fail(503,'GATEWAY_UNAVAILABLE');}
    }
    const base='https://sandbox.cashfree.com/pg/orders';
    const orderMeta={
      return_url:`${publicOrigin}/__checkout-preview?order_id={order_id}`,
      notify_url:`${publicOrigin}/api/qclub-payment-webhook-rehearsal`,
    };
    let response=await request('POST',base,{order_id:orderId,order_amount:amountPaise/100,order_currency:'INR',customer_details:{customer_id:orderId,customer_name:customer.name,customer_phone:customer.phone},order_meta:orderMeta});
    if(response.status===409)response=await request('GET',`${base}/${orderId}`);
    if(!response.ok)fail(503,'GATEWAY_UNAVAILABLE');
    try {const data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{fail(503,'GATEWAY_UNAVAILABLE');}
  }};
}
