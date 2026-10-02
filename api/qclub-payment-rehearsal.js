import { createClient } from '@supabase/supabase-js';
import { rehearsalConfig, SecurityError } from '../src/server/security/foundation.js';
import { fulfillPayment, sandboxGateway } from '../src/server/payments/fulfillment.js';
import { processCashfreeWebhook } from '../src/server/payments/webhook.js';

export const config={api:{bodyParser:false}};

async function rawBody(req){
  if(typeof req.body==='string')return req.body;
  const chunks=[];let size=0;
  for await(const chunk of req){
    const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=value.length;if(size>1024*1024)throw new SecurityError(413,'INVALID_REQUEST');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw){
  try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{throw new SecurityError(400,'INVALID_PAYMENT_COMMAND');}
}

function actionOf(req){
  const direct=String(req.query?.action||'').trim();
  if(direct)return direct;
  try{return new URL(req.url||'/', 'https://rehearsal.invalid').searchParams.get('action')||'';}catch{return '';}
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  let action='';
  try {
    const config=rehearsalConfig(process.env);
    if(req.method!=='POST')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
    action=actionOf(req);
    const raw=await rawBody(req);
    const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==='webhook'){
      return res.status(200).json(await processCashfreeWebhook({
        db,
        gateway:sandboxGateway(process.env),
        rawBody:raw,
        headers:req.headers||{},
        secret:process.env.QCLUB_REHEARSAL_CASHFREE_SECRET,
      }));
    }
    if(action)throw new SecurityError(404,'ACTION_NOT_FOUND');
    if(req.headers?.['sec-fetch-site']==='cross-site')throw new SecurityError(403,'CROSS_SITE_REQUEST');
    return res.status(200).json(await fulfillPayment(db,sandboxGateway(process.env),parseJson(raw)));
  }catch(error){
    const fallback=action==='webhook'?'WEBHOOK_UNAVAILABLE':'PAYMENT_UNAVAILABLE';
    return res.status(error instanceof SecurityError?error.status:503).json({ok:false,error:error instanceof SecurityError?error.code:fallback});
  }
}
