-- Consolidated Club Tab settlement payments for customer-level checkout.
create table if not exists public.snooker_customer_settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_no text not null unique,
  customer_id uuid not null references public.snooker_customers(id) on delete restrict,
  method text not null check (method = any (array['CASH'::text,'UPI'::text,'ONLINE'::text])),
  amount_inr numeric(12,2) not null check (amount_inr > 0),
  received_inr numeric(12,2),
  carry_inr numeric(12,2) not null default 0,
  status text not null check (status = any (array['PENDING'::text,'RECEIVED'::text,'VERIFIED'::text,'FAILED'::text,'EXPIRED'::text,'CANCELLED'::text])),
  cashfree_order_id text unique,
  cashfree_payment_id text,
  payment_session_id text,
  expires_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  received_by text,
  verified_at timestamptz,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.snooker_customer_settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.snooker_customer_settlements(id) on delete restrict,
  bill_id uuid not null references public.snooker_bills(id) on delete restrict,
  amount_inr numeric(12,2) not null check (amount_inr > 0),
  created_at timestamptz not null default now(),
  unique (settlement_id,bill_id)
);

create index if not exists snooker_customer_settlements_customer_idx
  on public.snooker_customer_settlements(customer_id,created_at desc);
create index if not exists snooker_customer_settlement_allocations_bill_idx
  on public.snooker_customer_settlement_allocations(bill_id);

alter table public.snooker_customer_settlements enable row level security;
alter table public.snooker_customer_settlement_allocations enable row level security;

revoke all on public.snooker_customer_settlements from public, anon, authenticated;
revoke all on public.snooker_customer_settlement_allocations from public, anon, authenticated;
grant select,insert,update on public.snooker_customer_settlements to service_role;
grant select,insert on public.snooker_customer_settlement_allocations to service_role;
