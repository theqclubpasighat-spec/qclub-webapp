import { SecurityError } from '../security/errors.js';
import { fulfillPaymentFromGateway } from './fulfillment.js';

const fail=(status,code)=>{throw new SecurityError(status,code);};

export async function reconcileStalePayments(db,gateway,{before=new Date(),limit=10}={}){
  const beforeIso=before instanceof Date?before.toISOString():String(before||'');
  const bounded=Math.max(1,Math.min(20,Math.trunc(Number(limit)||10)));
  if(!Number.isFinite(Date.parse(beforeIso)))fail(400,'INVALID_RECONCILE_WINDOW');

  const lookup=await db.rpc('qclub_payment_stale_intents',{p_before:beforeIso,p_limit:bounded});
  if(lookup.error)fail(503,'RECONCILE_UNAVAILABLE');
  if(!Array.isArray(lookup.data))fail(503,'RECONCILE_UNAVAILABLE');

  const summary={ok:true,checked:0,fulfilled:0,released:0,pending:0,errors:0};
  for(const row of lookup.data.slice(0,bounded)){
    const orderId=String(row?.order_id||'');
    if(!/^qcr_[0-9a-f-]{36}$/.test(orderId)){summary.errors++;continue;}
    summary.checked++;
    try{
      const result=await fulfillPaymentFromGateway(db,gateway,orderId);
      if(result.state==='fulfilled')summary.fulfilled++;
      else if(result.state==='expired')summary.released++;
      else summary.pending++;
    }catch{
      summary.errors++;
    }
  }
  return summary;
}
