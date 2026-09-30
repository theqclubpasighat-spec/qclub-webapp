// CI-only synthetic browser harness. Never import this from an API or app entry.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

if(process.env.QCLUB_BROWSER_FIXTURES!=='enabled' || !process.env.QCLUB_AGENT_BROWSER || process.env.VERCEL_ENV==='production')throw Error('Explicit local fixture configuration required');
process.env.QCLUB_SECURITY_REHEARSAL='enabled';
process.env.VERCEL_ENV='preview';
const artifacts=path.resolve('browser-artifacts');await mkdir(artifacts,{recursive:true});
const intents=new Map(),closed=new Set(),creations=[];
let rejectNext=false,unavailable=false;
const sdk=`<script>
window.__qclubErrors=[];
addEventListener('error',event=>window.__qclubErrors.push(event.message));
addEventListener('unhandledrejection',event=>window.__qclubErrors.push(String(event.reason)));
window.Cashfree=({mode})=>{if(mode!=='sandbox')throw Error('Unexpected payment mode');return {checkout:async({paymentSessionId,redirectTarget})=>{if(redirectTarget!=='_modal')throw Error('Unexpected payment target');const response=await fetch('/__fixture/paid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:paymentSessionId})});if(!response.ok)throw Error('Fixture payment failed');}}};
</script>`;
const server=await createServer({server:{host:'127.0.0.1',port:5183,strictPort:true},plugins:[{
 name:'ci-only-checkout-fixtures',
 transformIndexHtml(html){
  const external='<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>';
  if(!html.includes(external))throw Error('SDK fixture replacement no longer matches HTML');
  return html.replace(external,sdk);
 },
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const route=req.url?.split('?')[0];
  if(!route?.startsWith('/api/')&&route!=='/__fixture/paid')return next();
  const reply=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Fixture body too large');}
   const body=raw?JSON.parse(raw):{};
   if(route==='/api/qclub-menu-rehearsal')return reply(200,{items:[...(!unavailable?[{id:'momo',name:'Momo',price:80,category:'Food'}]:[]),{id:'tea',name:'Tea',price:30,category:'Drinks'}]});
   if(route==='/api/qclub-checkout-rehearsal'){
    const id=`qcr_${body.checkoutId}`;creations.push(id);
    if(closed.has(id))return reply(409,{error:'CHECKOUT_CLOSED'});
    if(rejectNext){rejectNext=false;unavailable=true;return reply(409,{error:'ITEM_UNAVAILABLE'});}
    if(!intents.has(id))intents.set(id,{receipt:body.receiptToken,state:'pending'});
    return reply(200,{state:'ready',orderId:id,amountPaise:16000,paymentSessionId:id});
   }
   if(route==='/api/qclub-payment-rehearsal'){
    const order=intents.get(body.orderId);if(!order||order.receipt!==body.receiptToken)return reply(404,{error:'ORDER_NOT_FOUND'});
    return reply(200,{state:order.state,orderId:body.orderId});
   }
   if(route==='/api/qclub-checkout-recovery-rehearsal'){
    const id=`qcr_${body.checkoutId}`;if(!intents.has(id))closed.add(id);
    return reply(200,{state:intents.has(id)?'existing':'closed',orderId:id});
   }
   if(route==='/__fixture/paid'){
    const order=intents.get(body.orderId);if(!order)return reply(404,{});
    order.state='fulfilled';return reply(200,{ok:true});
   }
   return reply(404,{error:'NO_FIXTURE'});
  }catch{return reply(500,{error:'FIXTURE_ERROR'});}
 });},
}]});
const run=promisify(execFile),session=`qclub-mobile-${process.pid}`;
async function browser(...args){
 const {stdout}=await run(process.env.QCLUB_AGENT_BROWSER,['--session',session,'--allowed-domains','127.0.0.1','--json',...args],{timeout:45000,maxBuffer:2*1024*1024});
 const result=JSON.parse(stdout);if(!result.success)throw Error(JSON.stringify(result));return result.data;
}
async function evaluate(source){return (await browser('eval',source)).result;}
async function snapshot(name){await writeFile(path.join(artifacts,`${name}.json`),JSON.stringify(await browser('snapshot','-i'),null,2));}
async function checkLayout(name){
 assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'Horizontal overflow');
 assert.equal(await evaluate('!document.querySelector("vite-error-overlay")'),true,'Vite error overlay');
 assert.equal(await evaluate('document.body.innerText.trim().length > 50'),true,'Blank page');
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("button,input,select")).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.width<44||r.height<44)}).map(e=>e.id||e.textContent)'),[],'Small touch targets');
 await browser('screenshot',path.join(artifacts,`${name}.png`),'--full');
 await snapshot(name);
}
const button=name=>browser('find','role','button','click','--name',name);
try{
 await server.listen();
 // Verify as soon as the server starts, before carrying out the workflow.
 await browser('open','http://127.0.0.1:5183/__checkout-preview');
 await browser('wait','#food');await browser('wait','--load','networkidle');await snapshot('initial');
 for(const width of [360,390,430]){await browser('set','viewport',String(width),'780');await checkLayout(`menu-${width}`);}
 await browser('set','viewport','360','780');
 await browser('fill','#quantity','2');await button('Add to order');await browser('fill','#name','Browser Fixture');await browser('fill','#phone','9876543210');
 await button('Create test order');await browser('wait','--text','Pay in sandbox');await snapshot('ready');
 assert.equal(intents.size,1);const first=[...intents.keys()][0];
 await browser('reload');await browser('wait','--text','Resume this order');await snapshot('restored');
 await button('Resume this order');await browser('wait','--text','Pay in sandbox');await snapshot('resumed');
 assert.deepEqual(creations,[first,first],'Reload must reuse the original order');
 await button('Fix a rejected cart');await browser('wait','--text','already been created');await snapshot('existing-protected');
 await button('Check payment status');await browser('wait','--text','Payment not confirmed yet');await checkLayout('pending-360');
 await button('Resume this order');await browser('wait','--text','Pay in sandbox');await snapshot('payment-ready');
 await button('Pay in sandbox');await browser('wait','--text','Payment confirmed');await checkLayout('confirmed-360');
 await button('Start a new order');await browser('wait','#food');await snapshot('new-order');
 assert.equal(await evaluate('document.querySelector("#name").value'),'');
 assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(first)})`),true);
 rejectNext=true;
 await button('Add to order');await browser('fill','#name','Correction Fixture');await browser('fill','#phone','9876543210');
 await button('Create test order');await browser('wait','--text','no longer available');await snapshot('rejected');
 await button('Fix a rejected cart');await browser('wait','#food');await checkLayout('corrected-360');
 assert.equal(await evaluate('document.querySelector("#name").value'),'Correction Fixture');
 assert.equal(await evaluate('document.querySelectorAll(".cart-row").length'),0,'Unavailable item should be removed');
 assert.equal(await evaluate('document.querySelector(".submit").disabled'),true);
 assert.equal(closed.size,1);assert.equal(intents.size,1);assert.deepEqual(await evaluate('window.__qclubErrors'),[]);
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify({passed:true,widths:[360,390,430],syntheticPaymentsOnly:true,checks:['layout','touch targets','reload identity','existing-order protection','pending status','sandbox popup simulation','new purchase','rejected-cart correction']},null,2));
 console.log('Mobile browser fixture workflow passed at 360, 390 and 430 CSS pixels. No real gateway or production API used.');
}catch(error){
 try{await browser('screenshot',path.join(artifacts,'failure.png'),'--full');await snapshot('failure');await writeFile(path.join(artifacts,'console.json'),JSON.stringify(await browser('console')));}catch{}
 throw error;
}finally{
 try{await browser('close');}finally{await server.close();}
}
