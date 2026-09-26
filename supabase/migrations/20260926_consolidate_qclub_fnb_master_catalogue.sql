-- Shared F&B master catalogue for Q Club Ledger + Q Lounge
-- Applied to production Supabase on 2026-09-26.
-- Non-destructive: legacy qclub_state.menuCatalog remains untouched as fallback.

create table if not exists public.qclub_fnb_categories (
  category_key text primary key,
  title text not null,
  image_url text,
  image_path text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qclub_fnb_categories enable row level security;

alter table public.snooker_catalogue_items
  add column if not exists description text,
  add column if not exists image_url text,
  add column if not exists image_path text,
  add column if not exists qlounge_category_key text,
  add column if not exists show_on_qlounge boolean not null default false,
  add column if not exists online_order_enabled boolean not null default false,
  add column if not exists sell_in_ledger boolean not null default true,
  add column if not exists display_order integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'snooker_catalogue_items_qlounge_category_fkey'
  ) then
    alter table public.snooker_catalogue_items
      add constraint snooker_catalogue_items_qlounge_category_fkey
      foreign key (qlounge_category_key)
      references public.qclub_fnb_categories(category_key)
      on update cascade
      on delete set null;
  end if;
end $$;

with categories as (
  select
    cat.key as category_key,
    coalesce(nullif(cat.value->>'title',''), initcap(replace(cat.key, '_', ' '))) as title,
    nullif(cat.value->>'image','') as image_url,
    nullif(cat.value->>'imagePath','') as image_path,
    row_number() over (order by cat.key) - 1 as sort_order
  from public.qclub_state s
  cross join lateral jsonb_each(coalesce(s.state->'menuCatalog','{}'::jsonb)) cat(key,value)
  where s.key='main'
)
insert into public.qclub_fnb_categories (
  category_key, title, image_url, image_path, sort_order, active, updated_at
)
select category_key, title, image_url, image_path, sort_order, true, now()
from categories
on conflict (category_key) do update set
  title = excluded.title,
  image_url = excluded.image_url,
  image_path = excluded.image_path,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

with menu_items as (
  select
    cat.key as category_key,
    item.value->>'id' as item_id,
    nullif(item.value->>'description','') as description,
    nullif(item.value->>'image','') as image_url,
    nullif(item.value->>'imagePath','') as image_path,
    (row_number() over (partition by cat.key order by item.ordinality) - 1)::integer as display_order
  from public.qclub_state s
  cross join lateral jsonb_each(coalesce(s.state->'menuCatalog','{}'::jsonb)) cat(key,value)
  cross join lateral jsonb_array_elements(coalesce(cat.value->'items','[]'::jsonb))
    with ordinality item(value, ordinality)
  where s.key='main'
)
update public.snooker_catalogue_items l
set
  description = m.description,
  image_url = m.image_url,
  image_path = m.image_path,
  qlounge_category_key = m.category_key,
  show_on_qlounge = true,
  online_order_enabled = true,
  sell_in_ledger = true,
  display_order = m.display_order,
  updated_at = now()
from menu_items m
where l.id = m.item_id;
