-- Package 31: persistent staff operations salvaged from V2 demo-only pages.
-- Server-only tables: no direct anon/authenticated client access.

create table if not exists public.qclub_staff_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null check (char_length(btrim(staff_name)) between 1 and 160),
  assigned_role text not null check (char_length(btrim(assigned_role)) between 1 and 120),
  shift_name text not null check (char_length(btrim(shift_name)) between 1 and 160),
  duty_date date not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','ON_DUTY','COMPLETED','CANCELLED')),
  notes text,
  created_by_staff_id text,
  created_by_display_name text,
  created_at timestamptz not null default now()
);

create index if not exists qclub_staff_shifts_duty_date_idx
  on public.qclub_staff_shifts (duty_date desc, created_at desc);

create table if not exists public.qclub_staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null check (char_length(btrim(staff_name)) between 1 and 160),
  duty_date date not null,
  status text not null check (status in ('PRESENT','LATE','HALF_DAY','LEAVE')),
  in_time time,
  out_time time,
  overtime_hours numeric(6,2) not null default 0 check (overtime_hours >= 0 and overtime_hours <= 24),
  notes text,
  created_by_staff_id text,
  created_by_display_name text,
  created_at timestamptz not null default now()
);

create index if not exists qclub_staff_attendance_duty_date_idx
  on public.qclub_staff_attendance (duty_date desc, created_at desc);

create table if not exists public.qclub_operational_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('MAINTENANCE','SUPPLIES','UTILITIES','REFRESHMENTS','MISC')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  amount_inr numeric(12,2) not null check (amount_inr > 0 and amount_inr <= 1000000),
  paid_by text not null check (char_length(btrim(paid_by)) between 1 and 160),
  payment_mode text not null check (payment_mode in ('CASH','UPI','CARD','BANK')),
  expense_date date not null,
  notes text,
  created_by_staff_id text,
  created_by_display_name text,
  created_at timestamptz not null default now()
);

create index if not exists qclub_operational_expenses_date_idx
  on public.qclub_operational_expenses (expense_date desc, created_at desc);

alter table public.qclub_staff_shifts enable row level security;
alter table public.qclub_staff_attendance enable row level security;
alter table public.qclub_operational_expenses enable row level security;

revoke all on public.qclub_staff_shifts from anon, authenticated;
revoke all on public.qclub_staff_attendance from anon, authenticated;
revoke all on public.qclub_operational_expenses from anon, authenticated;

grant select, insert on public.qclub_staff_shifts to service_role;
grant select, insert on public.qclub_staff_attendance to service_role;
grant select, insert on public.qclub_operational_expenses to service_role;

comment on table public.qclub_staff_shifts is 'Append-only staff duty roster entries created through authenticated Q Club server APIs.';
comment on table public.qclub_staff_attendance is 'Append-only attendance/time-clock records created through authenticated Q Club server APIs.';
comment on table public.qclub_operational_expenses is 'Append-only petty cash and operational expense records created through authenticated Q Club server APIs.';
