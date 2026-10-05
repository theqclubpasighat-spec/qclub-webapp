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
 for(const key of ['jobApplications','memberRegistry','paymentOrders','whatsappPersistence','club'])assert.throws(()=>applyWebsitePatch(before,'COMMITTEE',{[key]:[]}),/FORBIDDEN/);
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
