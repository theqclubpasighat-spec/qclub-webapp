import { SecurityError } from './errors.js';

const fail=(status,code)=>{throw new SecurityError(status,code);};
const text=(value,max)=>typeof value==='string' ? value.trim().slice(0,max) : '';
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : '';

async function rpc(db,name,args){
  const {data,error}=await db.rpc(name,args);
  if(error) fail(503,'STAFF_OPS_UNAVAILABLE');
  if(!data || data.ok!==true){
    const code=data?.error || 'STAFF_OPS_UNAVAILABLE';
    const status=code==='FORBIDDEN'?403:
      ['SHIFT_NOT_FOUND','EXPENSE_NOT_FOUND'].includes(code)?404:
      ['ALREADY_CLOCKED_IN','NOT_CLOCKED_IN'].includes(code)?409:400;
    fail(status,code);
  }
  return data;
}

export async function staffOpsSnapshot(db,actorTokenHash){
  return rpc(db,'qclub_staff_ops_snapshot',{p_actor_token_hash:actorTokenHash});
}

export async function createStaffShift(db,actorTokenHash,body={}){
  const staffId=text(body.staffId,120);
  const startsAt=text(body.startsAt,80);
  const endsAt=text(body.endsAt,80);
  const note=text(body.note,1000);
  if(!staffId || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))) fail(400,'INVALID_SHIFT');
  return rpc(db,'qclub_staff_shift_create',{
    p_actor_token_hash:actorTokenHash,p_staff_id:staffId,p_starts_at:startsAt,p_ends_at:endsAt,p_note:note,
  });
}

export async function cancelStaffShift(db,actorTokenHash,body={}){
  const shiftId=uuid(body.shiftId);
  const reason=text(body.reason,1000);
  if(!shiftId || !reason) fail(400,'INVALID_SHIFT_CANCEL');
  return rpc(db,'qclub_staff_shift_cancel',{p_actor_token_hash:actorTokenHash,p_shift_id:shiftId,p_reason:reason});
}

export async function clockStaffAttendance(db,actorTokenHash,body={}){
  const command=text(body.command,20).toUpperCase();
  const note=text(body.note,1000);
  if(!['CLOCK_IN','CLOCK_OUT'].includes(command)) fail(400,'INVALID_ATTENDANCE_COMMAND');
  return rpc(db,'qclub_staff_attendance_clock',{p_actor_token_hash:actorTokenHash,p_command:command,p_note:note});
}

export async function createStaffExpense(db,actorTokenHash,body={}){
  const businessDate=text(body.businessDate,20);
  const category=text(body.category,80).toUpperCase();
  const amount=Number(body.amountInr);
  const description=text(body.description,2000);
  const paymentMethod=text(body.paymentMethod,20).toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !category || !Number.isFinite(amount) || amount<=0 ||
     !['CASH','UPI','BANK','OTHER'].includes(paymentMethod)) fail(400,'INVALID_EXPENSE');
  return rpc(db,'qclub_expense_create',{
    p_actor_token_hash:actorTokenHash,p_business_date:businessDate,p_category:category,p_amount_inr:amount,
    p_description:description,p_payment_method:paymentMethod,
  });
}

export async function voidStaffExpense(db,actorTokenHash,body={}){
  const expenseId=uuid(body.expenseId);
  const reason=text(body.reason,1000);
  if(!expenseId || !reason) fail(400,'INVALID_EXPENSE_VOID');
  return rpc(db,'qclub_expense_void',{p_actor_token_hash:actorTokenHash,p_expense_id:expenseId,p_reason:reason});
}
