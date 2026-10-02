-- Unify walk-in/running F&B tabs with persistent customer Club Tabs.
alter table public.snooker_fnb_tabs
  add column if not exists customer_id uuid references public.snooker_customers(id) on delete set null;

create index if not exists snooker_fnb_tabs_customer_idx
  on public.snooker_fnb_tabs(customer_id,status,last_order_at desc);

update public.snooker_fnb_tabs t
set customer_id = c.id
from public.snooker_customers c
where t.customer_id is null
  and (
    (t.customer_phone is not null and c.normalized_phone is not null and regexp_replace(t.customer_phone,'\D','','g') = c.normalized_phone)
    or lower(regexp_replace(trim(t.customer_name),'\s+',' ','g')) = c.normalized_name
  );

create unique index if not exists snooker_fnb_tabs_one_open_per_customer_idx
  on public.snooker_fnb_tabs(customer_id)
  where customer_id is not null and status = 'OPEN';
