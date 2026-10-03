-- Rehearsal-only role correction. Committee credentials must not inherit ADMIN authority.
create or replace function public.qclub_security_create_session(
  p_credential_id text,
  p_version integer,
  p_token_hash text,
  p_expires_at timestamptz,
  p_device_id text,
  p_client_version text
)
returns boolean language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v integer;
  session_role text;
  staff text;
  label text;
begin
  select version into v
    from qclub_private.credentials
    where credential_id=p_credential_id
    for share;
  if v is null or v is distinct from p_version then return false; end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_token_hash is null or p_expires_at is null
     or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '72 hours' then
    return false;
  end if;

  session_role := case p_credential_id
    when 'main' then 'ADMIN'
    when 'staff' then 'STAFF'
    when 'committee' then 'COMMITTEE'
  end;
  staff := case p_credential_id
    when 'main' then 'admin-main'
    when 'staff' then 'staff-game-marshall'
    when 'committee' then 'admin-committee'
  end;
  label := case p_credential_id
    when 'main' then 'Q Club Admin'
    when 'staff' then 'Game Marshall'
    when 'committee' then 'Committee Admin'
  end;
  if session_role is null or staff is null then return false; end if;

  insert into public.snooker_auth_sessions(
    token_hash,role,staff_id,display_name,expires_at,device_id,client_version
  ) values(
    p_token_hash,session_role,staff,label,p_expires_at,p_device_id,p_client_version
  );
  return true;
end $$;

revoke all on function public.qclub_security_create_session(text,integer,text,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.qclub_security_create_session(text,integer,text,timestamptz,text,text)
  to service_role;
