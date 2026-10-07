create table if not exists public.qclub_table_order_requests (
  id uuid primary key default gen_random_uuid(),
  access_request_id uuid not null references public.qclub_table_access_requests(id) on delete cascade,
  customer_id uuid references public.snooker_customers(id) on delete set null,
  session_id uuid references public.snooker_sessions(id) on delete set null,
  person_id uuid references public.snooker_session_people(id) on delete set null,
  table_id text not null references public.snooker_tables(id) on delete restrict,
  status text not null default 'SENT' check (status in ('SENT','ACCEPTED','SERVED','REJECTED','CANCELLED')),
  requested_lines jsonb not null default '[]'::jsonb,
  priced_lines jsonb not null default '[]'::jsonb,
  total_inr numeric(12,2) not null default 0,
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by text,
  served_at timestamptz,
  served_by text,
  rejected_at timestamptz,
  rejected_by text,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists qclub_table_order_requests_status_idx
on public.qclub_table_order_requests(status, requested_at desc);

create index if not exists qclub_table_order_requests_access_idx
on public.qclub_table_order_requests(access_request_id, requested_at desc);

alter table public.qclub_table_order_requests enable row level security;
revoke all on public.qclub_table_order_requests from anon, authenticated;
