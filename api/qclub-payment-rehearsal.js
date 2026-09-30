import { createClient } from '@supabase/supabase-js';
import { rehearsalConfig, SecurityError } from '../src/server/security/foundation.js';
import { fulfillPayment, sandboxGateway } from '../src/server/payments/fulfillment.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    const config=rehearsalConfig(process.env);
    if(req.method!=='POST')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
    if(req.headers?.['sec-fetch-site']==='cross-site')throw new SecurityError(403,'CROSS_SITE_REQUEST');
    const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
    return res.status(200).json(await fulfillPayment(db,sandboxGateway(process.env),req.body));
  }catch(error){return res.status(error instanceof SecurityError?error.status:503).json({ok:false,error:error instanceof SecurityError?error.code:'PAYMENT_UNAVAILABLE'});}
}
