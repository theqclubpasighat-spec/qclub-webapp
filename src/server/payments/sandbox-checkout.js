import { SecurityError } from '../security/errors.js';
export function sandboxCheckout(env,fetcher=fetch) {
  if(!env.QCLUB_REHEARSAL_CASHFREE_ID || !env.QCLUB_REHEARSAL_CASHFREE_SECRET)throw new SecurityError(503,'SANDBOX_GATEWAY_REQUIRED');
  return {async create({orderId,checkoutId,amountPaise,customer}) {
    if(!/^qcr_[0-9a-f-]{36}$/.test(orderId) || !/^[0-9a-f-]{36}$/.test(checkoutId) || !Number.isSafeInteger(amountPaise) || amountPaise<=0)throw new SecurityError(400,'INVALID_CHECKOUT');
    const headers={'x-client-id':env.QCLUB_REHEARSAL_CASHFREE_ID,'x-client-secret':env.QCLUB_REHEARSAL_CASHFREE_SECRET,'x-api-version':'2025-01-01',Accept:'application/json','Content-Type':'application/json'};
    async function request(method,url,body) {
      try {return await fetcher(url,{method,headers:{...headers,...(method==='POST'?{'x-idempotency-key':checkoutId}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),...(body?{body:JSON.stringify(body)}:{})});}
      catch {throw new SecurityError(503,'GATEWAY_UNAVAILABLE');}
    }
    const base='https://sandbox.cashfree.com/pg/orders';
    let response=await request('POST',base,{order_id:orderId,order_amount:amountPaise/100,order_currency:'INR',customer_details:{customer_id:orderId,customer_name:customer.name,customer_phone:customer.phone}});
    // A retry after a lost response can find an existing order with the same server ID.
    if(response.status===409)response=await request('GET',`${base}/${orderId}`);
    if(!response.ok)throw new SecurityError(503,'GATEWAY_UNAVAILABLE');
    try {const data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw new SecurityError(503,'GATEWAY_UNAVAILABLE');}
  }};
}
