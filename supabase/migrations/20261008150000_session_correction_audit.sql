create table if not exists public.snooker_session_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.snooker_sessions(id) on delete restrict,
  correction_type text not null,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  reason text not null,
  corrected_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists snooker_session_corrections_session_idx
  on public.snooker_session_corrections(session_id, created_at desc);

alter table public.snooker_session_corrections enable row level security;

revoke all on public.snooker_session_corrections from anon, authenticated;
grant select, insert on public.snooker_session_corrections to service_role;
