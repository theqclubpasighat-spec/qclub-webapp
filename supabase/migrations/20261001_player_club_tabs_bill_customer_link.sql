alter table public.snooker_bills
  add column if not exists customer_id uuid references public.snooker_customers(id) on delete set null;
create index if not exists snooker_bills_customer_idx
  on public.snooker_bills(customer_id,status);
