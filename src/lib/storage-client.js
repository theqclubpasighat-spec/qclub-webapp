import { supabase } from '../supabase.js';
function adminToken() {
  try { return sessionStorage.getItem('qclub_admin_access_token_v2') || ''; } catch { return ''; }
}
async function command(body,token=adminToken()) {
  const response=await fetch('/api/snooker/v1/website/storage',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Storage request failed');
  return result;
}
export async function uploadProtectedFile(file,folder,token) {
  if(!file||!supabase)throw new Error('Storage is unavailable.');
  const permit=await command({folder,type:file.type,size:file.size},token);
  const {error}=await supabase.storage.from(permit.bucket).uploadToSignedUrl(permit.path,permit.token,file,{contentType:file.type,cacheControl:permit.bucket==='photos'?'3600':'0',upsert:false});
  if(error)throw error;
  return {bucket:permit.bucket,path:permit.path,url:permit.url};
}
export async function deleteProtectedFile(path) {
  if(path) await command({action:'delete',path});
}
