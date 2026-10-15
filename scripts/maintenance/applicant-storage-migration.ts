// One-off Q Club migration. Deploy only with a fresh SHA-256 capability digest
// and a short deadline; retire to HTTP 410 immediately after verification.
import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
const TOKEN_HASH = 'MIGRATION_TOKEN_HASH';
const DEADLINE = MIGRATION_DEADLINE;
const DEST = 'qclub-applicant-documents';
const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async req => {
 if(req.method!=='POST'||Date.now()>DEADLINE||await hash(new TextEncoder().encode(req.headers.get('x-migration-token')||'').buffer)!==TOKEN_HASH) return new Response('Forbidden',{status:403});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try {
  const body=await req.json();
  if(body.action==='setup') {
   const existing=await db.storage.getBucket(DEST);
   if(!existing.data) {const r=await db.storage.createBucket(DEST,{public:false,fileSizeLimit:3*1024*1024,allowedMimeTypes:['image/jpeg','image/png','application/pdf']});if(r.error)throw Error('CREATE_FAILED');}
   else if(existing.data.public)throw Error('DESTINATION_NOT_PRIVATE');
   return Response.json({ok:true});
  }
  if(!['copy','remove','verify'].includes(body.action))return new Response('Invalid action',{status:400});
  const offset=Number(body.offset||0);
  if(!Number.isInteger(offset)||offset<0||offset>1000)return new Response('Invalid offset',{status:400});
  // Removal always processes the first remaining batch. No arbitrary bucket/path input.
  const names=[];
  for(const folder of ['aadhaar','pan','photos']) {
   const prefix='job-applications/'+folder;
   const result=await db.storage.from('photos').list(prefix,{limit:1000,sortBy:{column:'name',order:'asc'}});
   if(result.error)throw Error('LIST_FAILED');
   for(const item of result.data||[])if(item.id)names.push(prefix+'/'+item.name);
  }
  names.sort();
  const start=body.action==='remove'?0:offset;
  const listing={data:names.slice(start,start+5).map(name=>({name}))};
  let verified=0,removed=0;
  for(const row of listing.data||[]) {
   const path=row.name;
   if(!/^job-applications\/(photos|aadhaar|pan)\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|pdf)$/i.test(path))throw Error('UNEXPECTED_PATH');
   const source=await db.storage.from('photos').download(path);
   if(source.error||!source.data)throw Error('SOURCE_READ_FAILED');
   let target=await db.storage.from(DEST).download(path);
   if((target.error||!target.data)&&body.action==='copy') {
    const copied=await db.storage.from('photos').copy(path,path,{destinationBucket:DEST});
    if(copied.error)throw Error('COPY_FAILED');
    target=await db.storage.from(DEST).download(path);
   }
   if(target.error||!target.data)throw Error('PRIVATE_COPY_MISSING');
   if(source.data.size!==target.data.size||await hash(await source.data.arrayBuffer())!==await hash(await target.data.arrayBuffer()))throw Error('CHECKSUM_MISMATCH');
   verified++;
   if(body.action==='remove') {
    const result=await db.storage.from('photos').remove([path]);if(result.error)throw Error('REMOVE_FAILED');removed++;
   }
  }
  return Response.json({ok:true,verified,removed});
 } catch(e) { return Response.json({ok:false,error:e instanceof Error?e.message:'FAILED'},{status:500}); }
});
