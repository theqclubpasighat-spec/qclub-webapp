-- Additive rehearsal foundation only. Does not change existing state, credentials,
-- grants, policies, API routes or sessions. No live cutover is included.
create schema if not exists qclub_private;
revoke all on schema qclub_private from public, anon, authenticated;
grant usage on schema qclub_private to service_role;

create table qclub_private.credentials (
  credential_id text primary key check (credential_id in ('main','staff','committee')),
  pin_hash text not null check (pin_hash ~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
create table qclub_private.login_attempts (
  id uuid primary key default gen_random_uuid(),
  network_hash text not null check (network_hash ~ '^[a-f0-9]{64}$'),
  attempted_at timestamptz not null default now()
);
create index qclub_security_attempt_window on qclub_private.login_attempts (network_hash, attempted_at);
create table qclub_private.credential_audit (
  id uuid primary key default gen_random_uuid(),
  credential_id text not null,
  actor_id text not null,
  action text not null check (action in ('import','rotate')),
  created_at timestamptz not null default now()
);
alter table qclub_private.credentials enable row level security;
alter table qclub_private.login_attempts enable row level security;
alter table qclub_private.credential_audit enable row level security;
revoke all on all tables in schema qclub_private from public, anon, authenticated;
grant select, insert, update on qclub_private.credentials to service_role;
grant select, insert, delete on qclub_private.login_attempts to service_role;
grant insert on qclub_private.credential_audit to service_role;

-- SECURITY INVOKER: only the server service role can call these or use the schema.
create function public.qclub_security_credentials()
returns table(credential_id text, pin_hash text, version integer)
language sql security invoker set search_path = pg_catalog
as $$ select c.credential_id,c.pin_hash,c.version from qclub_private.credentials c $$;
revoke all on function public.qclub_security_credentials() from public, anon, authenticated;
grant execute on function public.qclub_security_credentials() to service_role;

create function public.qclub_security_reserve_attempt(p_network_hash text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  if p_network_hash is null or p_network_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_NETWORK_HASH';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_network_hash, 82917));
  delete from qclub_private.login_attempts
    where network_hash=p_network_hash and attempted_at < clock_timestamp()-interval '15 minutes';
  if (select count(*) from qclub_private.login_attempts where network_hash=p_network_hash) >= 5 then
    return jsonb_build_object('allowed',false);
  end if;
  -- Reserve BEFORE verification: simultaneous requests cannot pass a read/count race.
  insert into qclub_private.login_attempts(network_hash) values(p_network_hash);
  return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.qclub_security_reserve_attempt(text) from public, anon, authenticated;
grant execute on function public.qclub_security_reserve_attempt(text) to service_role;

create function public.qclub_security_import_credential(p_credential_id text,p_pin_hash text)
returns void language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  -- Insert only: rerunning import must never reset a subsequently rotated credential.
  insert into qclub_private.credentials(credential_id,pin_hash) values(p_credential_id,p_pin_hash);
  insert into qclub_private.credential_audit(credential_id,actor_id,action)
    values(p_credential_id,'server-import','import');
end $$;
revoke all on function public.qclub_security_import_credential(text,text) from public, anon, authenticated;
grant execute on function public.qclub_security_import_credential(text,text) to service_role;

create function public.qclub_security_rotate_credential(p_actor_token_hash text,p_credential_id text,p_expected_version integer,p_pin_hash text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  actor_id text;
  changed_version integer;
  target_staff_id text;
begin
  select s.staff_id into actor_id from public.snooker_auth_sessions s
    where s.token_hash=p_actor_token_hash and s.role='ADMIN' and s.staff_id='admin-main'
      and s.revoked_at is null and s.expires_at > clock_timestamp()
    for update;
  if actor_id is null then return jsonb_build_object('ok',false); end if;
  target_staff_id := case p_credential_id when 'main' then 'admin-main'
    when 'staff' then 'staff-game-marshall' when 'committee' then 'admin-committee' end;
  if target_staff_id is null then return jsonb_build_object('ok',false); end if;
  update qclub_private.credentials set pin_hash=p_pin_hash,version=version+1,updated_at=clock_timestamp()
    where credential_id=p_credential_id and version=p_expected_version returning version into changed_version;
  if changed_version is null then return jsonb_build_object('ok',false,'conflict',true); end if;
  -- Rotation, revocation and audit happen in the same transaction.
  update public.snooker_auth_sessions set revoked_at=clock_timestamp()
    where staff_id=target_staff_id and revoked_at is null;
  insert into qclub_private.credential_audit(credential_id,actor_id,action)
    values(p_credential_id,actor_id,'rotate');
  return jsonb_build_object('ok',true,'version',changed_version);
end $$;
revoke all on function public.qclub_security_rotate_credential(text,text,integer,text) from public, anon, authenticated;
grant execute on function public.qclub_security_rotate_credential(text,text,integer,text) to service_role;

create function public.qclub_security_create_session(p_credential_id text,p_version integer,p_token_hash text,p_expires_at timestamptz,p_device_id text,p_client_version text)
returns boolean language plpgsql security invoker set search_path = pg_catalog
as $$
declare v integer; session_role text; staff text; label text;
begin
  -- A rotation that happened during expensive PIN verification invalidates this login.
  -- Lock until insertion commits so rotation cannot miss the newly issued session.
  select version into v from qclub_private.credentials where credential_id=p_credential_id for share;
  if v is null or v is distinct from p_version then return false; end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_token_hash is null or p_expires_at is null
     or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '72 hours' then return false; end if;
  session_role := case when p_credential_id='staff' then 'STAFF' else 'ADMIN' end;
  staff := case p_credential_id when 'main' then 'admin-main' when 'staff' then 'staff-game-marshall' when 'committee' then 'admin-committee' end;
  label := case p_credential_id when 'main' then 'Q Club Admin' when 'staff' then 'Game Marshall' when 'committee' then 'Committee Admin' end;
  insert into public.snooker_auth_sessions(token_hash,role,staff_id,display_name,expires_at,device_id,client_version)
    values(p_token_hash,session_role,staff,label,p_expires_at,p_device_id,p_client_version);
  return true;
end $$;
revoke all on function public.qclub_security_create_session(text,integer,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.qclub_security_create_session(text,integer,text,timestamptz,text,text) to service_role;
