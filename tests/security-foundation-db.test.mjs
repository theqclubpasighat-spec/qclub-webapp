import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashPin, tokenHash } from '../src/server/security/foundation.js';
const modulePath = process.env.QCLUB_PGLITE_MODULE;

test('Postgres rehearsal: access control, rate reservations and transactional PIN rotation', { skip: !modulePath }, async () => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.snooker_auth_sessions(id text primary key default gen_random_uuid()::text,token_hash text unique,role text constraint snooker_auth_sessions_role_check check (role in ('STAFF','ADMIN')),staff_id text,display_name text,expires_at timestamptz,revoked_at timestamptz,device_id text,client_version text);
      grant select,insert,update on public.snooker_auth_sessions to service_role;`);
    const migration = await readFile(new URL('../supabase/migrations/20260929113230_security_foundation.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    const committeeRoleMigration = await readFile(new URL('../supabase/migrations/20261003_committee_role_separation.sql', import.meta.url), 'utf8');
    await db.exec(committeeRoleMigration);
    await assert.rejects(db.query("insert into public.snooker_auth_sessions(id,role) values('bad-role','OWNER')"), /snooker_auth_sessions_role_check/);
    // Inspect grants independently of policies. Neither client role may execute helpers.
    const grants = await db.query(`select has_schema_privilege('anon','qclub_private','USAGE') as schema_access,
      has_function_privilege('anon','public.qclub_security_credentials()','EXECUTE') as read_hashes,
      has_function_privilege('authenticated','public.qclub_security_rotate_credential(text,text,integer,text)','EXECUTE') as rotate,
      (select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='qclub_private' and c.relkind='r') as all_rls`);
    assert.deepEqual(grants.rows[0], { schema_access:false, read_hashes:false, rotate:false, all_rls:true });
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.qclub_security_credentials()'), /permission denied/);
    await db.exec('reset role; set role service_role');
    const hash = await hashPin('761239');
    for (const id of ['main','staff','committee']) await db.query('select public.qclub_security_import_credential($1,$2)', [id,hash]);
    await assert.rejects(db.query('select public.qclub_security_import_credential($1,$2)', ['staff',hash]), /duplicate key/);
    const network = tokenHash('fixture-network');
    for (let i=0;i<5;i++) assert.equal((await db.query('select public.qclub_security_reserve_attempt($1) as result',[network])).rows[0].result.allowed,true);
    assert.equal((await db.query('select public.qclub_security_reserve_attempt($1) as result',[network])).rows[0].result.allowed,false);
    for (const [id,role,staff] of [['main','ADMIN','admin-main'],['staff','STAFF','staff-game-marshall'],['committee','COMMITTEE','admin-committee']]) {
      await db.query("insert into public.snooker_auth_sessions(id,token_hash,role,staff_id,display_name,expires_at,revoked_at) values($1,$2,$3,$4,'Fixture',now()+interval '1 hour',null)",[id,tokenHash(id),role,staff]);
    }
    const rotate = async (who, version) => (await db.query('select public.qclub_security_rotate_credential($1,$2,$3,$4) as result',[tokenHash(who),'staff',version,hash])).rows[0].result;
    assert.equal((await rotate('staff',1)).ok,false);
    assert.equal((await rotate('committee',1)).ok,false);
    assert.equal((await rotate('main',9)).conflict,true);
    assert.equal((await rotate('main',1)).version,2);
    assert.equal((await rotate('main',1)).conflict,true);
    assert.equal((await db.query("select public.qclub_security_create_session('staff',1,$1,now()+interval '1 hour',null,null) as ok", [tokenHash('stale-login')])).rows[0].ok,false);
    const sessions = await db.query('select id,revoked_at is not null as revoked from public.snooker_auth_sessions order by id');
    assert.deepEqual(sessions.rows,[{id:'committee',revoked:false},{id:'main',revoked:false},{id:'staff',revoked:true}]);
    const issued = tokenHash('current-login');
    assert.equal((await db.query("select public.qclub_security_create_session('staff',2,$1,now()+interval '1 hour','fixture-device','fixture-client') as ok", [issued])).rows[0].ok,true);
    const current = await db.query('select role,staff_id,revoked_at from public.snooker_auth_sessions where token_hash=$1',[issued]);
    assert.deepEqual(current.rows,[{role:'STAFF',staff_id:'staff-game-marshall',revoked_at:null}]);
    const committeeIssued = tokenHash('committee-login');
    assert.equal((await db.query("select public.qclub_security_create_session('committee',1,$1,now()+interval '1 hour','committee-device','fixture-client') as ok", [committeeIssued])).rows[0].ok,true);
    const committeeCurrent = await db.query('select role,staff_id from public.snooker_auth_sessions where token_hash=$1',[committeeIssued]);
    assert.deepEqual(committeeCurrent.rows,[{role:'COMMITTEE',staff_id:'admin-committee'}]);
    await db.exec('reset role');
    const audit = await db.query("select count(*)::int as count from qclub_private.credential_audit where action='rotate'");
    assert.equal(audit.rows[0].count,1);
    // Force the audit insert to fail: credential update and session revoke must roll back.
    await db.exec("alter table qclub_private.credential_audit add constraint fixture_failure check(action <> 'rotate') not valid; set role service_role");
    await assert.rejects(db.query('select public.qclub_security_rotate_credential($1,$2,$3,$4)',[tokenHash('main'),'committee',1,hash]), /fixture_failure/);
    await db.exec('reset role');
    assert.equal((await db.query("select version from qclub_private.credentials where credential_id='committee'")).rows[0].version,1);
    assert.equal((await db.query("select revoked_at from public.snooker_auth_sessions where id='committee'")).rows[0].revoked_at,null);
  } finally { await db.close(); }
});
