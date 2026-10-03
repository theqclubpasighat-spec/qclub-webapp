import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, bearer, contentPatch, hashPin, privateLogin, publicContent, rehearsalConfig, requestAddress, saveContent, tokenHash, verifyPin } from '../src/server/security/foundation.js';
import { createSecurityHandler } from '../src/server/security/handler.js';
const token = 'snk_' + 'a'.repeat(43);
const now = new Date('2026-09-29T00:00:00Z');
const actor = { id: 'session-1', role: 'ADMIN', staff_id: 'admin-main', display_name: 'Admin', expires_at: '2026-09-30T00:00:00Z', revoked_at: null };
const request = { headers: { authorization: `Bearer ${token}` } };
function queryDb(result, calls = []) {
  return { from(name) {
    calls.push(['from', name]);
    const q = {};
    for (const method of ['select', 'eq', 'update', 'insert']) q[method] = (...args) => { calls.push([method, ...args]); return q; };
    q.maybeSingle = q.single = async () => typeof result === 'function' ? result(calls) : result;
    q.then = (resolve, reject) => Promise.resolve(typeof result === 'function' ? result(calls) : result).then(resolve, reject);
    return q;
  }};
}
const expectCode = code => e => e.code === code;

test('PINs are salted, one-way and strictly validated', async () => {
  const a = await hashPin('761239'); const b = await hashPin('761239');
  assert.notEqual(a, b); assert.ok(!a.includes('761239'));
  assert.equal(await verifyPin('761239', a), true);
  assert.equal(await verifyPin('761238', a), false);
  assert.equal(await verifyPin('761239', a.replace('scrypt-v1', 'scrypt-v0')), false);
  assert.equal(await verifyPin('761239', 'scrypt-v1$00$00'), false);
  for (const pin of [null, 1234, '123', 'a'.repeat(65), ' 1234', '1234\n']) await assert.rejects(hashPin(pin), expectCode('INVALID_PIN_FORMAT'));
});
test('deployment gate rejects production and all three existing databases', () => {
  const cfg = { QCLUB_SECURITY_REHEARSAL: 'enabled', QCLUB_SECURITY_SUPABASE_URL: 'http://127.0.0.1:54321', QCLUB_SECURITY_SERVICE_ROLE_KEY: 'test-only' };
  assert.equal(rehearsalConfig(cfg).url, 'http://127.0.0.1:54321');
  assert.throws(() => rehearsalConfig({ ...cfg, VERCEL_ENV: 'production' }), expectCode('SECURITY_REHEARSAL_DISABLED'));
  assert.throws(() => rehearsalConfig({}), expectCode('SECURITY_REHEARSAL_DISABLED'));
  for (const ref of ['nvuyttadgqpqgpiftzxy', 'pqoaexwjyknzalhmnapc', 'dgdtxlhtgtvfvtmmqbrn']) {
    assert.throws(() => rehearsalConfig({ ...cfg, QCLUB_SECURITY_PROJECT_REF: ref, QCLUB_SECURITY_SUPABASE_URL: `https://${ref}.supabase.co` }), expectCode('REHEARSAL_DATABASE_REQUIRED'));
  }
  for (const url of ['https://example.com', 'https://x.supabase.co', 'http://127.0.0.1:54321/anything', 'http://secret@localhost', 'http://localhost?key=x']) assert.throws(() => rehearsalConfig({ ...cfg, QCLUB_SECURITY_SUPABASE_URL: url }));
});
test('session validation checks expiry, revocation, stored role and database failures', async () => {
  const calls = [];
  assert.equal((await authenticate(queryDb({ data: actor }, calls), request, ['ADMIN'], now)).staff_id, 'admin-main');
  assert.deepEqual(calls.find(x => x[0] === 'eq'), ['eq', 'token_hash', tokenHash(token)]);
  for (const data of [null, { ...actor, revoked_at: now.toISOString() }, { ...actor, expires_at: now.toISOString() }, { ...actor, expires_at: 'bad' }]) await assert.rejects(authenticate(queryDb({ data }), request, ['ADMIN'], now), expectCode('AUTH_REQUIRED'));
  await assert.rejects(authenticate(queryDb({ data: { ...actor, role: 'STAFF' } }), { ...request, body: { role: 'ADMIN' } }, ['ADMIN'], now), expectCode('FORBIDDEN'));
  await assert.rejects(authenticate(queryDb({ error: new Error('secret-db-url') }), request, ['ADMIN'], now), expectCode('AUTH_UNAVAILABLE'));
  for (const h of ['', 'Bearer forged', `Bearer ${token} extra`]) assert.throws(() => bearer({ headers: { authorization: h } }));
});
test('public projection cannot leak credentials, customer records or nested unknown fields', () => {
  const state = { admin: { mainPin: 'SECRET' }, club: { name: 'Club', internal: 'SECRET', tagline: { secret: 'SECRET' } }, foodPage: { title: 'Food', private: 'SECRET' }, jobApplications: ['SECRET'], paymentOrders: ['SECRET'], whatsappPersistence: { authKey: 'SECRET' }, announcements: [{ id: 'notice', type: 'notice', text: 'Hello', recipientPhone: 'SECRET' }, { type: 'table_booking', text: 'SECRET' }] };
  assert.deepEqual(publicContent(state), { club: { name: 'Club', heroSlides: [] }, foodPage: { title: 'Food' }, memberships: [], bookingTables: [], shopCatalog: { heading: '', topLabel: '', description: '', badge1: '', badge2: '', items: [] }, theme: {}, announcements: [{ id: 'notice', text: 'Hello', link: '' }] });
  assert.ok(!JSON.stringify(publicContent(state)).includes('SECRET'));
});
test('content patch cannot overwrite PINs, payments, catalogue prices or unknown properties', () => {
  const before = { admin: { mainPin: 'private' }, club: { name: 'Old', privateSetting: 'keep' }, paymentOrders: [{ paid: true }] };
  const next = contentPatch(before, { club: { name: 'New' } });
  assert.equal(next.club.name, 'New'); assert.equal(next.club.privateSetting, 'keep');
  assert.deepEqual(next.admin, before.admin); assert.deepEqual(next.paymentOrders, before.paymentOrders); assert.equal(before.club.name, 'Old');
  for (const patch of [{ admin: {} }, { paymentOrders: [] }, { club: { name: 4 } }, { club: { unknown: 'x' } }, { club: { name: 'a'.repeat(30001) } }, JSON.parse('{"__proto__":{"admin":true}}'), {}]) assert.throws(() => contentPatch(before, patch), expectCode('INVALID_CONTENT_PATCH'));
});
test('concurrent content save uses a database revision condition and returns a conflict', async () => {
  const row = { state: { club: { name: 'Old' }, paymentOrders: [1] }, updated_at: '2026-09-28T00:00:00Z' };
  const calls = [];
  const db = queryDb(history => history.some(x => x[0] === 'update') ? { data: null } : { data: row }, calls);
  await assert.rejects(saveContent(db, actor, { baseUpdatedAt: row.updated_at, changes: { club: { name: 'New' } } }, now), expectCode('STATE_CONFLICT'));
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'updated_at' && x[2] === row.updated_at));
  assert.deepEqual(calls.find(x => x[0] === 'update')[1].state.paymentOrders, [1]);
  await assert.rejects(saveContent(db, { role: 'STAFF' }, {}), expectCode('FORBIDDEN'));
  await assert.rejects(saveContent(queryDb({ data: row }), actor, { baseUpdatedAt: now.toISOString(), changes: { club: { name: 'X' } } }), expectCode('STATE_CONFLICT'));
});
test('login preserves Android token/response contract and stores only token hashes', async () => {
  const calls = []; const pin_hash = await hashPin('761239');
  const db = queryDb({ error: null }, calls);
  db.rpc = async (name, args) => { calls.push(['rpc',name,args]); return name === 'qclub_security_reserve_attempt' ? { data: { allowed: true } } : name === 'qclub_security_create_session' ? { data: true } : { data: [{ credential_id: 'staff', pin_hash, version: 1 }] }; };
  const result = await privateLogin(db, { socket: { remoteAddress: '127.0.0.1' }, headers: {}, body: { pin: '761239', device_id: 'phone' } }, now);
  assert.deepEqual(Object.keys(result).sort(), ['access_token', 'display_name', 'expires_at', 'role', 'staff_id'].sort());
  assert.equal(result.role, 'STAFF'); assert.match(result.access_token, /^snk_[A-Za-z0-9_-]{43}$/);
  const stored = calls.find(x => x[0] === 'rpc' && x[1] === 'qclub_security_create_session')[2];
  assert.equal(stored.p_token_hash, tokenHash(result.access_token)); assert.ok(!JSON.stringify(stored).includes(result.access_token));
  await assert.rejects(privateLogin(db, { headers: {}, body: { pin: '761239' } }), expectCode('LOGIN_UNAVAILABLE'));
  db.rpc = async () => ({ data: { allowed: false } });
  await assert.rejects(privateLogin(db, { socket: { remoteAddress: '127.0.0.1' }, headers: {}, body: { pin: '761239' } }), expectCode('LOGIN_RATE_LIMITED'));
  db.rpc = async () => ({ error: new Error('database down') });
  await assert.rejects(privateLogin(db, { socket: { remoteAddress: '127.0.0.1' }, headers: {}, body: { pin: '761239' } }), expectCode('LOGIN_UNAVAILABLE'));
});
test('HTTP entry stays disabled without configuration, never initializes a production client', async () => {
  let initialized = false; const headers = {};
  const res = { setHeader(k,v) { headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await createSecurityHandler({ env: {}, createDatabase: () => { initialized = true; } })({ method: 'GET', query: { action: 'content' } }, res);
  assert.equal(initialized, false); assert.equal(res.code, 503); assert.equal(headers['Cache-Control'], 'no-store');
});

test('network limit does not trust spoofed client headers outside Vercel', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '192.0.2.9', 'x-real-ip': '192.0.2.8' } };
  assert.equal(requestAddress(req, {}), '127.0.0.1');
  assert.equal(requestAddress(req, { VERCEL: '1' }), '192.0.2.9');
  assert.throws(() => requestAddress({ headers: req.headers }, {}));
  assert.throws(() => requestAddress({ headers: { 'x-forwarded-for': '192.0.2.9, 192.0.2.10' } }, { VERCEL: '1' }));
});


