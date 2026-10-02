import { SecurityError } from '../security/errors.js';
import { timingSafeEqual } from 'node:crypto';

const fail=(status,code)=>{throw new SecurityError(status,code);};
const clean=(value,max=1200)=>String(value??'').trim().slice(0,max);

function secretMatches(supplied,configured){
  const a=Buffer.from(String(supplied||''),'utf8');
  const b=Buffer.from(String(configured||''),'utf8');
  return b.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}

export function authorizeEffectWorker(req,env){
  return secretMatches(req.headers?.['x-qclub-effect-secret'],env.QCLUB_REHEARSAL_EFFECT_SECRET);
}

function dateTime(value){
  const date=new Date(value||Date.now());
  if(Number.isNaN(date.getTime()))return '—';
  return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'short',day:'2-digit',hour:'numeric',minute:'2-digit',hour12:true}).format(date);
}

function foodItems(data){
  const rows=Array.isArray(data?.items)?data.items:[];
  return rows.map((row,index)=>{
    const name=clean(row?.displayName||row?.name||'Item',220)||'Item';
    const qty=Math.max(0,Number(row?.qty??row?.quantity??0)||0);
    const total=Math.max(0,Number(row?.lineTotal??(Number(row?.price||0)*qty))||0);
    return qty?(String(index+1)+'. '+name+' x '+qty+' = ₹'+total):'';
  }).filter(Boolean).join('\n');
}

export function whatsappEffectMessage(job){
  const p=job?.payload||{};
  const data=p.data||{};
  const label=clean(p.label,120);
  const customer=clean(data.customerName||data.name||'Customer',120)||'Customer';
  const amount=clean(p.amount,40)||'0';
  if(label==='food_success')return {label,phone:clean(p.phone,20),params:[customer,clean(data.orderNo||p.orderId,160),amount]};
  if(label==='qshop_order_success')return {label,phone:clean(p.phone,20),params:[customer,clean(data.orderNo||data.receiptId||p.orderId,160),foodItems(data)||'—',amount]};
  if(label==='booking_success')return {label,phone:clean(p.phone,20),params:[customer,clean(data.id||p.orderId,160),clean(data.itemLabel||'Booked Table',220),clean(data.bookingDate,40),clean(data.slotLabel||data.timeSlot,120)]};
  if(label==='membership_success')return {label,phone:clean(p.phone,20),params:[customer,clean(data.tier||'Membership',120),dateTime(data.activatedAt),clean(data.validUntil,40)||'—']};
  if(label==='tournament_success')return {label,phone:clean(p.phone,20),params:[customer,clean(data.tournamentName||'Tournament',220),clean(data.tournamentFee??amount,40)||amount]};
  fail(422,'UNSUPPORTED_EFFECT');
}

function templateName(label,env){
  const names={
    food_success:env.MSG91_FOOD_SUCCESS_TEMPLATE||'food_success_items',
    qshop_order_success:env.MSG91_QSHOP_SUCCESS_TEMPLATE,
    booking_success:env.MSG91_BOOKING_SUCCESS_TEMPLATE,
    membership_success:env.MSG91_MEMBERSHIP_SUCCESS_TEMPLATE,
    tournament_success:env.MSG91_TOURNAMENT_SUCCESS_TEMPLATE,
  };
  return clean(names[label],120);
}

async function claim(db,effectType,workerId){
  const result=await db.rpc('qclub_payment_effect_claim',{p_effect_type:effectType,p_worker_id:workerId});
  if(result.error)fail(503,'EFFECT_QUEUE_UNAVAILABLE');
  if(!result.data?.ok)fail(409,'EFFECT_QUEUE_CONFLICT');
  return result.data.job||null;
}
async function complete(db,id,workerId,success,error=null){
  const result=await db.rpc('qclub_payment_effect_complete',{p_id:id,p_worker_id:workerId,p_success:success,p_error:error});
  if(result.error)fail(503,'EFFECT_QUEUE_UNAVAILABLE');
  if(!result.data?.ok)fail(result.data?.conflict?409:404,result.data?.conflict?'EFFECT_QUEUE_CONFLICT':'EFFECT_NOT_FOUND');
  return result.data;
}

export async function effectWorkerCommand(db,body){
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'INVALID_EFFECT_COMMAND');
  if(body.command==='claim'){
    if(!['print_food','whatsapp_success'].includes(body.effectType)||typeof body.workerId!=='string'||body.workerId.trim().length<1||body.workerId.length>120)fail(400,'INVALID_EFFECT_COMMAND');
    return {ok:true,job:await claim(db,body.effectType,body.workerId.trim())};
  }
  if(body.command==='complete'){
    if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id)||typeof body.workerId!=='string'||body.workerId.trim().length<1||body.workerId.length>120||typeof body.success!=='boolean'||(body.error!==undefined&&typeof body.error!=='string'))fail(400,'INVALID_EFFECT_COMMAND');
    return await complete(db,body.id,body.workerId.trim(),body.success,clean(body.error,1000)||null);
  }
  fail(400,'INVALID_EFFECT_COMMAND');
}

export async function dispatchWhatsappEffect(db,env,fetcher=fetch){
  if(String(env.QCLUB_REHEARSAL_MSG91_MODE||'').toLowerCase()!=='live')fail(503,'REHEARSAL_MSG91_LIVE_DISABLED');
  if(!env.MSG91_AUTH_KEY||!env.MSG91_SENDER_NUMBER)fail(503,'REHEARSAL_MSG91_CONFIG_REQUIRED');
  const workerId='rehearsal-msg91';
  const job=await claim(db,'whatsapp_success',workerId);
  if(!job)return {ok:true,job:null};

  try{
    const message=whatsappEffectMessage(job);
    const template=templateName(message.label,env);
    if(!template)fail(503,'REHEARSAL_MSG91_TEMPLATE_REQUIRED');
    const request={
      integrated_number:env.MSG91_SENDER_NUMBER,
      content_type:'template',
      payload:{
        to:message.phone.startsWith('91')?message.phone:'91'+message.phone,
        messaging_product:'whatsapp',
        type:'template',
        template:{
          name:template,
          language:{code:'en',policy:'deterministic'},
          components:[{type:'body',parameters:message.params.map(value=>({type:'text',text:clean(value)||'—'}))}],
        },
      },
    };
    const response=await fetcher('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/',{
      method:'POST',headers:{'Content-Type':'application/json',authkey:env.MSG91_AUTH_KEY},
      body:JSON.stringify(request),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),
    });
    if(!response.ok){
      const problem=clean(await response.text().catch(()=>''),500)||('MSG91 HTTP '+response.status);
      await complete(db,job.id,workerId,false,problem);
      fail(503,'MSG91_SEND_FAILED');
    }
    await complete(db,job.id,workerId,true,null);
    return {ok:true,job:{id:job.id,orderId:job.orderId,effectType:job.effectType}};
  }catch(error){
    if(error instanceof SecurityError)throw error;
    await complete(db,job.id,workerId,false,clean(error?.message,500)||'MSG91 request failed').catch(()=>{});
    fail(503,'MSG91_SEND_FAILED');
  }
}
