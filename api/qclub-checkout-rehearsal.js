import { createClient } from '@supabase/supabase-js';
import { rehearsalConfig,SecurityError,requestAddress,tokenHash } from '../src/server/security/foundation.js';
import { createFoodCheckout } from '../src/server/payments/checkout.js';
import { closeUnusedCheckout } from '../src/server/payments/checkout-recovery.js';
import { sandboxCheckout } from '../src/server/payments/sandbox-checkout.js';
import { createSecurityHandler } from '../src/server/security/handler.js';

function actionOf(req){
  const direct=String(req.query?.action||'').trim();
  if(direct)return direct;
  try{return new URL(req.url||'/', 'https://rehearsal.invalid').searchParams.get('action')||'';}catch{return '';}
}

async function reserveCheckoutAttempt(db,req){
  const limit=await db.rpc('qclub_security_reserve_attempt',{p_network_hash:tokenHash(`checkout:${requestAddress(req,process.env)}`)});
  if(limit.error)throw new SecurityError(503,'CHECKOUT_UNAVAILABLE');
  if(!limit.data?.allowed)throw new SecurityError(429,'CHECKOUT_RATE_LIMITED');
}

async function menu(db){
  const [cats,items]=await Promise.all([
    db.from('qclub_fnb_categories').select('category_key,title').eq('active',true),
    db.from('snooker_catalogue_items').select('id,name,selling_price_inr,qlounge_category_key').eq('active',true).eq('show_on_qlounge',true).eq('online_order_enabled',true).eq('track_inventory',false),
  ]);
  if(cats.error||items.error)throw new SecurityError(503,'MENU_UNAVAILABLE');
  const categories=new Map((cats.data||[]).map(c=>[c.category_key,c.title]));
  const rows=(items.data||[])
    .filter(i=>categories.has(i.qlounge_category_key)&&Number.isFinite(Number(i.selling_price_inr))&&Number(i.selling_price_inr)>0)
    .map(i=>({id:i.id,name:i.name,price:Number(i.selling_price_inr),category:categories.get(i.qlounge_category_key)}));
  return {items:rows};
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  let action='';
  try {
    const scope=String(req.query?.scope||(()=>{try{return new URL(req.url||'/', 'https://rehearsal.invalid').searchParams.get('scope')||'';}catch{return '';}})()).trim();
    if(scope==='security'){
      const parsed=new URL(req.url||'/', 'https://rehearsal.invalid');
      req.query={...(req.query||{}),action:req.query?.action||parsed.searchParams.get('action')||''};
      const securityHandler=createSecurityHandler({
        env:process.env,
        createDatabase:({url,key})=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),
      });
      return securityHandler(req,res);
    }
    if(scope)throw new SecurityError(404,'NOT_FOUND');
    const config=rehearsalConfig(process.env);
    action=actionOf(req);
    const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==='menu'){
      if(req.method!=='GET')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
      return res.status(200).json(await menu(db));
    }
    if(action==='recover'){
      if(req.method!=='POST')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
      if(req.headers?.['sec-fetch-site']==='cross-site')throw new SecurityError(403,'CROSS_SITE_REQUEST');
      await reserveCheckoutAttempt(db,req);
      return res.status(200).json(await closeUnusedCheckout(db,req.body));
    }
    if(action)throw new SecurityError(404,'ACTION_NOT_FOUND');
    if(req.method!=='POST')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
    if(req.headers?.['sec-fetch-site']==='cross-site')throw new SecurityError(403,'CROSS_SITE_REQUEST');
    await reserveCheckoutAttempt(db,req);
    return res.status(200).json(await createFoodCheckout(db,sandboxCheckout(process.env),req.body));
  }catch(error){
    const fallback=action==='menu'?'MENU_UNAVAILABLE':'CHECKOUT_UNAVAILABLE';
    return res.status(error instanceof SecurityError?error.status:503).json({ok:false,error:error instanceof SecurityError?error.code:fallback});
  }
}
