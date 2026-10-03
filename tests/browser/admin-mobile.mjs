// CI-only mobile UI verification against a disposable Postgres security handler.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { createFixtureDatabase } from '../support/rehearsal-db.mjs';
import { createSecurityHandler } from '../../src/server/security/handler.js';
if(process.env.QCLUB_BROWSER_FIXTURES!=='enabled'||!process.env.QCLUB_AGENT_BROWSER||process.env.VERCEL_ENV==='production')throw Error('Explicit local fixture configuration required');
process.env.QCLUB_SECURITY_REHEARSAL='enabled';process.env.VERCEL_ENV='preview';
const artifacts=path.resolve('browser-artifacts');await mkdir(artifacts,{recursive:true});
const fixture=await createFixtureDatabase();
const handler=createSecurityHandler({env:{QCLUB_SECURITY_REHEARSAL:'enabled',QCLUB_SECURITY_SUPABASE_URL:'http://127.0.0.1:54321',QCLUB_SECURITY_SERVICE_ROLE_KEY:'synthetic-local-only'},createDatabase:()=>fixture.db});
const state=async()=>(await fixture.pg.query("select state from public.qclub_state where key='main'")).rows[0].state;
const original=await state();
const requests=[];
const server=await createServer({server:{host:'127.0.0.1',port:5184,strictPort:true},plugins:[{
 name:'ci-only-admin-database',
 transformIndexHtml(html){
  const external='<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>';
  if(!html.includes(external))throw Error('External SDK replacement no longer matches HTML');
  return html.replace(external,`<script>window.__qclubErrors=[];addEventListener('error',e=>window.__qclubErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qclubErrors.push(String(e.reason)));</script>`);
 },
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/qclub-checkout-rehearsal'||!req.url?.includes('scope=security'))return next();
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>150000){res.statusCode=413;res.end();return;}}
   req.body=raw?JSON.parse(raw):undefined;req.query=Object.fromEntries(new URL(req.url,'http://127.0.0.1').searchParams);
   res.on('finish',()=>requests.push({action:req.query.action,method:req.method,status:res.statusCode}));
   res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
   await handler(req,res);
  }catch(error){console.error(error);res.statusCode=500;res.end('{}');}
 });},
}]});
const run=promisify(execFile),session=`qclub-admin-${process.pid}`;
async function browser(...args){const {stdout}=await run(process.env.QCLUB_AGENT_BROWSER,['--session',session,'--allowed-domains','127.0.0.1','--json',...args],{timeout:45000,maxBuffer:2*1024*1024});const result=JSON.parse(stdout);if(!result.success)throw Error(JSON.stringify(result));return result.data;}
const evaluate=async source=>(await browser('eval',source)).result;
async function button(name){
 const data=await browser('snapshot','-i');
 const ref=Object.entries(data.refs).find(([,value])=>value.role==='button'&&value.name===name)?.[0];
 if(!ref)throw Error(`Button not found: ${name}`);
 return browser('click',`@${ref}`);
}
async function snapshot(name){await writeFile(path.join(artifacts,`admin-${name}.json`),JSON.stringify(await browser('snapshot','-i'),null,2));}
async function layout(name){
 assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'Horizontal overflow');
 assert.equal(await evaluate('!document.querySelector("vite-error-overlay")'),true,'Vite error overlay');
 assert.equal(await evaluate('document.body.innerText.trim().length > 50'),true,'Blank page');
 assert.equal(await evaluate('!document.body.innerText.includes("PRIVATE-FIXTURE")'),true,'Private operational content exposed');
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("button,input,textarea")).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.width<44||r.height<44)}).map(e=>e.id||e.textContent)'),[],'Small touch targets');
 assert.deepEqual(await evaluate('window.__qclubErrors'),[]);
 await browser('screenshot',path.join(artifacts,`admin-${name}.png`),'--full');await snapshot(name);
}
async function login(pin){await browser('fill','#pin',pin);await button('Sign in');}
async function save(){await button('Save changes');await browser('wait','--text','Changes saved to the rehearsal website.');await snapshot('saved');}
try{
 await server.listen();await browser('open','http://127.0.0.1:5184/__admin-preview');
 await browser('wait','#pin');await browser('wait','--load','networkidle');await snapshot('initial');await layout('login');
 await login('761239');await browser('wait','#name');await snapshot('signed-in');
 for(const width of [360,390,430]){await browser('set','viewport',String(width),'780');await layout(`club-${width}`);}
 await browser('set','viewport','360','780');await browser('fill','#name','Mobile CMS fixture');await save();
 assert.equal((await state()).club.name,'Mobile CMS fixture');
 await button('About & policies');await browser('wait','#aboutContent');await layout('policies-360');
 await button('Food page');await browser('wait','#title');await browser('fill','#subtitle','A mobile-friendly kitchen break.');await save();await layout('food-360');
 await button('Notices');await browser('wait','--text','No public notices yet.');await button('Add notice');await browser('wait','textarea');await snapshot('new-notice');
 await browser('fill','textarea','Practice night starts at 6 pm.');await browser('fill','input','/fixtures');await save();await layout('notices-360');
 await button('Membership tiers');await browser('wait','--text','Membership tiers');await browser('fill','input[type="number"]','599');await save();await layout('memberships-360');
 await button('Table rates');await browser('wait','--text','Table rates');await browser('fill','input[type="number"]','450');await save();await layout('rates-360');
 await button('QShop catalogue');await browser('wait','--text','QShop catalogue');await browser('fill','input[type="number"]','129');await save();await layout('qshop-360');
 const after=await state();assert.equal(after.foodPage.subtitle,'A mobile-friendly kitchen break.');assert.equal(after.announcements.filter(x=>x.type==='notice').length,1);assert.equal(after.memberships[0].price,599);assert.equal(after.booking.tables[0].pricePerHour,450);assert.equal(after.shopCatalog.items[0].price,129);assert.equal(after.shopCatalog.items[0].stock,original.shopCatalog.items[0].stock);assert.equal(after.shopCatalog.items[0].options[0].stock,original.shopCatalog.items[0].options[0].stock);
 for(const key of ['admin','paymentOrders','players'])assert.deepEqual(after[key],original[key],`${key} changed`);
 assert.deepEqual(after.booking.requests,original.booking.requests,'booking requests changed');
 assert.deepEqual(after.booking.blockedSlots,original.booking.blockedSlots,'booking blocks changed');
 assert.deepEqual(after.announcements.filter(x=>x.type!=='notice'),original.announcements,'Operational announcements changed');
 await browser('scroll','up','10000');await button('Sign out');await snapshot('after-sign-out-click');await browser('wait','#pin');await snapshot('signed-out');
 assert.equal((await fixture.pg.query('select count(*)::int as n from public.snooker_auth_sessions where revoked_at is not null')).rows[0].n,1);
 await login('852147');await browser('wait','--text','Staff account');await layout('staff-360');assert.equal(await evaluate('!!document.querySelector("#name")'),false);
 await browser('scroll','up','10000');await button('Sign out');await snapshot('after-sign-out-click');await browser('wait','#pin');await login('761239');await browser('wait','--text','Club information');await button('Club information');await browser('wait','#name');await snapshot('reauthenticated');
 await browser('reload');await browser('wait','#pin');await snapshot('reload-signed-out');
 assert.equal(await evaluate('localStorage.length'),0);assert.equal(await evaluate('sessionStorage.length'),0);
 await login('761239');await browser('wait','#name');await browser('fill','#tagline','My unsaved mobile draft');
 await fixture.pg.query("update public.qclub_state set state=jsonb_set(state,'{club,tagline}','\"Another admin saved this\"'),updated_at=clock_timestamp() where key='main'");
 await button('Save changes');await browser('wait','--text','Someone else updated the website.');await snapshot('conflict');
 assert.equal(await evaluate('document.querySelector("#tagline").value'),'My unsaved mobile draft');
 assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="Save changes").disabled'),true);
 await button('Load latest for comparison');await browser('wait','--text','Another admin saved this');await layout('conflict-360');
 assert.equal(await evaluate('document.querySelector("#tagline").value'),'My unsaved mobile draft');assert.equal((await state()).club.tagline,'Another admin saved this');
 await writeFile(path.join(artifacts,'admin-result.json'),JSON.stringify({passed:true,widths:[360,390,430],disposablePostgres:true,checks:['layout','touch targets','content save','notice save','membership tier save','table rate save','QShop catalogue save','QShop stock preservation','private data preservation','server logout revocation','staff restriction','memory-only session','conflict draft retention','latest comparison']},null,2));
 console.log('Mobile CMS browser verification passed against disposable Postgres. No production database used.');
}catch(error){await writeFile(path.join(artifacts,'admin-requests.json'),JSON.stringify(requests,null,2));try{await browser('screenshot',path.join(artifacts,'admin-failure.png'),'--full');await snapshot('failure');await writeFile(path.join(artifacts,'admin-console.json'),JSON.stringify(await browser('console')));}catch{}throw error;}
finally{try{await browser('close');}finally{await server.close();await fixture.close();}}
