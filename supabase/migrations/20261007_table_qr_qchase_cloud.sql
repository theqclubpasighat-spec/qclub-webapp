-- Q Club table QR, QChase lifecycle and cloud TV bridge.
-- Server/service-role is the only writer/reader; public access is exposed through validated API projections.

alter table public.snooker_sessions
  add column if not exists qchase_game_number integer,
  add column if not exists qchase_game_state text,
  add column if not exists qchase_game_started_at timestamptz,
  add column if not exists qchase_game_finished_at timestamptz;

alter table public.snooker_sessions
  drop constraint if exists snooker_sessions_qchase_game_state_check;
alter table public.snooker_sessions
  add constraint snooker_sessions_qchase_game_state_check
  check (qchase_game_state is null or qchase_game_state in ('ACTIVE','READY'));

alter table public.snooker_session_people
  drop constraint if exists snooker_session_people_status_check;
alter table public.snooker_session_people
  add constraint snooker_session_people_status_check
  check (status in ('ACTIVE','WAITING','LEFT','SETTLED'));

create table if not exists public.snooker_game_access_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  scope text not null default 'QCHASE',
  table_key text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.snooker_game_access_sessions enable row level security;
revoke all on public.snooker_game_access_sessions from anon, authenticated;
grant select,insert,update,delete on public.snooker_game_access_sessions to service_role;

create index if not exists snooker_game_access_sessions_expiry_idx
  on public.snooker_game_access_sessions(expires_at);

create table if not exists public.snooker_qchase_display_states (
  table_key text primary key check (table_key in ('table1','table2','table3')),
  snapshot jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.snooker_qchase_display_states enable row level security;
revoke all on public.snooker_qchase_display_states from anon, authenticated;
grant select,insert,update,delete on public.snooker_qchase_display_states to service_role;

create table if not exists public.snooker_table_qr_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  table_id text not null references public.snooker_tables(id) on delete restrict,
  session_id uuid references public.snooker_sessions(id) on delete set null,
  request_type text not null check (request_type in ('START','JOIN_CURRENT','JOIN_NEXT','RECONNECT')),
  requested_game_type text,
  requested_name text not null,
  requested_phone text,
  requested_customer_id uuid references public.snooker_customers(id) on delete set null,
  target_game_number integer,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
  token_hash text not null unique,
  approved_person_id uuid references public.snooker_session_people(id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  expires_at timestamptz not null default (now() + interval '12 hours'),
  updated_at timestamptz not null default now()
);
alter table public.snooker_table_qr_requests enable row level security;
revoke all on public.snooker_table_qr_requests from anon, authenticated;
grant select,insert,update,delete on public.snooker_table_qr_requests to service_role;

create index if not exists snooker_table_qr_requests_status_idx
  on public.snooker_table_qr_requests(status,requested_at desc);
create index if not exists snooker_table_qr_requests_table_idx
  on public.snooker_table_qr_requests(table_id,status,requested_at desc);
create index if not exists snooker_table_qr_requests_customer_idx
  on public.snooker_table_qr_requests(requested_customer_id,status);

create table if not exists public.snooker_public_fnb_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  qr_request_id uuid not null references public.snooker_table_qr_requests(id) on delete restrict,
  table_id text not null references public.snooker_tables(id) on delete restrict,
  session_id uuid references public.snooker_sessions(id) on delete set null,
  person_id uuid references public.snooker_session_people(id) on delete set null,
  customer_id uuid references public.snooker_customers(id) on delete set null,
  customer_name text not null,
  lines jsonb not null default '[]'::jsonb,
  total_inr numeric(12,2) not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','REJECTED','SERVED','CANCELLED')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by text,
  served_at timestamptz,
  served_by text,
  rejected_at timestamptz,
  rejected_by text,
  rejection_reason text,
  updated_at timestamptz not null default now()
);
alter table public.snooker_public_fnb_orders enable row level security;
revoke all on public.snooker_public_fnb_orders from anon, authenticated;
grant select,insert,update,delete on public.snooker_public_fnb_orders to service_role;

create index if not exists snooker_public_fnb_orders_status_idx
  on public.snooker_public_fnb_orders(status,requested_at desc);
create index if not exists snooker_public_fnb_orders_customer_idx
  on public.snooker_public_fnb_orders(customer_id,requested_at desc);

comment on column public.snooker_sessions.qchase_game_state is
  'QChase/Rummy lifecycle independent of the physical table session: ACTIVE while a numbered game is running, READY between games.';
comment on table public.snooker_qchase_display_states is
  'Cloud copy of the live QChase scorer snapshot consumed by a separate TV browser.';
comment on table public.snooker_table_qr_requests is
  'Customer table-QR start/join/reconnect requests. Raw access tokens are never stored; only SHA-256 hashes.';
comment on table public.snooker_public_fnb_orders is
  'Customer-submitted QR food/drink orders. Inventory and firm player charges are created only when staff accepts the order.';
