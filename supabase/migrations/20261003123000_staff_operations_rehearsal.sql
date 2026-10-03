-- Rehearsal-first operational persistence for V2 staff shifts, attendance and expenses.
-- Additive only. No production cutover or client grants are included.

create table if not exists public.qclub_staff_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null check (char_length(staff_id) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','CANCELLED')),
  created_by text not null check (char_length(created_by) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 1 and 1000),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);
create index if not exists qclub_staff_shifts_staff_time on public.qclub_staff_shifts(staff_id,starts_at desc);

create table if not exists public.qclub_staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null check (char_length(staff_id) between 1 and 120),
  clock_in timestamptz not null default clock_timestamp(),
  clock_out timestamptz,
  clock_in_note text not null default '' check (char_length(clock_in_note) <= 1000),
  clock_out_note text check (clock_out_note is null or char_length(clock_out_note) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  check (clock_out is null or clock_out >= clock_in)
);
create unique index if not exists qclub_staff_attendance_one_open
  on public.qclub_staff_attendance(staff_id) where clock_out is null;
create index if not exists qclub_staff_attendance_staff_time
  on public.qclub_staff_attendance(staff_id,clock_in desc);

create table if not exists public.qclub_expenses (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  category text not null check (category ~ '^[A-Z][A-Z0-9_ -]{0,79}$'),
  amount_inr numeric(12,2) not null check (amount_inr > 0 and amount_inr <= 10000000),
  description text not null default '' check (char_length(description) <= 2000),
  payment_method text not null check (payment_method in ('CASH','UPI','BANK','OTHER')),
  status text not null default 'POSTED' check (status in ('POSTED','VOIDED')),
  recorded_by text not null check (char_length(recorded_by) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  voided_by text,
  void_reason text check (void_reason is null or char_length(void_reason) between 1 and 1000)
);
create index if not exists qclub_expenses_date on public.qclub_expenses(business_date desc,created_at desc);

alter table public.qclub_staff_shifts enable row level security;
alter table public.qclub_staff_attendance enable row level security;
alter table public.qclub_expenses enable row level security;
revoke all on public.qclub_staff_shifts, public.qclub_staff_attendance, public.qclub_expenses
  from public, anon, authenticated;
grant select,insert,update on public.qclub_staff_shifts, public.qclub_staff_attendance, public.qclub_expenses
  to service_role;

create or replace function public.qclub_staff_ops_snapshot(p_actor_token_hash text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  actor_role text;
  actor_staff text;
  shifts jsonb;
  attendance jsonb;
  expenses jsonb;
begin
  select s.role,s.staff_id into actor_role,actor_staff
  from public.snooker_auth_sessions s
  where s.token_hash=p_actor_token_hash and s.revoked_at is null and s.expires_at > clock_timestamp()
    and s.role in ('ADMIN','STAFF')
  limit 1;
  if actor_role is null then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at desc),'[]'::jsonb) into shifts
  from (
    select id,staff_id,starts_at,ends_at,note,status,created_by,created_at,cancelled_at,cancelled_by,cancel_reason
    from public.qclub_staff_shifts
    where actor_role='ADMIN' or staff_id=actor_staff
    order by starts_at desc limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.clock_in desc),'[]'::jsonb) into attendance
  from (
    select id,staff_id,clock_in,clock_out,clock_in_note,clock_out_note,created_at
    from public.qclub_staff_attendance
    where actor_role='ADMIN' or staff_id=actor_staff
    order by clock_in desc limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into expenses
  from (
    select id,business_date,category,amount_inr,description,payment_method,status,recorded_by,created_at,voided_at,voided_by,void_reason
    from public.qclub_expenses
    where actor_role='ADMIN' or recorded_by=actor_staff
    order by created_at desc limit 100
  ) x;

  return jsonb_build_object('ok',true,'role',actor_role,'staff_id',actor_staff,
    'shifts',shifts,'attendance',attendance,'expenses',expenses);
end $$;

create or replace function public.qclub_staff_shift_create(
  p_actor_token_hash text,p_staff_id text,p_starts_at timestamptz,p_ends_at timestamptz,p_note text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare actor_staff text; saved public.qclub_staff_shifts;
begin
  select s.staff_id into actor_staff from public.snooker_auth_sessions s
  where s.token_hash=p_actor_token_hash and s.role='ADMIN' and s.staff_id='admin-main'
    and s.revoked_at is null and s.expires_at > clock_timestamp() limit 1;
  if actor_staff is null then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  if p_staff_id is null or char_length(trim(p_staff_id)) not between 1 and 120
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at > p_starts_at + interval '24 hours'
     or char_length(coalesce(p_note,'')) > 1000 then
    return jsonb_build_object('ok',false,'error','INVALID_SHIFT');
  end if;
  insert into public.qclub_staff_shifts(staff_id,starts_at,ends_at,note,created_by)
  values(trim(p_staff_id),p_starts_at,p_ends_at,coalesce(p_note,''),actor_staff)
  returning * into saved;
  return jsonb_build_object('ok',true,'shift',to_jsonb(saved));
end $$;

create or replace function public.qclub_staff_shift_cancel(
  p_actor_token_hash text,p_shift_id uuid,p_reason text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare actor_staff text; saved public.qclub_staff_shifts;
begin
  select s.staff_id into actor_staff from public.snooker_auth_sessions s
  where s.token_hash=p_actor_token_hash and s.role='ADMIN' and s.staff_id='admin-main'
    and s.revoked_at is null and s.expires_at > clock_timestamp() limit 1;
  if actor_staff is null then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  if p_shift_id is null or char_length(trim(coalesce(p_reason,''))) not between 1 and 1000 then
    return jsonb_build_object('ok',false,'error','INVALID_SHIFT_CANCEL');
  end if;
  update public.qclub_staff_shifts set status='CANCELLED',cancelled_at=clock_timestamp(),
    cancelled_by=actor_staff,cancel_reason=trim(p_reason)
  where id=p_shift_id and status='SCHEDULED' returning * into saved;
  if saved.id is null then return jsonb_build_object('ok',false,'error','SHIFT_NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'shift',to_jsonb(saved));
end $$;

create or replace function public.qclub_staff_attendance_clock(
  p_actor_token_hash text,p_command text,p_note text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare actor_staff text; saved public.qclub_staff_attendance;
begin
  select s.staff_id into actor_staff from public.snooker_auth_sessions s
  where s.token_hash=p_actor_token_hash and s.role='STAFF'
    and s.revoked_at is null and s.expires_at > clock_timestamp() limit 1;
  if actor_staff is null then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  if char_length(coalesce(p_note,'')) > 1000 then return jsonb_build_object('ok',false,'error','INVALID_NOTE'); end if;
  if p_command='CLOCK_IN' then
    if exists(select 1 from public.qclub_staff_attendance where staff_id=actor_staff and clock_out is null) then
      return jsonb_build_object('ok',false,'error','ALREADY_CLOCKED_IN');
    end if;
    insert into public.qclub_staff_attendance(staff_id,clock_in_note)
    values(actor_staff,coalesce(p_note,'')) returning * into saved;
  elsif p_command='CLOCK_OUT' then
    update public.qclub_staff_attendance
      set clock_out=clock_timestamp(),clock_out_note=coalesce(p_note,'')
      where id=(select id from public.qclub_staff_attendance
        where staff_id=actor_staff and clock_out is null order by clock_in desc limit 1)
      returning * into saved;
    if saved.id is null then return jsonb_build_object('ok',false,'error','NOT_CLOCKED_IN'); end if;
  else
    return jsonb_build_object('ok',false,'error','INVALID_ATTENDANCE_COMMAND');
  end if;
  return jsonb_build_object('ok',true,'attendance',to_jsonb(saved));
end $$;

create or replace function public.qclub_expense_create(
  p_actor_token_hash text,p_business_date date,p_category text,p_amount_inr numeric,
  p_description text,p_payment_method text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare actor_role text; actor_staff text; saved public.qclub_expenses;
begin
  select s.role,s.staff_id into actor_role,actor_staff from public.snooker_auth_sessions s
  where s.token_hash=p_actor_token_hash and s.role in ('ADMIN','STAFF')
    and s.revoked_at is null and s.expires_at > clock_timestamp() limit 1;
  if actor_role is null then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  p_category:=upper(trim(coalesce(p_category,'')));
  p_payment_method:=upper(trim(coalesce(p_payment_method,'')));
  if p_business_date is null or p_category !~ '^[A-Z][A-Z0-9_ -]{0,79}$'
     or p_amount_inr is null or p_amount_inr <= 0 or p_amount_inr > 10000000
     or char_length(coalesce(p_description,'')) > 2000
     or p_payment_method not in ('CASH','UPI','BANK','OTHER') then
    return jsonb_build_object('ok',false,'error','INVALID_EXPENSE');
  end if;
  insert into public.qclub_expenses(business_date,category,amount_inr,description,payment_method,recorded_by)
  values(p_business_date,p_category,round(p_amount_inr,2),coalesce(p_description,''),p_payment_method,actor_staff)
  returning * into saved;
  return jsonb_build_object('ok',true,'expense',to_jsonb(saved));
end $$;

create or replace function public.qclub_expense_void(
  p_actor_token_hash text,p_expense_id uuid,p_reason text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare actor_staff text; saved public.qclub_expenses;
begin
  select s.staff_id into actor_staff from public.snooker_auth_sessions s
  where s.token_hash=p_actor_token_hash and s.role='ADMIN' and s.staff_id='admin-main'
    and s.revoked_at is null and s.expires_at > clock_timestamp() limit 1;
  if actor_staff is null then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  if p_expense_id is null or char_length(trim(coalesce(p_reason,''))) not between 1 and 1000 then
    return jsonb_build_object('ok',false,'error','INVALID_EXPENSE_VOID');
  end if;
  update public.qclub_expenses set status='VOIDED',voided_at=clock_timestamp(),
    voided_by=actor_staff,void_reason=trim(p_reason)
  where id=p_expense_id and status='POSTED' returning * into saved;
  if saved.id is null then return jsonb_build_object('ok',false,'error','EXPENSE_NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'expense',to_jsonb(saved));
end $$;

revoke all on function public.qclub_staff_ops_snapshot(text) from public,anon,authenticated;
revoke all on function public.qclub_staff_shift_create(text,text,timestamptz,timestamptz,text) from public,anon,authenticated;
revoke all on function public.qclub_staff_shift_cancel(text,uuid,text) from public,anon,authenticated;
revoke all on function public.qclub_staff_attendance_clock(text,text,text) from public,anon,authenticated;
revoke all on function public.qclub_expense_create(text,date,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.qclub_expense_void(text,uuid,text) from public,anon,authenticated;
grant execute on function public.qclub_staff_ops_snapshot(text) to service_role;
grant execute on function public.qclub_staff_shift_create(text,text,timestamptz,timestamptz,text) to service_role;
grant execute on function public.qclub_staff_shift_cancel(text,uuid,text) to service_role;
grant execute on function public.qclub_staff_attendance_clock(text,text,text) to service_role;
grant execute on function public.qclub_expense_create(text,date,text,numeric,text,text) to service_role;
grant execute on function public.qclub_expense_void(text,uuid,text) to service_role;
