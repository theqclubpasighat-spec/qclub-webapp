-- Preserve merged customer identities so old spellings/names resolve to one canonical profile.
create table if not exists public.snooker_customer_aliases (
  normalized_alias text primary key,
  alias_name text not null,
  customer_id uuid not null references public.snooker_customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists snooker_customer_aliases_customer_idx
  on public.snooker_customer_aliases(customer_id);

alter table public.snooker_customer_aliases enable row level security;
revoke all on public.snooker_customer_aliases from public, anon, authenticated;
grant select,insert,update,delete on public.snooker_customer_aliases to service_role;

insert into public.snooker_customer_aliases(normalized_alias,alias_name,customer_id,created_by)
values
  ('wilson','WILSON','9b513f83-88e0-4256-abaf-e41f735a4628'::uuid,'duplicate_merge_20261007'),
  ('wilson pilot yomso','WILSON PILOT YOMSO','9b513f83-88e0-4256-abaf-e41f735a4628'::uuid,'duplicate_merge_20261007')
on conflict(normalized_alias) do update
set alias_name=excluded.alias_name,customer_id=excluded.customer_id,created_by=excluded.created_by;
