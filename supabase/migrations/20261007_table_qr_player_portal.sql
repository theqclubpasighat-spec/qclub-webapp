create table if not exists public.qclub_table_access_requests (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references public.snooker_tables(id) on delete restrict,
  customer_id uuid references public.snooker_customers(id) on delete set null,
  customer_name text not null,
  phone text,
  action text not null check (action in ('START','JOIN_CURRENT','JOIN_NEXT','RESUME')),
  requested_game_type text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED','WAITING_NEXT_GAME')),
  target_session_id uuid references public.snooker_sessions(id) on delete set null,
  person_id uuid references public.snooker_session_people(id) on delete set null,
  request_secret_hash text not null unique,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists qclub_table_access_requests_pending_idx
on public.qclub_table_access_requests(status, requested_at desc);

create index if not exists qclub_table_access_requests_table_idx
on public.qclub_table_access_requests(table_id, status, requested_at desc);

alter table public.qclub_table_access_requests enable row level security;
revoke all on public.qclub_table_access_requests from anon, authenticated;
