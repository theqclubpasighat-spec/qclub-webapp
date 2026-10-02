import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminClient, changesBetween } from '../src/admin-preview/client.mjs';
import { createSecurityHandler } from '../src/server/security/handler.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';
import { allowAdminPreview } from '../scripts/admin-preview-policy.mjs';
test('admin UI is excluded from production even with opt-in',()=>{
  assert.equal(allowAdminPreview({VERCEL_ENV:'production',QCLUB_SECURITY_REHEARSAL:'enabled'},'serve'),false);
  assert.equal(allowAdminPreview({VERCEL_ENV:'preview'}),false);
  assert.equal(allowAdminPreview({VERCEL_ENV:'preview',QCLUB_SECURITY_REHEARSAL:'enabled'}),true);
  assert.equal(allowAdminPreview({QCLUB_SECURITY_REHEARSAL:'enabled'},'serve'),true);
});
test('CMS patch sends only changed allowed fields and never operational state',()=>{
  assert.deepEqual(changesBetween({club:{name:'Old',location:'Keep'}},{club:{name:'New',location:'Keep',mainPin:'bad'},paymentOrders:[]}),{club:{name:'New'}});
  assert.deepEqual(changesBetween({club:{name:'Old'}},{club:{name:''}}),{club:{name:''}});
});
test('real Postgres admin workflow: login, edit, conflict, staff denial and sign-out', {skip:!process.env.QCLUB_PGLITE_MODULE}, async()=>{
  const fixture=await createFixtureDatabase();
  try{
    const handler=createSecurityHandler({env:{QCLUB_SECURITY_REHEARSAL:'enabled',QCLUB_SECURITY_SUPABASE_URL:'http://127.0.0.1:54321',QCLUB_SECURITY_SERVICE_ROLE_KEY:'test'},createDatabase:()=>fixture.db});
    let capturedToken;
    const fetcher=async(url,options)=>{
      let status,body;
      if(options.headers.Authorization)capturedToken=options.headers.Authorization;
      const req={method:options.method,query:Object.fromEntries(new URL(url,'http://local').searchParams),headers:{authorization:options.headers.Authorization},socket:{remoteAddress:'127.0.0.1'},body:options.body?JSON.parse(options.body):undefined};
      await handler(req,{setHeader(){},status(value){status=value;return this;},json(value){body=value;}});
      return {ok:status<400,status,json:async()=>body};
    };
    const admin=createAdminClient(fetcher),staff=createAdminClient(fetcher);
    assert.equal((await admin.login('761239')).staff_id,'admin-main');
    const initial=await admin.content();assert.ok(!JSON.stringify(initial).includes('PRIVATE-FIXTURE'));
    const saved=await admin.save(initial.updatedAt,{club:{name:'Rehearsal club'}});assert.ok(saved.updatedAt);
    assert.equal((await admin.content()).content.club.name,'Rehearsal club');
    await assert.rejects(admin.save(initial.updatedAt,{club:{name:'Stale overwrite'}}),e=>e.status===409);
    assert.equal((await staff.login('852147')).role,'STAFF');
    await assert.rejects(staff.save(saved.updatedAt,{club:{name:'Forged'}}),e=>e.status===403);
    const untouched=await fixture.pg.query("select state from public.qclub_state where key='main'");
    assert.equal(untouched.rows[0].state.paymentOrders[0].amount,490);
    assert.equal(untouched.rows[0].state.admin.mainPin,'PRIVATE-FIXTURE');
    const notices=[{id:'notice_12345678-1234-4123-8123-123456789abc',text:'Friday club evening',link:'/fixtures'}];
    const published=await admin.save(saved.updatedAt,{notices});
    assert.deepEqual((await admin.content()).content.announcements,notices);
    await assert.rejects(admin.save(saved.updatedAt,{notices:[]}),e=>e.status===409);
    await admin.save(published.updatedAt,{notices:[]});
    const preserved=await fixture.pg.query("select state from public.qclub_state where key='main'");
    assert.deepEqual(preserved.rows[0].state.announcements,[{id:'booking-fixture',type:'table_booking',text:'PRIVATE-FIXTURE',bookingId:'keep-booking'},{id:'legacy-fixture',text:'PRIVATE-FIXTURE'}]);
    await admin.logout();const oldToken=capturedToken;
    const revoked=await fetcher('/api/qclub-checkout-rehearsal?scope=security&action=session',{method:'GET',headers:{Authorization:oldToken}});
    assert.equal(revoked.status,401);
    await assert.rejects(admin.save(saved.updatedAt,{club:{name:'Signed out'}}),e=>e.status===401);
  }finally{await fixture.close();}
});
test('logout failure still forgets the in-memory bearer',async()=>{
  const seen=[];
  const client=createAdminClient(async(url,options)=>{
    seen.push(options.headers);
    if(url.includes('action=login'))return {ok:true,json:async()=>({access_token:'snk_'+'a'.repeat(43)})};
    if(url.includes('action=logout'))return {ok:false,status:503,json:async()=>({error:'SIGN_OUT_FAILED'})};
    return {ok:true,json:async()=>({role:'ADMIN'})};
  });
  await client.login('synthetic');
  await assert.rejects(client.logout(),e=>e.code==='SIGN_OUT_FAILED');
  await client.content();
  assert.equal(seen.at(-1).Authorization,undefined);
});


test('membership and rate draft changes are sent as explicit CMS sections',()=>{
  const before={
    club:{name:'Q Club'},
    memberships:[{id:'m1',tier:'Bronze',price:499,perks:['A'],note:'N'}],
    bookingTables:[{id:'t1',label:'T1',pricePerHour:400,memberPricePerHour:300}],
  };
  const after=structuredClone(before);
  after.memberships[0].price=599;
  after.bookingTables[0].memberPricePerHour=250;
  const changes=changesBetween(before,after);
  assert.deepEqual(changes.memberships,after.memberships);
  assert.deepEqual(changes.bookingTables,after.bookingTables);
  assert.equal(changes.club,undefined);
});
