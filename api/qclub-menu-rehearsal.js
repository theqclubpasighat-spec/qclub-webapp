import { createClient } from '@supabase/supabase-js';
import { rehearsalConfig,SecurityError } from '../src/server/security/foundation.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const config=rehearsalConfig(process.env);
  if(req.method!=='GET')throw new SecurityError(405,'METHOD_NOT_ALLOWED');
  const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
  const [cats,items]=await Promise.all([
   db.from('qclub_fnb_categories').select('category_key,title').eq('active',true),
   db.from('snooker_catalogue_items').select('id,name,selling_price_inr,qlounge_category_key').eq('active',true).eq('show_on_qlounge',true).eq('online_order_enabled',true).eq('track_inventory',false),
  ]);
  if(cats.error||items.error)throw new SecurityError(503,'MENU_UNAVAILABLE');
  const categories=new Map((cats.data||[]).map(c=>[c.category_key,c.title]));
  const menu=(items.data||[]).filter(i=>categories.has(i.qlounge_category_key)&&Number.isFinite(Number(i.selling_price_inr))&&Number(i.selling_price_inr)>0).map(i=>({id:i.id,name:i.name,price:Number(i.selling_price_inr),category:categories.get(i.qlounge_category_key)}));
  return res.status(200).json({items:menu});
 }catch(error){return res.status(error instanceof SecurityError?error.status:503).json({ok:false,error:error instanceof SecurityError?error.code:'MENU_UNAVAILABLE'});}
}
