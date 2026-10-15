-- Apply after the protected storage transport is deployed and applicant bytes
-- have been copied and checksum-verified with the maintenance helper.
do $$
begin
 if not exists(select 1 from storage.buckets where id='qclub-applicant-documents' and public=false) then
  raise exception 'Private applicant bucket must exist before cutover';
 end if;
 if exists(select 1 from storage.objects s where s.bucket_id='photos' and s.name like 'job-applications/%' and not exists(select 1 from storage.objects d where d.bucket_id='qclub-applicant-documents' and d.name=s.name and d.metadata->>'size'=s.metadata->>'size')) then
  raise exception 'Every applicant object requires a matching private copy';
 end if;
end $$;
-- Public images remain accessible by URL. Listing and mutations now require
-- the server transport, which authorizes administrators before using storage.
drop policy if exists "public can view photos" on storage.objects;
drop policy if exists "public can upload photos" on storage.objects;
drop policy if exists "public can update photos" on storage.objects;
drop policy if exists "public can delete photos" on storage.objects;
