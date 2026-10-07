-- Cloud-backed QChase/Rummy live display and explicit game lifecycle.
create table if not exists public.qclub_qchase_live_state (
  table_key text primary key check (table_key in ('table1','table2','table3')),
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.qclub_qchase_live_state enable row level security;
revoke all on public.qclub_qchase_live_state from anon, authenticated;
grant select on public.qclub_qchase_live_state to anon, authenticated;

drop policy if exists "qchase live state public read" on public.qclub_qchase_live_state;
create policy "qchase live state public read"
on public.qclub_qchase_live_state
for select
to anon, authenticated
using (true);

alter table public.snooker_completed_games
  add column if not exists started_at timestamptz,
  add column if not exists engine_game_id text,
  add column if not exists engine_game_no text,
  add column if not exists engine_final_snapshot jsonb not null default '{}'::jsonb;

create unique index if not exists snooker_qchase_one_in_progress_per_session
on public.snooker_completed_games(session_id)
where game_type='QCHASE_RUMMY' and status='IN_PROGRESS';

create index if not exists snooker_qchase_engine_game_idx
on public.snooker_completed_games(engine_game_id)
where engine_game_id is not null;
