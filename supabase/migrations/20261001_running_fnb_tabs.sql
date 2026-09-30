-- Running F&B tabs: accumulate repeated walk-in orders before creating a payable bill.
create table if not exists public.snooker_fnb_tabs (
  id uuid primary key default gen_random_uuid(),
  tab_no text not null unique,
  customer_name text not null,
  customer_phone text,
  status text not null default 'OPEN',
  linked_bill_id uuid unique references public.snooker_bills(id) on delete restrict,
  opened_at timestamptz not null default now(),
  last_order_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by text,
  closed_by text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint snooker_fnb_tabs_status_check check (status in ('OPEN','CLOSING','CLOSED','CANCELLED'))
);

create index if not exists snooker_fnb_tabs_status_idx
  on public.snooker_fnb_tabs(status, last_order_at desc);

alter table public.snooker_fnb_tabs enable row level security;

alter table public.snooker_fnb_lines
  add column if not exists tab_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='snooker_fnb_lines_tab_id_fkey'
  ) then
    alter table public.snooker_fnb_lines
      add constraint snooker_fnb_lines_tab_id_fkey
      foreign key (tab_id) references public.snooker_fnb_tabs(id) on delete restrict;
  end if;
end $$;

create index if not exists snooker_fnb_lines_tab_idx
  on public.snooker_fnb_lines(tab_id, status, added_at);
