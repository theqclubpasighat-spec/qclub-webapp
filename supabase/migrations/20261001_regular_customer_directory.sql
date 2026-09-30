-- Regular customer directory for QclubLedger autofill.
create table if not exists public.snooker_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  phone text,
  normalized_phone text,
  is_member boolean not null default false,
  member_tier text,
  source text,
  visit_count integer not null default 0,
  last_seen_at timestamptz,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists snooker_customers_phone_idx
  on public.snooker_customers(normalized_phone)
  where normalized_phone is not null;

create index if not exists snooker_customers_last_seen_idx
  on public.snooker_customers(active, last_seen_at desc nulls last, name);

alter table public.snooker_customers enable row level security;

with raw as (
  select p.value->>'name' as name, p.value->>'mobile' as phone, false as is_member, null::text as tier, 'legacy_player'::text as source, null::timestamptz as seen
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'players')='array' then s.state->'players' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select p.value->>'name', p.value->>'mobile', true, p.value->>'tier', 'member_registry',
         null::timestamptz
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'memberRegistry')='array' then s.state->'memberRegistry' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select p.value->>'name', p.value->>'mobile', false, null, 'archived_food_order',
         null::timestamptz
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'archivedFoodOrders')='array' then s.state->'archivedFoodOrders' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select p.value->>'customerName', p.value->>'customerMobile', false, null, 'food_order',
         null::timestamptz
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'foodOrders')='array' then s.state->'foodOrders' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select p.value->>'customer_name', p.value->>'customer_phone', false, null, 'payment_order',
         null::timestamptz
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'paymentOrders')='array' then s.state->'paymentOrders' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select p.value->>'customerName', p.value->>'customerMobile', false, null, 'shop_receipt',
         null::timestamptz
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'shopReceipts')='array' then s.state->'shopReceipts' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select p.value->>'name', p.value->>'mobile', false, null, 'booking',
         null::timestamptz
  from public.qclub_state s,
       lateral jsonb_array_elements(case when jsonb_typeof(s.state->'booking'->'requests')='array' then s.state->'booking'->'requests' else '[]'::jsonb end) p(value)
  where s.key='main'

  union all
  select customer_name, customer_phone, is_member, null, 'snooker_session', coalesce(updated_at,started_at)
  from public.snooker_sessions

  union all
  select name, phone, is_member, null, 'session_person', coalesce(updated_at,joined_at)
  from public.snooker_session_people

  union all
  select customer_name, customer_phone, false, null, 'bill', coalesce(updated_at,finalized_at)
  from public.snooker_bills

  union all
  select customer_name, customer_phone, false, null, 'fnb_tab', coalesce(updated_at,last_order_at,opened_at)
  from public.snooker_fnb_tabs
),
clean as (
  select
    upper(btrim(regexp_replace(name,'\s+',' ','g'))) as name,
    lower(btrim(regexp_replace(name,'\s+',' ','g'))) as normalized_name,
    nullif(right(regexp_replace(coalesce(phone,''),'\D','','g'),10),'') as normalized_phone,
    is_member,
    tier,
    source,
    seen
  from raw
  where name is not null and btrim(name) <> ''
),
ranked as (
  select *,
    row_number() over (
      partition by normalized_name
      order by (normalized_phone is not null) desc, is_member desc, seen desc nulls last, length(name) desc
    ) as rn,
    count(*) over (partition by normalized_name) as occurrences,
    bool_or(is_member) over (partition by normalized_name) as any_member,
    max(seen) over (partition by normalized_name) as last_seen
  from clean
)
insert into public.snooker_customers (
  name, normalized_name, phone, normalized_phone, is_member, member_tier, source,
  visit_count, last_seen_at, active, updated_at
)
select
  name,
  normalized_name,
  normalized_phone,
  normalized_phone,
  any_member,
  tier,
  source,
  greatest(occurrences,1),
  last_seen,
  true,
  now()
from ranked
where rn=1
on conflict (normalized_name) do update set
  phone = coalesce(excluded.phone, public.snooker_customers.phone),
  normalized_phone = coalesce(excluded.normalized_phone, public.snooker_customers.normalized_phone),
  is_member = public.snooker_customers.is_member or excluded.is_member,
  member_tier = coalesce(excluded.member_tier, public.snooker_customers.member_tier),
  visit_count = greatest(public.snooker_customers.visit_count, excluded.visit_count),
  last_seen_at = greatest(public.snooker_customers.last_seen_at, excluded.last_seen_at),
  updated_at = now();
