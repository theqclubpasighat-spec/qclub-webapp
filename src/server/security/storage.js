import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { authenticate, SecurityError, tokenHash } from './foundation.js';
export const PRIVATE_BUCKET = 'qclub-applicant-documents';
const PUBLIC_FOLDERS = new Set(['general','gallery','players','members','shop-items','menu-items','menu-categories','hall-of-fame','hero-slides']);
const JOB_FOLDERS = new Set(['job-applications/photos','job-applications/aadhaar','job-applications/pan']);
const TYPES = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','application/pdf':'pdf'};
const fail = (status, code) => { throw new SecurityError(status, code); };
export function applicantPath(file) {
  const path = file?.path;
  return typeof path === 'string' && /^job-applications\/(photos|aadhaar|pan)\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|pdf)$/i.test(path) ? path : null;
}
export async function signApplicantFiles(db, state) {
  const apps = state.jobApplications;
  if (!Array.isArray(apps)) return state;
  const paths = [...new Set(apps.flatMap(a => ['photo','aadhaarFile','panFile'].map(k=>applicantPath(a[k])).filter(Boolean)))];
  if (!paths.length) return state;
  const {data,error} = await db.storage.from(PRIVATE_BUCKET).createSignedUrls(paths, 900);
  if (error) fail(503,'DOCUMENT_ACCESS_UNAVAILABLE');
  const urls = new Map((data||[]).map(x=>[x.path,x.signedUrl]));
  for(const app of apps) for(const key of ['photo','aadhaarFile','panFile']) {
    const path=applicantPath(app[key]);
    if(path) app[key]={path,bucket:PRIVATE_BUCKET,url:urls.get(path)||''};
  }
  return state;
}
export function canonicalApplications(apps) {
  return apps.map(app=>{const next={...app};for(const key of ['photo','aadhaarFile','panFile']) {
    const path=applicantPath(app[key]);if(path) next[key]={path,bucket:PRIVATE_BUCKET,url:''};
  }return next;});
}
export async function storageTransport(db,req) {
  if(req.method!=='POST') fail(405,'METHOD_NOT_ALLOWED');
  if(req.headers?.['sec-fetch-site']==='cross-site') fail(403,'CROSS_SITE_REQUEST');
  const body=req.body||{};
  if(body.action==='delete') {
    await authenticate(db,req,['ADMIN']);
    const path=body.path;
    if(typeof path!=='string'||path.includes('..')||!PUBLIC_FOLDERS.has(path.split('/')[0])||!/^[-a-zA-Z0-9_/.]+$/.test(path)) fail(400,'INVALID_PATH');
    const {error}=await db.storage.from('photos').remove([path]);
    if(error) fail(503,'STORAGE_UNAVAILABLE');
    return {ok:true};
  }
  const {folder,type,size}=body;
  const job=JOB_FOLDERS.has(folder);
  if(!job&&!PUBLIC_FOLDERS.has(folder)) fail(400,'INVALID_FOLDER');
  if((job&&!['image/jpeg','image/png','application/pdf'].includes(type))||!TYPES[type]||(!job&&type==='application/pdf')||(folder==='job-applications/photos'&&!['image/jpeg','image/png'].includes(type))) fail(400,'INVALID_FILE_TYPE');
  const max=job?(folder.endsWith('/photos')?2:3)*1024*1024:20*1024*1024;
  if(!Number.isInteger(size)||size<=0||size>max) fail(413,'FILE_TOO_LARGE');
  if(job) {
    const {data,error}=await db.from('qclub_state').select('state').eq('key','main').single();
    if(error) fail(503,'STATE_UNAVAILABLE');
    if(data?.state?.jobSettings?.acceptingApplications!==true) fail(403,'APPLICATIONS_CLOSED');
    const ip=process.env.VERCEL==='1'?req.headers?.['x-forwarded-for']:req.socket?.remoteAddress;
    if(typeof ip!=='string'||!isIP(ip)) fail(503,'UPLOAD_UNAVAILABLE');
    const rate=await db.rpc('qclub_security_reserve_attempt',{p_network_hash:tokenHash('applicant-upload:'+ip)});
    if(rate.error) fail(503,'UPLOAD_UNAVAILABLE');
    if(!rate.data?.allowed) fail(429,'UPLOAD_RATE_LIMITED');
  } else await authenticate(db,req,['ADMIN']);
  const bucket=job?PRIVATE_BUCKET:'photos';
  const path=`${folder}/${randomUUID()}.${TYPES[type]}`;
  const {data,error}=await db.storage.from(bucket).createSignedUploadUrl(path,{upsert:false});
  if(error||!data?.token) fail(503,'UPLOAD_UNAVAILABLE');
  return {bucket,path,token:data.token,url:job?'':db.storage.from(bucket).getPublicUrl(path).data.publicUrl};
}
