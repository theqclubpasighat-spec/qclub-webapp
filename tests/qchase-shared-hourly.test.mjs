import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";

const server = fs.readFileSync(new URL("../src/server/snooker-v1.js", import.meta.url), "utf8");
const ledger = fs.readFileSync(new URL("../src/components/qclub-ledger-page.jsx", import.meta.url), "utf8");

test("QChase/Rummy offers both per-game and shared-hourly billing", () => {
  assert.match(ledger, /Per Game — ₹100\/player\/game/);
  assert.match(ledger, /Hourly Shared — split table time among active players/);
  assert.match(server, /\["PER_PLAYER","HOURLY_SHARED"\]\.includes\(paymentRule\)/);
});

test("shared-hourly QChase records games without ₹100 game charges", () => {
  assert.match(server, /settlement==="HOURLY_SHARED"[\s\S]*?total=settlement==="HOURLY_SHARED"[\s\S]*?\? 0/);
  assert.match(server, /if\(settlement==="HOURLY_SHARED"\)\{[\s\S]*?allocations=\[\]/);
  assert.match(ledger, /No ₹100 game charge — table time continues to be shared by active players/);
});

test("join, leave, pause and end settle the prior occupancy slice", () => {
  assert.match(server, /"PLAYER_JOIN"/);
  assert.match(server, /"PLAYER_LEAVE"/);
  assert.match(server, /"PLAYER_REJOIN"/);
  assert.match(server, /"TABLE_PAUSE"/);
  assert.match(server, /"TABLE_END"/);
  assert.match(ledger, /Settle & Leave/);
  assert.match(ledger, /Leave • Keep Tab Open/);
});

test("shared hourly migration reproduces the real-life 4-player then 3-player scenario", { skip: !process.env.QCLUB_PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.QCLUB_PGLITE_MODULE);
  const pg = new PGlite();

  try {
    await pg.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;

      create table public.snooker_sessions (
        id uuid primary key default gen_random_uuid(),
        payment_rule text,
        started_at timestamptz,
        timer_started_at timestamptz,
        timer_running boolean default false
      );

      create table public.snooker_session_people (
        id uuid primary key default gen_random_uuid(),
        session_id uuid not null references public.snooker_sessions(id),
        name text not null,
        status text not null default 'ACTIVE',
        joined_at timestamptz not null default now()
      );

      create table public.snooker_person_charges (
        id uuid primary key default gen_random_uuid(),
        session_id uuid not null,
        person_id uuid not null,
        charge_type text not null,
        reference_id text,
        description text not null,
        amount_inr numeric not null,
        status text not null default 'ACTIVE',
        bill_id uuid,
        metadata jsonb not null default '{}'::jsonb,
        created_by text,
        created_at timestamptz not null default now()
      );
    `);

    await pg.exec(await readFile(new URL("../supabase/migrations/20261005_qchase_shared_hourly_billing.sql", import.meta.url), "utf8"));

    const session = await pg.query(`
      insert into public.snooker_sessions (
        payment_rule, started_at, timer_started_at, timer_running,
        shared_hourly_last_at, shared_hourly_rate_inr
      ) values (
        'HOURLY_SHARED',
        '2026-10-05T12:00:00Z',
        '2026-10-05T12:00:00Z',
        true,
        '2026-10-05T12:00:00Z',
        600
      )
      returning id
    `);
    const sessionId = session.rows[0].id;

    for (const name of ["A","B","C","D"]) {
      await pg.query(
        "insert into public.snooker_session_people(session_id,name,status,joined_at) values ($1,$2,'ACTIVE','2026-10-05T12:00:00Z')",
        [sessionId,name]
      );
    }

    await pg.query(
      "select public.settle_shared_hourly_slice($1,'2026-10-05T12:30:00Z','staff','PLAYER_LEAVE')",
      [sessionId]
    );

    const a = await pg.query(
      "select id from public.snooker_session_people where session_id=$1 and name='A'",
      [sessionId]
    );
    await pg.query("update public.snooker_session_people set status='LEFT' where id=$1",[a.rows[0].id]);

    await pg.query(
      "select public.settle_shared_hourly_slice($1,'2026-10-05T13:00:00Z','staff','TABLE_END')",
      [sessionId]
    );

    const rows = await pg.query(`
      select p.name, round(sum(c.amount_inr),2) as total
      from public.snooker_person_charges c
      join public.snooker_session_people p on p.id=c.person_id
      where c.session_id=$1 and c.charge_type='TABLE'
      group by p.name
      order by p.name
    `,[sessionId]);

    const totals = Object.fromEntries(rows.rows.map((row) => [row.name, Number(row.total)]));
    assert.deepEqual(totals, { A:75, B:175, C:175, D:175 });

    const grand = Object.values(totals).reduce((sum,value)=>sum+value,0);
    assert.equal(grand, 600);
  } finally {
    await pg.close();
  }
});
