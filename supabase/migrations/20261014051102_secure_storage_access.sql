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
-- Public image URLs continue working. Restrictive policies are ANDed with
-- permissive policies, so existing broad grants cannot permit client mutations.
-- Keep the old policy definitions for a reversible, additive cutover.
do $$
begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='photos require server authorization') then
  create policy "photos require server authorization" on storage.objects
   as restrictive for all to anon, authenticated
   using (bucket_id <> 'photos') with check (bucket_id <> 'photos');
 end if;
end $$;
