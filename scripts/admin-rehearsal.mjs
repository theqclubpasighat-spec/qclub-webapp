// Disposable localhost server; never import this from the deployed application.
import { createServer as createVite } from 'vite';
import { createSecurityHandler } from '../src/server/security/handler.js';
import { createFixtureDatabase } from '../tests/support/rehearsal-db.mjs';
const fixture=await createFixtureDatabase();
process.env.QCLUB_SECURITY_REHEARSAL='enabled';
const handler=createSecurityHandler({env:{QCLUB_SECURITY_REHEARSAL:'enabled',QCLUB_SECURITY_SUPABASE_URL:'http://127.0.0.1:54321',QCLUB_SECURITY_SERVICE_ROLE_KEY:'synthetic-local-only'},createDatabase:()=>fixture.db});
const server=await createVite({root:new URL('..',import.meta.url).pathname,server:{host:'127.0.0.1',port:5182,strictPort:true},plugins:[{name:'local-security-api',configureServer(vite){vite.middlewares.use('/api/qclub-checkout-rehearsal',async(req,res)=>{
  try {
    let body='';for await(const chunk of req){body+=chunk;if(body.length>150000){res.statusCode=413;res.end();return;}}
    req.body=body?JSON.parse(body):undefined;req.query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
    res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    await handler(req,res);
  }catch{res.statusCode=400;res.end('{}');}
});}}]});
await server.listen();
console.log('Synthetic admin rehearsal: http://127.0.0.1:5182/__admin-preview');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();await fixture.close();process.exit(0);});
