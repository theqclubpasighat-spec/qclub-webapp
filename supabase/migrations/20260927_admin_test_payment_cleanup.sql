-- Admin-safe cleanup for test bills and stale payment attempts.
alter table public.snooker_bills
  add column if not exists accounting_excluded boolean not null default false,
  add column if not exists exclusion_reason text,
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by text;

create index if not exists snooker_bills_accounting_excluded_idx
  on public.snooker_bills(accounting_excluded, finalized_at desc);

alter table public.snooker_bill_payments
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text;
