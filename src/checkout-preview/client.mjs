const KEY='qclub.rehearsal.checkout.v1';
const COMPLETED_KEY='qclub.rehearsal.checkout.last-reference.v1';
export class CheckoutError extends Error{constructor(code,status=0){super(code);this.code=code;this.status=status;}}
export function createCheckoutClient({storage,crypto,fetcher=fetch,now=()=>Date.now()}){
 let attempt=null,lastReference=null;
 try{const raw=storage.getItem(KEY);if(raw){attempt=JSON.parse(raw);if(!attempt?.body||!Number.isFinite(attempt.createdAt)||typeof attempt.body.checkoutId!=='string'||typeof attempt.body.receiptToken!=='string'||!Array.isArray(attempt.body.items))throw Error();}}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
 let busy=false;
 try{const saved=storage.getItem(COMPLETED_KEY);if(saved){const parsed=JSON.parse(saved);if(typeof parsed.orderId==='string'&&/^qcr_[0-9a-f-]{36}$/i.test(parsed.orderId))lastReference=parsed.orderId;}}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
 const expired=()=>attempt && (now()-attempt.createdAt>24*3600000 || attempt.createdAt>now()+60000);
 async function request(path,body){
  let response;try{response=await fetcher(path,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new CheckoutError('CONNECTION_INTERRUPTED');}
  let result;try{result=await response.json();}catch{throw new CheckoutError('INVALID_RESPONSE');}
  if(!response.ok)throw new CheckoutError(result.error||'REQUEST_FAILED',response.status);
  return result;
 }
 async function exclusive(work){if(busy)throw new CheckoutError('REQUEST_IN_PROGRESS');busy=true;try{return await work();}finally{busy=false;}}
 async function verifyCurrent(){
  if(!attempt)throw new CheckoutError('NO_CHECKOUT');
  if(expired())throw new CheckoutError('RECOVERY_EXPIRED');
  const result=await request('/api/qclub-payment-rehearsal',{orderId:`qcr_${attempt.body.checkoutId}`,receiptToken:attempt.body.receiptToken});
  if(result.orderId!==`qcr_${attempt.body.checkoutId}`||!['pending','fulfilled','expired'].includes(result.state))throw new CheckoutError('INVALID_RESPONSE');
  return result;
 }
 return {
  current:()=>attempt?structuredClone(attempt):null,
  lastReference:()=>lastReference,
  menu:()=>request('/api/qclub-checkout-rehearsal?action=menu'),
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
  verify:()=>exclusive(verifyCurrent),
  resumeReturn:(orderId)=>exclusive(async()=>{
   if(!attempt)throw new CheckoutError('NO_CHECKOUT');
   const expected=`qcr_${attempt.body.checkoutId}`;
   if(orderId!==expected)throw new CheckoutError('RETURN_ORDER_MISMATCH');
   return verifyCurrent();
  }),
  editCart:()=>exclusive(async()=>{
   if(!attempt)throw new CheckoutError('NO_CHECKOUT');
   const saved=structuredClone(attempt);
   const result=await request('/api/qclub-checkout-rehearsal?action=recover',{checkoutId:attempt.body.checkoutId,receiptToken:attempt.body.receiptToken});
   if(result.orderId!==`qcr_${attempt.body.checkoutId}`||!['closed','existing'].includes(result.state))throw new CheckoutError('INVALID_RESPONSE');
   if(result.state!=='closed')throw new CheckoutError('ORDER_ALREADY_CREATED');
   // Only a durable server closure can release this identity, never a 404/error.
   try{storage.removeItem(KEY);}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
   attempt=null;return saved;
  }),
  retryExpired:()=>exclusive(async()=>{
   if(!attempt)throw new CheckoutError('NO_CHECKOUT');
   const saved=structuredClone(attempt);
   const result=await verifyCurrent();
   if(result.state!=='expired')throw new CheckoutError('ORDER_NOT_EXPIRED');
   try{storage.setItem(COMPLETED_KEY,JSON.stringify({orderId:result.orderId}));storage.removeItem(KEY);}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
   lastReference=result.orderId;attempt=null;
   return saved;
  }),
  newOrder:()=>exclusive(async()=>{
   // Recheck the server; a cached UI status or popup callback cannot unlock a new order.
   const result=await verifyCurrent();
   if(result.state!=='fulfilled')throw new CheckoutError('ORDER_NOT_COMPLETE');
   // Keep the most recent reference, without customer details or receipt capability.
   // Persist it before removing recovery proof; any storage failure leaves this attempt locked.
   try{storage.setItem(COMPLETED_KEY,JSON.stringify({orderId:result.orderId}));storage.removeItem(KEY);}catch{throw new CheckoutError('RECOVERY_UNAVAILABLE');}
   lastReference=result.orderId;attempt=null;
   return {orderId:lastReference};
  }),
 };
}
export function checkoutMessage(error){
 const messages={ORDER_NOT_EXPIRED:'This order is still active. Keep checking payment status before replacing it.',INSUFFICIENT_STOCK:'There is not enough stock for that quantity. Refresh the cart and choose the available quantity.',RETURN_ORDER_MISMATCH:'The payment return does not match this saved order. Keep this order reference and contact the club.',ORDER_ALREADY_CREATED:'This order has already been created. Resume it or check payment status; its cart cannot be replaced.',CHECKOUT_CLOSED:'This unused checkout was closed. Use Fix a rejected cart to continue.',INVALID_CUSTOMER:'Check your name and 10-digit mobile number using Fix a rejected cart.',INVALID_CART:'Review your items and quantities using Fix a rejected cart.',ORDER_NOT_COMPLETE:'This order is not confirmed yet. Keep checking its status before starting another order.',RECOVERY_UNAVAILABLE:'This browser cannot safely keep your order for retries. No new payment has been started.',RECOVERY_EXPIRED:'This saved order is too old for automatic browser recovery. Keep the order reference and contact the club before paying again.',CONNECTION_INTERRUPTED:'Connection interrupted. Retry this same order; do not start another payment.',STOCK_RESERVATION_REQUIRED:'This item is available at the counter only in this preview.',ITEM_UNAVAILABLE:'An item is no longer available. Use Fix a rejected cart to review available items.',CHECKOUT_RATE_LIMITED:'Please wait 15 minutes before retrying.',CHECKOUT_CONFLICT:'This order differs from its saved details. Contact the club; do not pay again.',SECURITY_REHEARSAL_DISABLED:'Checkout rehearsal is not enabled on this deployment.'};
 return messages[error?.code]||'We could not confirm the order. Keep your reference and retry the same order.';
}
