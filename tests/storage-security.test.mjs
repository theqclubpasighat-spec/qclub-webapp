import test from 'node:test';
import assert from 'node:assert/strict';
import {storageTransport,signApplicantFiles,canonicalApplications,applicantPath} from '../src/server/security/storage.js';
const req=(body,headers={})=>({method:'POST',body,headers,socket:{remoteAddress:'127.0.0.1'}});
function db(role='ADMIN',accepting=true) {
 const calls=[];
 const client = {
  calls,
  from() { return {
   select(){return this}, eq(){return this},
   async maybeSingle(){return {data:{id:'session',role,expires_at:new Date(Date.now()+60000).toISOString()}}},
   async single(){return {data:{state:{jobSettings:{acceptingApplications:accepting}}}}},
  }; },
  rpc:async()=>({data:{allowed:true}}),
  storage:{from(bucket){return {
   async createSignedUploadUrl(path,opts){calls.push({bucket,path,opts});return {data:{token:'fixture'}}},
   getPublicUrl(path){return {data:{publicUrl:'https://example.com/'+path}}},
   async remove(paths){calls.push({bucket,paths});return {}},
   async createSignedUrls(paths){return {data:paths.map(path=>({path,signedUrl:'https://example.com/signed/'+path}))}},
  };}},
 }; return client;
}
const headers={authorization:'Bearer snk_'+'a'.repeat(43)};
test('anonymous public upload and delete are rejected before storage access',async()=>{
 const d=db();for(const body of [{folder:'gallery',type:'image/png',size:10},{action:'delete',path:'gallery/file.png'}])await assert.rejects(storageTransport(d,req(body)),e=>e.status===401);assert.equal(d.calls.length,0);
});
test('staff and committee cannot mutate public media',async()=>{
 for(const role of ['STAFF','COMMITTEE'])await assert.rejects(storageTransport(db(role),req({folder:'menu-items',type:'image/png',size:10},headers)),e=>e.status===403);
});
test('admin receives a new bounded non-overwriting upload path',async()=>{
 const d=db();const r=await storageTransport(d,req({folder:'menu-items',type:'image/png',size:10},headers));assert.equal(r.bucket,'photos');assert.match(r.path,/^menu-items\/[a-f0-9-]+\.png$/);assert.equal(d.calls[0].opts.upsert,false);
});
test('path traversal, private deletion, invalid MIME and oversized files fail',async()=>{
 for(const body of [{action:'delete',path:'gallery/../job-applications/file.png'},{action:'delete',path:'job-applications/photos/a.png'},{folder:'gallery',type:'text/html',size:10},{folder:'job-applications/pan',type:'application/pdf',size:4*1024*1024}])await assert.rejects(storageTransport(db(),req(body,headers)),e=>[400,413].includes(e.status));
});
test('applicant uploads use private storage and no public URL',async()=>{
 const d=db();const r=await storageTransport(d,req({folder:'job-applications/pan',type:'application/pdf',size:10}));assert.equal(r.bucket,'qclub-applicant-documents');assert.equal(r.url,'');
});
test('closed applications and rate limit fail closed',async()=>{
 await assert.rejects(storageTransport(db('ADMIN',false),req({folder:'job-applications/pan',type:'application/pdf',size:10})),e=>e.status===403);
 const d=db();d.rpc=async()=>({data:{allowed:false}});await assert.rejects(storageTransport(d,req({folder:'job-applications/pan',type:'application/pdf',size:10})),e=>e.status===429);assert.equal(d.calls.length,0);
});
test('legacy document URLs are replaced with temporary private links and never persisted',async()=>{
 const app={photo:{path:'job-applications/photos/123-abc.jpg',url:'https://public.example/file'}};
 const state=await signApplicantFiles(db(),{jobApplications:[structuredClone(app)]});assert.match(state.jobApplications[0].photo.url,/signed/);assert.equal(canonicalApplications(state.jobApplications)[0].photo.url,'');assert.equal(applicantPath({path:'job-applications/photos/../bad.jpg'}),null);
});