test('membership and table-rate CMS patches are validated and preserve booking operations',()=>{
  const before={
    memberships:[{id:'membership_bronze',tier:'Bronze',price:799,perks:['Member pricing'],note:'Non-transferable',private:'keep-tier'}],
    booking:{tables:[{id:'tbl_1',label:'T1 Liberwin',pricePerHour:400,memberPricePerHour:300,private:'keep'}],requests:[{id:'booking-private',mobile:'9999999999'}],blockedSlots:[{id:'block-1'}]},
    paymentOrders:[{id:'paid-private'}],
  };
  const next=contentPatch(before,{
    memberships:[
      {id:'membership_bronze',tier:'Bronze',price:499,perks:['Member pricing','Daily perk'],note:'Non-transferable'},
      {id:'membership_gold',tier:'Gold',price:1499,perks:['Member pricing'],note:'Non-transferable'},
    ],
    bookingTables:[{id:'tbl_1',label:'T1 Liberwin',pricePerHour:450,memberPricePerHour:300}],
  });
  assert.equal(next.memberships[0].price,499);
  assert.equal(next.booking.tables[0].pricePerHour,450);
  assert.equal(next.booking.tables[0].private,'keep');
  assert.equal(next.memberships[0].private,'keep-tier');
  assert.deepEqual(next.booking.requests,before.booking.requests);
  assert.deepEqual(next.booking.blockedSlots,before.booking.blockedSlots);
  assert.deepEqual(next.paymentOrders,before.paymentOrders);
  assert.equal(before.memberships[0].price,799);

  for(const changes of [
    {memberships:[]},
    {memberships:[{id:'bad id',tier:'Bronze',price:499,perks:[],note:''}]},
    {memberships:[{id:'m1',tier:'',price:499,perks:[],note:''}]},
    {memberships:[{id:'m1',tier:'Bronze',price:-1,perks:[],note:''}]},
    {memberships:[{id:'m1',tier:'Bronze',price:499,perks:[''],note:''}]},
    {bookingTables:[]},
    {bookingTables:[{id:'t1',label:'',pricePerHour:400,memberPricePerHour:300}]},
    {bookingTables:[{id:'t1',label:'T1',pricePerHour:-1,memberPricePerHour:300}]},
    {bookingTables:[{id:'t1',label:'T1',pricePerHour:400,memberPricePerHour:300,requests:[]}]},
  ]) assert.throws(()=>contentPatch(before,changes),expectCode('INVALID_CONTENT_PATCH'));
});

