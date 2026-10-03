import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityHandler } from '../src/server/security/handler.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const enabled = Boolean(process.env.QCLUB_PGLITE_MODULE);
const env = {
  QCLUB_SECURITY_REHEARSAL:'enabled',
  QCLUB_SECURITY_SUPABASE_URL:'http://127.0.0.1:54321',
  QCLUB_SECURITY_SERVICE_ROLE_KEY:'test',
};

function harness(handler) {
  async function call({action,method='GET',token,body}) {
    let status=0,payload=null;
    const req={
      method,
      query:{action},
      headers:token?{authorization:`Bearer ${token}`}:{},
      socket:{remoteAddress:'127.0.0.1'},
      body,
    };
    await handler(req,{setHeader(){},status(value){status=value;return this;},json(value){payload=value;}});
    return {status,payload};
  }
  async function login(pin) {
    const result=await call({action:'login',method:'POST',body:{pin,device_id:'fixture',client_version:'staff-ops-test'}});
    assert.equal(result.status,200);
    return result.payload;
  }
  return {call,login};
}

test('staff operations persist with least-privilege role boundaries', {skip:!enabled}, async()=>{
  const fixture=await createFixtureDatabase();
  try{
    const handler=createSecurityHandler({env,createDatabase:()=>fixture.db});
    const api=harness(handler);
    const admin=await api.login('761239');
    const staff=await api.login('852147');
    const committee=await api.login('963258');
    assert.equal(admin.role,'ADMIN');
    assert.equal(staff.role,'STAFF');
    assert.equal(committee.role,'COMMITTEE');

    assert.equal((await api.call({action:'staff-ops',token:committee.access_token})).status,403);
    assert.equal((await api.call({action:'staff-shift',method:'POST',token:staff.access_token,body:{
      command:'CREATE',staffId:'staff-game-marshall',startsAt:'2026-10-04T09:00:00Z',endsAt:'2026-10-04T17:00:00Z',
    }})).status,403);

    const shift=await api.call({action:'staff-shift',method:'POST',token:admin.access_token,body:{
      command:'CREATE',staffId:'staff-game-marshall',startsAt:'2026-10-04T09:00:00Z',endsAt:'2026-10-04T17:00:00Z',note:'Opening shift',
    }});
    assert.equal(shift.status,200);
    assert.equal(shift.payload.shift.status,'SCHEDULED');

    const staffView=await api.call({action:'staff-ops',token:staff.access_token});
    assert.equal(staffView.status,200);
    assert.equal(staffView.payload.shifts.length,1);
    assert.equal(staffView.payload.shifts[0].staff_id,'staff-game-marshall');

    const clockIn=await api.call({action:'staff-attendance',method:'POST',token:staff.access_token,body:{command:'CLOCK_IN',note:'Opened counter'}});
    assert.equal(clockIn.status,200);
    assert.equal(clockIn.payload.attendance.staff_id,'staff-game-marshall');
    assert.equal((await api.call({action:'staff-attendance',method:'POST',token:staff.access_token,body:{command:'CLOCK_IN'}})).status,409);
    assert.equal((await api.call({action:'staff-attendance',method:'POST',token:committee.access_token,body:{command:'CLOCK_IN'}})).status,403);
    const clockOut=await api.call({action:'staff-attendance',method:'POST',token:staff.access_token,body:{command:'CLOCK_OUT',note:'Counter handed over'}});
    assert.equal(clockOut.status,200);
    assert.ok(clockOut.payload.attendance.clock_out);
    assert.equal((await api.call({action:'staff-attendance',method:'POST',token:staff.access_token,body:{command:'CLOCK_OUT'}})).status,409);

    const staffExpense=await api.call({action:'staff-expense',method:'POST',token:staff.access_token,body:{
      command:'CREATE',businessDate:'2026-10-03',category:'SUPPLIES',amountInr:123.45,description:'Cleaning supplies',paymentMethod:'CASH',
    }});
    assert.equal(staffExpense.status,200);
    assert.equal(Number(staffExpense.payload.expense.amount_inr),123.45);
    assert.equal(staffExpense.payload.expense.recorded_by,'staff-game-marshall');

    const adminExpense=await api.call({action:'staff-expense',method:'POST',token:admin.access_token,body:{
      command:'CREATE',businessDate:'2026-10-03',category:'MAINTENANCE',amountInr:250,description:'Fixture repair',paymentMethod:'UPI',
    }});
    assert.equal(adminExpense.status,200);

    const staffExpenseView=await api.call({action:'staff-ops',token:staff.access_token});
    assert.equal(staffExpenseView.payload.expenses.length,1);
    assert.equal(staffExpenseView.payload.expenses[0].recorded_by,'staff-game-marshall');
    const adminView=await api.call({action:'staff-ops',token:admin.access_token});
    assert.equal(adminView.payload.expenses.length,2);
    assert.equal(adminView.payload.attendance.length,1);

    assert.equal((await api.call({action:'staff-expense',method:'POST',token:staff.access_token,body:{
      command:'VOID',expenseId:staffExpense.payload.expense.id,reason:'Correction',
    }})).status,403);
    const voided=await api.call({action:'staff-expense',method:'POST',token:admin.access_token,body:{
      command:'VOID',expenseId:staffExpense.payload.expense.id,reason:'Duplicate receipt',
    }});
    assert.equal(voided.status,200);
    assert.equal(voided.payload.expense.status,'VOIDED');
    assert.equal(voided.payload.expense.voided_by,'admin-main');

    const cancelled=await api.call({action:'staff-shift',method:'POST',token:admin.access_token,body:{
      command:'CANCEL',shiftId:shift.payload.shift.id,reason:'Club closed',
    }});
    assert.equal(cancelled.status,200);
    assert.equal(cancelled.payload.shift.status,'CANCELLED');
    assert.equal((await api.call({action:'staff-expense',method:'POST',token:staff.access_token,body:{
      command:'CREATE',businessDate:'bad',category:'X',amountInr:-1,paymentMethod:'CASH',
    }})).status,400);

    const counts=await fixture.pg.query(`select
      (select count(*)::int from public.qclub_staff_shifts) shifts,
      (select count(*)::int from public.qclub_staff_attendance) attendance,
      (select count(*)::int from public.qclub_expenses) expenses`);
    assert.deepEqual(counts.rows,[{shifts:1,attendance:1,expenses:2}]);
  }finally{await fixture.close();}
});
