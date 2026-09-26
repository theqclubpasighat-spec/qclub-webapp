-- Individual player ledger, loser-pays frames, per-player F&B and player account bills
alter table public.snooker_sessions
  add column if not exists account_mode text not null default 'LEGACY',
  add column if not exists match_format text,
  add column if not exists payment_rule text,
  add column if not exists frame_rate_override_inr numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='snooker_sessions_account_mode_check') then
    alter table public.snooker_sessions add constraint snooker_sessions_account_mode_check check (account_mode in ('LEGACY','INDIVIDUAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname='snooker_sessions_match_format_check') then
    alter table public.snooker_sessions add constraint snooker_sessions_match_format_check check (match_format is null or match_format in ('FLEX','SINGLES','DOUBLES'));
  end if;
  if not exists (select 1 from pg_constraint where conname='snooker_sessions_payment_rule_check') then
    alter table public.snooker_sessions add constraint snooker_sessions_payment_rule_check check (payment_rule is null or payment_rule in ('HOURLY','PER_PLAYER','LOSER_PAYS'));
  end if;
end $$;

create table if not exists public.snooker_session_people (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.snooker_sessions(id) on delete restrict,
  name text not null,
  phone text,
  is_member boolean not null default false,
  team_no smallint,
  status text not null default 'ACTIVE',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  settled_at timestamptz,
  accumulated_seconds bigint not null default 0,
  timer_running boolean not null default false,
  timer_started_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint snooker_session_people_status_check check (status in ('ACTIVE','LEFT','SETTLED')),
  constraint snooker_session_people_team_check check (team_no is null or team_no in (1,2))
);
create index if not exists snooker_session_people_session_idx on public.snooker_session_people(session_id,status);
alter table public.snooker_session_people enable row level security;

alter table public.snooker_completed_games
  add column if not exists settlement_rule text,
  add column if not exists match_format text,
  add column if not exists winner_person_ids jsonb not null default '[]'::jsonb,
  add column if not exists loser_person_ids jsonb not null default '[]'::jsonb,
  add column if not exists charge_allocations jsonb not null default '[]'::jsonb;

alter table public.snooker_fnb_lines add column if not exists person_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='snooker_fnb_lines_person_id_fkey') then
    alter table public.snooker_fnb_lines add constraint snooker_fnb_lines_person_id_fkey foreign key (person_id) references public.snooker_session_people(id) on delete restrict;
  end if;
end $$;
create index if not exists snooker_fnb_lines_person_idx on public.snooker_fnb_lines(person_id,status);

create table if not exists public.snooker_person_charges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.snooker_sessions(id) on delete restrict,
  person_id uuid not null references public.snooker_session_people(id) on delete restrict,
  charge_type text not null,
  reference_id text,
  description text not null,
  amount_inr numeric not null,
  status text not null default 'ACTIVE',
  bill_id uuid references public.snooker_bills(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  constraint snooker_person_charges_type_check check (charge_type in ('GAME','FNB','TABLE','ADJUSTMENT')),
  constraint snooker_person_charges_status_check check (status in ('ACTIVE','VOIDED')),
  constraint snooker_person_charges_amount_check check (amount_inr >= 0)
);
create index if not exists snooker_person_charges_person_idx on public.snooker_person_charges(person_id,status,bill_id);
create index if not exists snooker_person_charges_session_idx on public.snooker_person_charges(session_id,status);
alter table public.snooker_person_charges enable row level security;

alter table public.snooker_bills
  add column if not exists source_session_id uuid,
  add column if not exists person_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='snooker_bills_source_session_id_fkey') then
    alter table public.snooker_bills add constraint snooker_bills_source_session_id_fkey foreign key (source_session_id) references public.snooker_sessions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='snooker_bills_person_id_fkey') then
    alter table public.snooker_bills add constraint snooker_bills_person_id_fkey foreign key (person_id) references public.snooker_session_people(id) on delete restrict;
  end if;
end $$;
alter table public.snooker_bills drop constraint if exists snooker_bills_source_check;
alter table public.snooker_bills add constraint snooker_bills_source_check check (bill_source in ('GAME_SESSION','WALK_IN_FNB','PLAYER_ACCOUNT'));
create index if not exists snooker_bills_source_session_idx on public.snooker_bills(source_session_id,person_id);