test('public CMS projection exposes only public membership and rate fields',()=>{
  const state={
    memberships:[{id:'m1',tier:'Gold',price:1499,perks:['A'],note:'N',secret:'PRIVATE'}],
    booking:{tables:[{id:'t1',label:'T1',pricePerHour:400,memberPricePerHour:300,secret:'PRIVATE'}],requests:[{mobile:'PRIVATE'}]},
  };
  const projected=publicContent(state);
  assert.deepEqual(projected.memberships,[{id:'m1',tier:'Gold',price:1499,perks:['A'],note:'N'}]);
  assert.deepEqual(projected.bookingTables,[{id:'t1',label:'T1',pricePerHour:400,memberPricePerHour:300}]);
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
});


test('QShop CMS edits public catalogue fields while preserving stock, identity and private fields',()=>{
  const before={
    shopCatalog:{
      heading:'The Q Shop',topLabel:'Club essentials',description:'Old',badge1:'New',badge2:'Members',updatedAt:'keep-catalog',
      items:[{id:'shop_1',name:'Cue Tip',desc:'Old',price:99,badge:'Popular',amazonUrl:'https://example.com/old',img:'/old.jpg',images:['/old.jpg'],optionGroupLabel:'Colour',stock:7,private:'keep-item',options:[{id:'opt_1',label:'Red',img:'/red.jpg',stock:3,private:'keep-option'}]}],
    },
    paymentOrders:[{id:'paid-private'}],
  };
  const patch={heading:'Q Shop',topLabel:'Essentials',description:'Updated',badge1:'New',badge2:'Club',items:[{id:'shop_1',name:'Premium Cue Tip',desc:'Updated product',price:129.5,badge:'Best seller',amazonUrl:'https://example.com/new',img:'/new.jpg',images:['/new.jpg','https://example.com/gallery.jpg'],optionGroupLabel:'Colour',options:[{id:'opt_1',label:'Crimson',img:'/crimson.jpg'}]}]};
  const next=contentPatch(before,{shopCatalog:patch});
  assert.equal(next.shopCatalog.items[0].price,129.5);
  assert.equal(next.shopCatalog.items[0].stock,7);
  assert.equal(next.shopCatalog.items[0].private,'keep-item');
  assert.equal(next.shopCatalog.items[0].options[0].stock,3);
  assert.equal(next.shopCatalog.items[0].options[0].private,'keep-option');
  assert.equal(next.shopCatalog.updatedAt,'keep-catalog');
  assert.deepEqual(next.paymentOrders,before.paymentOrders);
  const projected=publicContent(next).shopCatalog;
  assert.equal(projected.items[0].name,'Premium Cue Tip');
  assert.equal(projected.items[0].options[0].label,'Crimson');
  assert.ok(!JSON.stringify(projected).includes('stock'));
  assert.ok(!JSON.stringify(projected).includes('keep-item'));

  for(const shopCatalog of [
    {...patch,items:[]},
    {...patch,items:[{...patch.items[0],id:'different'}]},
    {...patch,items:[{...patch.items[0],stock:999}]},
    {...patch,items:[{...patch.items[0],price:0}]},
    {...patch,items:[{...patch.items[0],price:12.345}]},
    {...patch,items:[{...patch.items[0],amazonUrl:'javascript:alert(1)'}]},
    {...patch,items:[{...patch.items[0],images:['//evil.example/x']}]},
    {...patch,items:[{...patch.items[0],options:[]}]},
    {...patch,items:[{...patch.items[0],options:[{...patch.items[0].options[0],stock:9}]}]},
  ]) assert.throws(()=>contentPatch(before,{shopCatalog}),expectCode('INVALID_CONTENT_PATCH'));
});


