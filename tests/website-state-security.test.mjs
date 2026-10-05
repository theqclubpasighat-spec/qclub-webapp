import {test} from 'node:test';
import assert from 'node:assert/strict';
import {websitePublicState,websiteActorState,applyWebsitePatch,websiteStateTransport} from '../src/server/security/website-state.js';
const fixture=()=>({
 admin:{mainPin:'fixture-secret'},club:{name:'Q Club',tickerSpeed:220,contact:{phone1:'public-contact',privateKey:'fixture-secret'},unknownSecret:'fixture-secret'},
 players:[{id:'p1',name:'Player',mobile:'fixture-private',committeeNotes:'fixture-private',snookerWins:2}],
 tournaments:[{id:'t1',name:'Cup',registrationFee:40,matches:[{id:'m1',p1:'p1',notes:'fixture-private',unknownSecret:'fixture-secret'}]}],
 booking:{tables:[{id:'table1',label:'Snooker',pricePerHour:250,privateKey:'fixture-secret'}],requests:[{id:'booking1',mobile:'fixture-private'}]},
 menuCatalog:{drinks:{title:'Drinks',secret:'fixture-secret',items:[{id:'drink1',name:'Tea',price:20,privateKey:'fixture-secret'}]}},
 shopCatalog:{items:[{id:'cue1',name:'Cue',price:100,privateKey:'fixture-secret',options:[{id:'small',label:'Small',stock:2,privateKey:'fixture-secret'}]}]},
 jobSettings:{acceptingApplications:true,positions:['Assistant']},jobApplications:[{id:'job1',aadhaarNumber:'fixture-private'}],
 memberRegistry:[{id:'member1',mobile:'fixture-private'}],paymentOrders:[{id:'payment1',amount:10}],
 whatsappPersistence:{settings:{authKey:'fixture-secret'}},unknownPrivate:{secret:'fixture-secret'},
});
test('public snapshot preserves menus, rates and ticker but excludes private fields at every level',()=>{
 const view=websitePublicState(fixture());const json=JSON.stringify(view);
 assert.equal(json.includes('fixture-secret'),false);assert.equal(json.includes('fixture-private'),false);
 assert.equal(view.club.tickerSpeed,220);assert.equal(view.menuCatalog.drinks.items[0].price,20);
 assert.equal(view.shopCatalog.items[0].options[0].stock,2);assert.equal(view.booking.tables[0].pricePerHour,250);
 assert.deepEqual(view.jobSettings.positions,['Assistant']);assert.equal(view.admin,undefined);assert.equal(view.paymentOrders,undefined);
});
test('malformed object values in public fields cannot smuggle nested secrets',()=>{
 const state=fixture();state.club.name={secret:'fixture-secret'};state.club.heroSlides=[{secret:'fixture-secret'}];state.players[0].bio={secret:'fixture-secret'};
 assert.equal(JSON.stringify(websitePublicState(state)).includes('fixture-secret'),false);
});
test('staff and committee cannot fetch applicants, credentials or gateway records',()=>{
 for(const role of ['STAFF','COMMITTEE']){
 const view=websiteActorState(fixture(),role);assert.equal(view.jobApplications,undefined);assert.equal(view.admin,undefined);assert.equal(view.paymentOrders,undefined);assert.equal(view.whatsappPersistence,undefined);
 }
 const committee=websiteActorState(fixture(),'COMMITTEE');assert.equal(committee.players[0].mobile,undefined);
 const admin=websiteActorState(fixture(),'ADMIN');assert.equal(admin.jobApplications[0].id,'job1');assert.equal(admin.admin,undefined);assert.equal(admin.whatsappPersistence,undefined);
 assert.throws(()=>websiteActorState(fixture(),'OWNER'),/FORBIDDEN/);
});
test('authorized patches preserve server credentials, private collections and gateway records',()=>{
 const before=fixture();const next=applyWebsitePatch(before,'ADMIN',{club:{name:'Changed'}});
 assert.equal(next.club.name,'Changed');assert.deepEqual(next.admin,before.admin);assert.deepEqual(next.paymentOrders,before.paymentOrders);assert.deepEqual(next.jobApplications,before.jobApplications);
 for(const role of ['STAFF','COMMITTEE','ADMIN'])assert.throws(()=>applyWebsitePatch(before,role,{admin:{mainPin:'changed'}}),/FORBIDDEN/);
 for(const key of ['jobApplications','memberRegistry','paymentOrders','whatsappPersistence','club','matchLedger','qChaseActiveGames','tournaments'])assert.throws(()=>applyWebsitePatch(before,'COMMITTEE',{[key]:[]}),/FORBIDDEN/);
});
test('committee reviews preserve private player fields; staff cannot alter table pricing',()=>{
 const state=fixture();const next=applyWebsitePatch(state,'COMMITTEE',{players:[{id:'p1',name:'Player',committeeNotes:'Reviewed'}]});
 assert.equal(next.players[0].mobile,'fixture-private');assert.equal(next.players[0].committeeNotes,'Reviewed');
 assert.throws(()=>applyWebsitePatch(state,'COMMITTEE',{players:[]}),/FORBIDDEN/);
 assert.throws(()=>applyWebsitePatch(state,'STAFF',{booking:{tables:[{id:'table1',pricePerHour:1}]}}),/FORBIDDEN/);
});
test('anonymous state mutation fails before reading private data; cross-site request is rejected',async()=>{
 const db={from(){throw Error('must not read database');}};
 await assert.rejects(websiteStateTransport(db,{method:'PATCH',headers:{},body:{role:'ADMIN',patch:{club:{name:'Changed'}}}}),/AUTH_REQUIRED/);
 await assert.rejects(websiteStateTransport(db,{method:'GET',headers:{'sec-fetch-site':'cross-site'}}),/CROSS_SITE_REQUEST/);
});

