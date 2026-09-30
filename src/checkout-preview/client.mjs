const KEY='qclub.rehearsal.checkout.v1';
export class CheckoutError extends Error{constructor(code,status=0){super(code);this.code=code;this.status=status;}}
export function createCheckoutClient({storage,crypto,fetcher=fetch,now=()=>Date.now()}){
 let attempt=null;
 try{const raw=storage.getItem(KEY);if(raw){attempt=JSON.parse(raw);if(!attempt?.body||!Number.isFinite(attempt.createdAt)||typeof attempt.body.checkoutId!=='string'||typeof attempt.body.receiptToken!=='string'||!Array.isArray(attempt.body.items))throw Error();}}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
 let busy=false;
 const expired=()=>attempt && (now()-attempt.createdAt>24*3600000 || attempt.createdAt>now()+60000);
 async function request(path,body){
  let response;try{response=await fetcher(path,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new CheckoutError('CONNECTION_INTERRUPTED');}
  let result;try{result=await response.json();}catch{throw new CheckoutError('INVALID_RESPONSE');}
  if(!response.ok)throw new CheckoutError(result.error||'REQUEST_FAILED',response.status);
  return result;
 }
 async function exclusive(work){if(busy)throw new CheckoutError('REQUEST_IN_PROGRESS');busy=true;try{return await work();}finally{busy=false;}}
 return {
  current:()=>attempt?structuredClone(attempt):null,
  menu:()=>request('/api/qclub-menu-rehearsal'),
  prepare(items,customer){
   if(attempt)return structuredClone(attempt);
   const bytes=crypto.getRandomValues(new Uint8Array(32));
   const receiptToken=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const next={createdAt:now(),body:{checkoutId:crypto.randomUUID(),receiptToken,items:structuredClone(items),customer:structuredClone(customer)}};
   // Persist BEFORE any network call. If storage fails, never start an unrecoverable payment.
   try{storage.setItem(KEY,JSON.stringify(next));}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
   attempt=next;return structuredClone(attempt);
  },
  start:()=>exclusive(async()=>{if(!attempt)throw new CheckoutError('NO_CHECKOUT');if(expired())throw new CheckoutError('RECOVERY_EXPIRED');const result=await request('/api/qclub-checkout-rehearsal',attempt.body);if(result.orderId!==`qcr_${attempt.body.checkoutId}`||!['ready','verify_payment','fulfilled'].includes(result.state))throw new CheckoutError('INVALID_RESPONSE');if(result.state==='ready'&&(!Number.isSafeInteger(result.amountPaise)||result.amountPaise<=0||typeof result.paymentSessionId!=='string'||!result.paymentSessionId))throw new CheckoutError('INVALID_RESPONSE');return result;}),
  verify:()=>exclusive(async()=>{if(!attempt)throw new CheckoutError('NO_CHECKOUT');if(expired())throw new CheckoutError('RECOVERY_EXPIRED');const result=await request('/api/qclub-payment-rehearsal',{orderId:`qcr_${attempt.body.checkoutId}`,receiptToken:attempt.body.receiptToken});if(result.orderId!==`qcr_${attempt.body.checkoutId}`||!['pending','fulfilled'].includes(result.state))throw new CheckoutError('INVALID_RESPONSE');return result;}),
 };
}
export function checkoutMessage(error){
 const messages={RECOVERY_UNAVAILABLE:'This browser cannot safely keep your order for retries. No new payment has been started.',RECOVERY_EXPIRED:'This order needs help from the club. Keep the order reference and do not pay again.',CONNECTION_INTERRUPTED:'Connection interrupted. Retry this same order; do not start another payment.',STOCK_RESERVATION_REQUIRED:'This item is available at the counter only in this preview.',ITEM_UNAVAILABLE:'An item is no longer available. Contact the club before retrying.',CHECKOUT_RATE_LIMITED:'Please wait 15 minutes before retrying.',CHECKOUT_CONFLICT:'This order differs from its saved details. Contact the club; do not pay again.',SECURITY_REHEARSAL_DISABLED:'Checkout rehearsal is not enabled on this deployment.'};
 return messages[error?.code]||'We could not confirm the order. Keep your reference and retry the same order.';
}
