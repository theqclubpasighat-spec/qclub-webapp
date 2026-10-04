// CI-only fixture exercising real public components without production APIs.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
if(process.env.QCLUB_BROWSER_FIXTURES!=='enabled'||!process.env.QCLUB_AGENT_BROWSER||process.env.VERCEL_ENV==='production')throw Error('Explicit local fixture configuration required');
const root=await mkdtemp(path.resolve('.qclub-public-ui-'));
const artifacts=path.resolve('browser-artifacts');await mkdir(artifacts,{recursive:true});
await writeFile(path.join(root,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
await writeFile(path.join(root,'main.jsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import {TopNav,FooterLinks} from '../src/components/layout-shell.jsx';import V2Home from '../src/v2-live/V2Home.jsx';import '../src/v2-live/v2-live.css';
window.__uiErrors=[];addEventListener('error',e=>window.__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__uiErrors.push(String(e.reason)));
if(location.search.includes('reduced')){const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true,addEventListener(){},removeEventListener(){}}:original(q);}
const data={club:{name:'The Q CLUB Pasighat',tagline:'Play. Chill. Compete.',location:'Pasighat'},announcements:[{id:'first',text:'First fixture announcement',link:'/fixtures'},{id:'second',text:'Second fixture announcement',link:'/tournaments'},{id:'expired',text:'Expired fixture announcement',expiresAt:'2020-01-01'}],memberships:[]};
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><TopNav club={data.club} admin={location.search.includes('admin')}/><Routes><Route path="/" element={<V2Home data={data}/>}/><Route path="*" element={<main>Fixture destination</main>}/></Routes><FooterLinks data={data}/></BrowserRouter></React.StrictMode>);`);
const server=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:5185,strictPort:true,fs:{allow:[process.cwd()]}},esbuild:{jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}});
const run=promisify(execFile),session=`qclub-public-ui-${process.pid}`;
async function browser(...args){const {stdout}=await run(process.env.QCLUB_AGENT_BROWSER,['--session',session,'--allowed-domains','127.0.0.1','--json',...args],{timeout:45000,maxBuffer:2*1024*1024});const result=JSON.parse(stdout);if(!result.success)throw Error(JSON.stringify(result));return result.data;}
async function evaluate(source){return (await browser('eval',source)).result;}
const button=name=>browser('find','role','button','click','--name',name);
try{
 await server.listen();await browser('open','http://127.0.0.1:5185');await browser('wait','--text','Your time at The Q Club');
 assert.equal(await evaluate('!document.querySelector("vite-error-overlay")'),true);
 for(const width of [320,360,390,430,1280]){
  await browser('set','viewport',String(width),'800');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`Overflow at ${width}`);
  assert.equal(await evaluate('document.querySelector(".v2-live-menu-button").textContent.trim()'),'', 'Hamburger should be an icon');
  assert.equal(await evaluate('document.body.innerText.includes("endless scroll")'),false);
  await browser('screenshot',path.join(artifacts,`public-home-${width}.png`),'--full');
  await button('Open menu');await browser('wait','dialog[open]');
  assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Close menu');
  assert.equal(await evaluate('document.querySelector("dialog").getBoundingClientRect().right<=innerWidth'),true);
  assert.equal(await evaluate('document.querySelector("dialog").getBoundingClientRect().width<=320'),true);
  assert.equal(await evaluate('document.querySelector("dialog").innerText.includes("Website Manager")'),false,'Admin link must be absent for public');
  for(let i=0;i<35;i++){await browser('press','Tab');assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'),true,'Focus escapes drawer');}
  await browser('screenshot',path.join(artifacts,`public-drawer-${width}.png`));
  await browser('press','Escape');assert.equal(await evaluate('document.querySelector("dialog").open'),false);
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Open menu');
  assert.equal(await evaluate('document.body.style.overflow'),'');
 }
 await browser('set','viewport','360','800');await browser('reload');await browser('wait','--text','First fixture announcement');
 await browser('wait',6500);assert.equal(await evaluate('document.querySelector(".v2-live-ticker-text").textContent'),'Second fixture announcement');
 await button('Previous announcement');assert.equal(await evaluate('document.querySelector(".v2-live-ticker-text").textContent'),'First fixture announcement');
 await browser('wait',6500);assert.equal(await evaluate('document.querySelector(".v2-live-ticker-text").textContent'),'First fixture announcement','Rotation must pause while controls have focus');
 await button('Open menu');await browser('wait','dialog[open] a[href="/fixtures"]');await browser('wait',300);await browser('click','dialog[open] a[href="/fixtures"]');assert.equal(await evaluate('location.pathname'),'/fixtures');assert.equal(await evaluate('document.querySelector("dialog").open'),false);
 await browser('open','http://127.0.0.1:5185/?reduced');await browser('wait','--text','First fixture announcement');await browser('wait',6500);assert.equal(await evaluate('document.querySelector(".v2-live-ticker-text").textContent'),'First fixture announcement','Reduced-motion must disable rotation');
 await browser('open','http://127.0.0.1:5185/?admin');await button('Open menu');assert.equal(await evaluate('document.querySelector("dialog").innerText.includes("Website Manager")'),true);
 assert.deepEqual(await evaluate('window.__uiErrors'),[]);
 await writeFile(path.join(artifacts,'public-ui-result.json'),JSON.stringify({passed:true,widths:[320,360,390,430,1280],checks:['no overflow','hamburger','right drawer','focus containment','Escape dismissal','focus restoration','scroll unlock','navigation dismissal','role visibility','automatic ticker','manual ticker','focus pause','reduced motion']},null,2));
 console.log('Public UI browser verification passed. Synthetic data only.');
}catch(error){try{await browser('screenshot',path.join(artifacts,'public-ui-failure.png'),'--full');console.error(await browser('snapshot','-i'));}catch{}throw error;
}finally{try{await browser('close');}finally{await server.close();await rm(root,{recursive:true,force:true});}}
