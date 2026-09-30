import { createClient } from '@supabase/supabase-js';
import { rehearsalConfig,SecurityError,requestAddress,tokenHash } from '../src/server/security/foundation.js';
import { createFoodCheckout } from '../src/server/payments/checkout.js';
import { sandboxCheckout } from '../src/server/payments/sandbox-checkout.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    const config=rehearsalConfig(process.env);
    if(req.method!=='POST')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
    if(req.headers?.['sec-fetch-site']==='cross-site')throw new SecurityError(403,'CROSS_SITE_REQUEST');
    const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
    // Separate namespace in the existing fail-closed reservation limiter.
    const limit=await db.rpc('qclub_security_reserve_attempt',{p_network_hash:tokenHash(`checkout:${requestAddress(req,process.env)}`)});
    if(limit.error)throw new SecurityError(503,'CHECKOUT_UNAVAILABLE');
    if(!limit.data?.allowed)throw new SecurityError(429,'CHECKOUT_RATE_LIMITED');
    return res.status(200).json(await createFoodCheckout(db,sandboxCheckout(process.env),req.body));
  }catch(error){return res.status(error instanceof SecurityError?error.status:503).json({ok:false,error:error instanceof SecurityError?error.code:'CHECKOUT_UNAVAILABLE'});}
}
