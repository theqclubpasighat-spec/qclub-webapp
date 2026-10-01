-- Link session participants to the persistent customer directory so one player's tab can follow them across tables.
alter table public.snooker_session_people
  add column if not exists customer_id uuid references public.snooker_customers(id) on delete set null;
create index if not exists snooker_session_people_customer_idx
  on public.snooker_session_people(customer_id,status);
update public.snooker_session_people p
set customer_id = c.id
from public.snooker_customers c
where p.customer_id is null
  and lower(regexp_replace(trim(p.name),'\s+',' ','g')) = c.normalized_name;