test('expanded club CMS exposes only approved presentation text and preserves operational fields',()=>{
  const before={
    club:{
      name:'Q Club',bookPageTitle:'Book a Table',membershipPageSubtitle:'Join the room',
      heroBookBtnLabel:'Book now',footerDescription:'Play. Chill. Compete.',
      upiId:'PRIVATE-UPI',tvShowcaseMode:'PRIVATE-MEDIA',isOpenNow:true,privateSetting:'PRIVATE',
    },
    paymentOrders:[{id:'keep-payment'}],
  };
  const next=contentPatch(before,{club:{
    bookPageTitle:'Reserve your table',
    membershipPageSubtitle:'Membership made simple',
    heroBookBtnLabel:'Reserve',
    footerDescription:'The coolest place in the oldest town.',
  }});
  assert.equal(next.club.bookPageTitle,'Reserve your table');
  assert.equal(next.club.upiId,'PRIVATE-UPI');
  assert.equal(next.club.tvShowcaseMode,'PRIVATE-MEDIA');
  assert.equal(next.club.isOpenNow,true);
  assert.deepEqual(next.paymentOrders,before.paymentOrders);
  const projected=publicContent(next).club;
  assert.equal(projected.bookPageTitle,'Reserve your table');
  assert.equal(projected.heroBookBtnLabel,'Reserve');
  assert.equal(projected.upiId,undefined);
  assert.equal(projected.tvShowcaseMode,undefined);
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
  for(const changes of [
    {club:{upiId:'x@y'}},{club:{musicUrl:'javascript:alert(1)'}},{club:{isOpenNow:'false'}},
    {club:{bookPageTitle:4}},{club:{contactContent:'x'.repeat(30001)}},
  ]) assert.throws(()=>contentPatch(before,changes),expectCode('INVALID_CONTENT_PATCH'));
});


