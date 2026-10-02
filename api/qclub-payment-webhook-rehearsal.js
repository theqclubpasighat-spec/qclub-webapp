import { createClient } from '@supabase/supabase-js';
import { rehearsalConfig,SecurityError } from '../src/server/security/foundation.js';
import { sandboxGateway } from '../src/server/payments/fulfillment.js';
import { processCashfreeWebhook } from '../src/server/payments/webhook.js';

export const config={api:{bodyParser:false}};

async function rawBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=value.length;if(size>1024*1024)throw new SecurityError(413,'INVALID_WEBHOOK');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const config=rehearsalConfig(process.env);
    if(req.method!=='POST')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
    const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await processCashfreeWebhook({
      db,
      gateway:sandboxGateway(process.env),
      rawBody:await rawBody(req),
      headers:req.headers||{},
      secret:process.env.QCLUB_REHEARSAL_CASHFREE_SECRET,
    });
    return res.status(200).json(result);
  }catch(error){
    return res.status(error instanceof SecurityError?error.status:503).json({ok:false,error:error instanceof SecurityError?error.code:'WEBHOOK_UNAVAILABLE'});
  }
}