test('malformed and duplicate restricted-role patches cannot erase protected data',()=>{
 const state=fixture();state.players.push({id:'p2',name:'Second',mobile:'private-second'});
 assert.throws(()=>applyWebsitePatch(state,'STAFF',{booking:null}),/INVALID_PATCH/);
 assert.throws(()=>applyWebsitePatch(state,'COMMITTEE',{players:[{id:'p1'},{id:'p1'}]}),/INVALID_PATCH/);
 assert.throws(()=>applyWebsitePatch(state,'COMMITTEE',{tournaments:[{id:'t1',matches:[]},{id:'t1',matches:[]}]}),/FORBIDDEN/);
 assert.throws(()=>applyWebsitePatch(state,'COMMITTEE',{tournaments:[{id:'t1',registrationFee:1,matches:[]}]}),/FORBIDDEN/);
 const next=applyWebsitePatch(state,'COMMITTEE',{players:[{id:'p1',name:'Changed',group:'B'},{id:'p2',name:'Second'}]});
 assert.equal(next.players[0].name,'Player');assert.equal(next.players[0].group,'B');
});

test('Postgres transport validates sessions and conflicts without exposing private state',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
 const {createFixtureDatabase}=await import('./support/rehearsal-db.mjs');
 const {tokenHash}=await import('../src/server/security/foundation.js');
 const harness=await createFixtureDatabase();
 try{
  const pg=harness.pg,db=harness.db,state=fixture();
  await pg.query("update qclub_state set state=$1 where key='main'",[JSON.stringify(state)]);
  const token=`snk_${'a'.repeat(43)}`;
  await pg.query("insert into snooker_auth_sessions(token_hash,role,staff_id,display_name,expires_at) values($1,'ADMIN','admin-main','Fixture',now()+interval '1 hour')",[tokenHash(token)]);
  const headers={authorization:`Bearer ${token}`};
  const publicResponse=await websiteStateTransport(db,{method:'GET',headers:{}});
  assert.equal(JSON.stringify(publicResponse).includes('fixture-secret'),false);assert.equal(JSON.stringify(publicResponse).includes('fixture-private'),false);
  const privateResponse=await websiteStateTransport(db,{method:'GET',headers});
  assert.equal(privateResponse.role,'ADMIN');assert.equal(privateResponse.state.jobApplications[0].id,'job1');assert.equal(privateResponse.state.admin,undefined);
  const saved=await websiteStateTransport(db,{method:'PATCH',headers,body:{baseUpdatedAt:privateResponse.updatedAt,patch:{club:{name:'Updated'}}}});
  assert.equal(saved.state.club.name,'Updated');
  await assert.rejects(websiteStateTransport(db,{method:'PATCH',headers,body:{baseUpdatedAt:privateResponse.updatedAt,patch:{club:{name:'Stale'}}}}),/STATE_CONFLICT/);
  const stored=(await pg.query("select state from qclub_state where key='main'")).rows[0].state;
  assert.equal(stored.club.name,'Updated');assert.equal(stored.admin.mainPin,'fixture-secret');assert.equal(stored.paymentOrders[0].id,'payment1');
  await pg.query('update snooker_auth_sessions set revoked_at=now() where token_hash=$1',[tokenHash(token)]);
  await assert.rejects(websiteStateTransport(db,{method:'GET',headers}),/AUTH_REQUIRED/);
 }finally{await harness.close();}
});