test('hero and media CMS validates URLs, preserves storage and excludes TV controls',()=>{
  const before={
    club:{
      heroSlides:['/hero/a.jpg','https://example.com/b.jpg'],
      liveStreamUrl:'https://example.com/live',videoUrl:'',musicUrl:'',
      tvCustomSlides:['PRIVATE-TV'],tvShowcaseMode:'PRIVATE-TV-MODE',upiId:'PRIVATE-UPI',
    },
  };
  const next=contentPatch(before,{
    club:{liveStreamUrl:'https://example.com/new-live',videoUrl:'/media/intro.mp4',musicUrl:'https://example.com/music'},
    heroSlides:['https://example.com/new-hero.jpg','/hero/local.jpg'],
  });
  assert.deepEqual(next.club.heroSlides,['https://example.com/new-hero.jpg','/hero/local.jpg']);
  assert.equal(next.club.liveStreamUrl,'https://example.com/new-live');
  assert.deepEqual(next.club.tvCustomSlides,['PRIVATE-TV']);
  assert.equal(next.club.tvShowcaseMode,'PRIVATE-TV-MODE');
  assert.equal(next.club.upiId,'PRIVATE-UPI');
  const projected=publicContent(next).club;
  assert.deepEqual(projected.heroSlides,next.club.heroSlides);
  assert.equal(projected.videoUrl,'/media/intro.mp4');
  assert.equal(projected.tvShowcaseMode,undefined);
  for(const changes of [
    {heroSlides:[]},
    {heroSlides:['javascript:alert(1)']},
    {heroSlides:['/same.jpg','/same.jpg']},
    {heroSlides:Array.from({length:31},(_,i)=>`/hero/${i}.jpg`)},
    {club:{liveStreamUrl:'http://insecure.example.com/live'}},
    {club:{videoUrl:'//evil.example.com/video'}},
  ]) assert.throws(()=>contentPatch(before,changes),expectCode('INVALID_CONTENT_PATCH'));
});


test('theme CMS validates presentation tokens and preserves operational/private state',()=>{
  const before={
    theme:{accent:'#D9C683',background:'#0D1715',surface:'#15241E',text:'#E8EEE9',mutedText:'#A9BCB3',border:'#304038',private:'KEEP'},
    club:{tvShowcaseMode:'KEEP-TV'},
    booking:{requests:[{id:'keep-booking'}]},
    paymentOrders:[{id:'keep-payment'}],
    players:[{id:'keep-player'}],
  };
  const next=contentPatch(before,{theme:{accent:'#C8A95A',background:'#101815',surface:'#192720',text:'#F3F2E8',mutedText:'#B1B8AE',border:'#3D4A42'}});
  assert.deepEqual(publicContent(next).theme,{accent:'#C8A95A',background:'#101815',surface:'#192720',text:'#F3F2E8',mutedText:'#B1B8AE',border:'#3D4A42'});
  assert.equal(next.theme.private,'KEEP');
  assert.equal(next.club.tvShowcaseMode,'KEEP-TV');
  assert.deepEqual(next.booking.requests,before.booking.requests);
  assert.deepEqual(next.paymentOrders,before.paymentOrders);
  assert.deepEqual(next.players,before.players);
  assert.ok(!JSON.stringify(publicContent(next)).includes('KEEP'));
  for(const theme of [
    {},
    {accent:'#fff',background:'#000000',surface:'#111111',text:'#FFFFFF',mutedText:'#AAAAAA',border:'#222222'},
    {accent:'red',background:'#000000',surface:'#111111',text:'#FFFFFF',mutedText:'#AAAAAA',border:'#222222'},
    {accent:'#FFFFFF',background:'#000000',surface:'#111111',text:'#FFFFFF',mutedText:'#AAAAAA',border:'#222222',secret:'#123456'},
  ]) assert.throws(()=>contentPatch(before,{theme}),expectCode('INVALID_CONTENT_PATCH'));
});
