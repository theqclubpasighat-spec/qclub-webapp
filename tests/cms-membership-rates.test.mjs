import test from 'node:test';
import assert from 'node:assert/strict';
import { contentPatch, publicContent } from '../src/server/security/foundation.js';
import { changesBetween, createAdminClient } from '../src/admin-preview/client.mjs';
import { createSecurityHandler } from '../src/server/security/handler.js';
import { createFixtureDatabase } from './support/rehearsal-db.mjs';

const base={
  memberships:[
    {id:'membership_bronze',tier:'Bronze',price:799,perks:['A'],note:'Keep',privateTierFlag:'SECRET'},
    {id:'membership_gold',tier:'Gold',price:2199,perks:['B'],note:'Keep'}
  ],
  booking:{
    tables:[
      {id:'snk12',label:'Snooker',pricePerHour:600,memberPricePerHour:500,privateRateFlag:'SECRET'},
      {id:'pool9',label:'Pool',pricePerHour:400,memberPricePerHour:300}
    ],
    requests:[{id:'private-request',mobile:'SECRET'}],
    blockedSlots:[{id:'private-block'}]
  },
  admin:{mainPin:'SECRET'}
};

test('CMS projection exposes tier/rate fields but no operational or private nested data',()=>{
  const out=publicContent(base);
  assert.deepEqual(out.memberships,[
    {id:'membership_bronze',tier:'Bronze',price:799,perks:['A'],note:'Keep'},
    {id:'membership_gold',tier:'Gold',price:2199,perks:['B'],note:'Keep'}
  ]);
  assert.deepEqual(out.bookingRates,[
    {id:'snk12',label:'Snooker',pricePerHour:600,memberPricePerHour:500},
    {id:'pool9',label:'Pool',pricePerHour:400,memberPricePerHour:300}
  ]);
  assert.equal(JSON.stringify(out).includes('SECRET'),false);
  assert.equal(JSON.stringify(out).includes('private-request'),false);
});

test('CMS tier/rate patch preserves hidden fields, booking requests and fixed identities',()=>{
  const next=contentPatch(base,{
    memberships:[
      {id:'membership_bronze',tier:'Bronze Plus',price:899,perks:['A','Tea'],note:'Monthly'},
      {id:'membership_gold',tier:'Gold',price:2299,perks:['B'],note:'Premium'}
    ],
    bookingRates:[
      {id:'snk12',label:'T1 Liberwin',pricePerHour:650,memberPricePerHour:500},
      {id:'pool9',label:'T4 Pool',pricePerHour:450,memberPricePerHour:300}
    ]
  });
  assert.equal(next.memberships[0].privateTierFlag,'SECRET');
  assert.equal(next.booking.tables[0].privateRateFlag,'SECRET');
  assert.deepEqual(next.booking.requests,base.booking.requests);
  assert.deepEqual(next.booking.blockedSlots,base.booking.blockedSlots);
  assert.equal(next.memberships[0].tier,'Bronze Plus');
  assert.equal(next.booking.tables[0].label,'T1 Liberwin');
});

test('CMS tier/rate validation fails closed on structural or pricing tampering',()=>{
  const goodMemberships=publicContent(base).memberships;
  const goodRates=publicContent(base).bookingRates;
  const bad=[
    {memberships:goodMemberships.slice(0,1)},
    {memberships:[...goodMemberships,{id:'new-tier',tier:'New',price:1,perks:[],note:''}]},
    {memberships:goodMemberships.map((x,i)=>i?x:{...x,id:'forged'})},
    {memberships:goodMemberships.map((x,i)=>i?x:{...x,price:1.5})},
    {memberships:goodMemberships.map((x,i)=>i?x:{...x,unknown:'x'})},
    {bookingRates:goodRates.slice(0,1)},
    {bookingRates:goodRates.map((x,i)=>i?x:{...x,memberPricePerHour:x.pricePerHour+1})},
    {bookingRates:goodRates.map((x,i)=>i?x:{...x,pricePerHour:-1})},
    {bookingRates:goodRates.map((x,i)=>i?x:{...x,id:'wrong'})},
  ];
  for(const patch of bad)assert.throws(()=>contentPatch(base,patch),e=>e.code==='INVALID_CONTENT_PATCH');
});

test('admin client sends structured changes only when values differ',()=>{
  const before={memberships:publicContent(base).memberships,bookingRates:publicContent(base).bookingRates};
  assert.deepEqual(changesBetween(before,structuredClone(before)),{});
  const after=structuredClone(before);
  after.memberships[0].price=899;
  after.bookingRates[1].memberPricePerHour=320;
  const changes=changesBetween(before,after);
  assert.equal(changes.memberships[0].price,899);
  assert.equal(changes.bookingRates[1].memberPricePerHour,320);
});

test('real rehearsal admin can save tiers/rates without touching private booking state',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
  const fixture=await createFixtureDatabase();
  try{
    const handler=createSecurityHandler({
      env:{QCLUB_SECURITY_REHEARSAL:'enabled',QCLUB_SECURITY_SUPABASE_URL:'http://127.0.0.1:54321',QCLUB_SECURITY_SERVICE_ROLE_KEY:'test'},
      createDatabase:()=>fixture.db
    });
    const fetcher=async(url,options)=>{
      let status,body;
      const req={
        method:options.method,
        query:Object.fromEntries(new URL(url,'http://local').searchParams),
        headers:{authorization:options.headers.Authorization},
        socket:{remoteAddress:'127.0.0.1'},
        body:options.body?JSON.parse(options.body):undefined
      };
      await handler(req,{setHeader(){},status(v){status=v;return this;},json(v){body=v;}});
      return {ok:status<400,status,json:async()=>body};
    };
    const admin=createAdminClient(fetcher);
    await admin.login('761239');
    const initial=await admin.content();
    const memberships=structuredClone(initial.content.memberships);
    const rates=structuredClone(initial.content.bookingRates);
    memberships[0].price=899;
    rates[0].pricePerHour=650;
    const saved=await admin.save(initial.updatedAt,{memberships,bookingRates:rates});
    assert.equal(saved.content.memberships[0].price,899);
    assert.equal(saved.content.bookingRates[0].pricePerHour,650);
    const row=(await fixture.pg.query("select state from public.qclub_state where key='main'")).rows[0].state;
    assert.equal(row.memberships[0].privateTierFlag,'PRIVATE-FIXTURE');
    assert.equal(row.booking.tables[0].privateRateFlag,'PRIVATE-FIXTURE');
    assert.deepEqual(row.booking.requests,[{id:'keep-booking',mobile:'PRIVATE-FIXTURE'}]);
    assert.deepEqual(row.booking.blockedSlots,[{id:'keep-block'}]);
    assert.equal(row.admin.mainPin,'PRIVATE-FIXTURE');
  }finally{await fixture.close();}
});
