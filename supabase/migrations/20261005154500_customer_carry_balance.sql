-- Persistent QClubLedger customer credit/debit carry-over.
-- Positive snooker_customers.balance_inr = customer CREDIT.
-- Negative snooker_customers.balance_inr = customer DEBIT / amount owed to the club.

alter table public.snooker_customers
  add column if not exists balance_inr numeric(12,2) not null default 0;

create table if not exists public.snooker_customer_balance_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.snooker_customers(id) on delete restrict,
  bill_id uuid references public.snooker_bills(id) on delete restrict,
  payment_id uuid references public.snooker_bill_payments(id) on delete restrict,
  entry_type text not null check (entry_type in (
    'CREDIT_CREATED',
    'CREDIT_APPLIED',
    'DEBIT_CREATED',
    'DEBIT_SETTLED',
    'ADMIN_ADJUSTMENT'
  )),
  delta_inr numeric(12,2) not null check (delta_inr <> 0),
  balance_after_inr numeric(12,2) not null,
  payment_method text check (payment_method is null or payment_method in ('CASH','UPI','ONLINE','BALANCE')),
  reason text not null,
  created_by text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create index if not exists snooker_customer_balance_entries_customer_idx
  on public.snooker_customer_balance_entries(customer_id, created_at desc);

create index if not exists snooker_customer_balance_entries_bill_idx
  on public.snooker_customer_balance_entries(bill_id, created_at desc);

alter table public.snooker_customer_balance_entries enable row level security;
revoke all on table public.snooker_customer_balance_entries from public, anon, authenticated;
grant select, insert on table public.snooker_customer_balance_entries to service_role;

create table if not exists public.snooker_manual_settlements (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  bill_id uuid not null references public.snooker_bills(id) on delete restrict,
  customer_id uuid references public.snooker_customers(id) on delete restrict,
  payment_method text not null check (payment_method in ('CASH','UPI')),
  received_inr numeric(12,2) not null check (received_inr >= 0),
  settle_mode boolean not null default true,
  result jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists snooker_manual_settlements_bill_idx
  on public.snooker_manual_settlements(bill_id, created_at desc);

alter table public.snooker_manual_settlements enable row level security;
revoke all on table public.snooker_manual_settlements from public, anon, authenticated;
grant select, insert, update on table public.snooker_manual_settlements to service_role;

create or replace function public.qclub_prevent_balance_entry_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'CUSTOMER_BALANCE_ENTRY_IMMUTABLE';
end;
$$;

drop trigger if exists snooker_customer_balance_entries_immutable on public.snooker_customer_balance_entries;
create trigger snooker_customer_balance_entries_immutable
before update or delete on public.snooker_customer_balance_entries
for each row execute function public.qclub_prevent_balance_entry_mutation();

create or replace function public.qclub_manual_settle_bill(
  p_bill_id uuid,
  p_customer_id uuid,
  p_payment_method text,
  p_received_inr numeric,
  p_settle_mode boolean,
  p_staff_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_bill public.snooker_bills%rowtype;
  v_method text := upper(trim(coalesce(p_payment_method,'')));
  v_received numeric(12,2) := round(greatest(coalesce(p_received_inr,0),0),2);
  v_paid_before numeric(12,2) := 0;
  v_due numeric(12,2) := 0;
  v_balance numeric(12,2) := 0;
  v_running_balance numeric(12,2) := 0;
  v_credit_applied numeric(12,2) := 0;
  v_actual_applied numeric(12,2) := 0;
  v_shortfall numeric(12,2) := 0;
  v_leftover numeric(12,2) := 0;
  v_debit_settled numeric(12,2) := 0;
  v_new_credit numeric(12,2) := 0;
  v_balance_payment numeric(12,2) := 0;
  v_payment_id uuid;
  v_balance_payment_id uuid;
  v_paid_after numeric(12,2) := 0;
  v_due_after numeric(12,2) := 0;
  v_status text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    return jsonb_build_object('ok',false,'error','IDEMPOTENCY_KEY_REQUIRED');
  end if;

  select result into v_existing
  from public.snooker_manual_settlements
  where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  if v_method not in ('CASH','UPI') then
    return jsonb_build_object('ok',false,'error','INVALID_MANUAL_PAYMENT_METHOD');
  end if;

  select * into v_bill
  from public.snooker_bills
  where id = p_bill_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','BILL_NOT_FOUND');
  end if;
  if v_bill.status = 'CANCELLED' then
    return jsonb_build_object('ok',false,'error','BILL_CANCELLED');
  end if;

  if exists (
    select 1
    from public.snooker_bill_payments p
    where p.bill_id = p_bill_id
      and p.status = 'PENDING'
      and p.method in ('UPI','ONLINE')
      and (p.expires_at is null or p.expires_at > v_now)
  ) then
    return jsonb_build_object('ok',false,'error','ACTIVE_ONLINE_PAYMENT_PENDING');
  end if;

  select coalesce(round(sum(p.amount_inr),2),0)
  into v_paid_before
  from public.snooker_bill_payments p
  where p.bill_id = p_bill_id
    and p.status in ('RECEIVED','VERIFIED');

  v_due := greatest(round(v_bill.total_inr - v_paid_before,2),0);
  if v_due <= 0 then
    return jsonb_build_object('ok',false,'error','BILL_ALREADY_PAID');
  end if;

  if not coalesce(p_settle_mode,true) then
    if v_received <= 0 then
      return jsonb_build_object('ok',false,'error','PAYMENT_AMOUNT_REQUIRED');
    end if;
    if v_received > v_due then
      return jsonb_build_object('ok',false,'error','PARTIAL_PAYMENT_EXCEEDS_DUE','due_inr',v_due);
    end if;

    v_payment_id := gen_random_uuid();
    insert into public.snooker_bill_payments(
      id,bill_id,method,amount_inr,cash_tendered_inr,change_inr,status,received_by,idempotency_key,created_at,updated_at
    ) values (
      v_payment_id,p_bill_id,v_method,v_received,
      case when v_method='CASH' then v_received else null end,
      case when v_method='CASH' then 0 else null end,
      'RECEIVED',p_staff_id,p_idempotency_key || ':payment',v_now,v_now
    );

    v_paid_after := round(v_paid_before + v_received,2);
    v_due_after := greatest(round(v_bill.total_inr - v_paid_after,2),0);
    v_status := case when v_due_after <= 0 then 'PAID' else 'PARTIALLY_PAID' end;

    update public.snooker_bills
    set paid_inr=v_paid_after,due_inr=v_due_after,status=v_status,updated_at=v_now
    where id=p_bill_id;

    if p_customer_id is not null then
      select balance_inr into v_balance
      from public.snooker_customers where id=p_customer_id;
    end if;

    v_result := jsonb_build_object(
      'ok',true,'mode','PARTIAL','bill_id',p_bill_id,'payment_id',v_payment_id,
      'method',v_method,'received_inr',v_received,'amount_applied_inr',v_received,
      'bill_status',v_status,'due_inr',v_due_after,
      'customer_balance_inr',coalesce(v_balance,0)
    );

    insert into public.snooker_manual_settlements(
      idempotency_key,bill_id,customer_id,payment_method,received_inr,settle_mode,result,created_by
    ) values (
      p_idempotency_key,p_bill_id,p_customer_id,v_method,v_received,false,v_result,p_staff_id
    );
    return v_result;
  end if;

  if p_customer_id is null then
    return jsonb_build_object('ok',false,'error','CUSTOMER_REQUIRED_FOR_CARRYOVER');
  end if;

  select balance_inr into v_balance
  from public.snooker_customers
  where id = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','CUSTOMER_NOT_FOUND');
  end if;

  if v_received <= 0 and greatest(v_balance,0) < v_due then
    return jsonb_build_object('ok',false,'error','PAYMENT_AMOUNT_REQUIRED');
  end if;

  v_running_balance := v_balance;
  v_credit_applied := least(greatest(v_balance,0),v_due);
  v_actual_applied := least(v_received,greatest(v_due-v_credit_applied,0));
  v_shortfall := greatest(round(v_due-v_credit_applied-v_actual_applied,2),0);
  v_leftover := greatest(round(v_received-v_actual_applied,2),0);
  v_debit_settled := least(v_leftover,greatest(-v_balance,0));
  v_new_credit := greatest(round(v_leftover-v_debit_settled,2),0);
  v_balance_payment := round(v_credit_applied+v_shortfall,2);

  if v_actual_applied > 0 then
    v_payment_id := gen_random_uuid();
    insert into public.snooker_bill_payments(
      id,bill_id,method,amount_inr,cash_tendered_inr,change_inr,status,received_by,idempotency_key,provider_payload,created_at,updated_at
    ) values (
      v_payment_id,p_bill_id,v_method,v_actual_applied,
      case when v_method='CASH' then v_received else null end,
      case when v_method='CASH' then 0 else null end,
      'RECEIVED',p_staff_id,p_idempotency_key || ':payment',
      jsonb_build_object('manual_settlement',true,'received_inr',v_received),
      v_now,v_now
    );
  end if;

  if v_balance_payment > 0 then
    v_balance_payment_id := gen_random_uuid();
    insert into public.snooker_bill_payments(
      id,bill_id,method,amount_inr,status,received_by,idempotency_key,provider_payload,created_at,updated_at
    ) values (
      v_balance_payment_id,p_bill_id,'BALANCE',v_balance_payment,'RECEIVED',p_staff_id,
      p_idempotency_key || ':balance-payment',
      jsonb_build_object(
        'manual_settlement',true,
        'credit_applied_inr',v_credit_applied,
        'debit_created_inr',v_shortfall
      ),
      v_now,v_now
    );
  end if;

  if v_credit_applied > 0 then
    v_running_balance := round(v_running_balance-v_credit_applied,2);
    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,payment_method,reason,created_by,idempotency_key,created_at
    ) values (
      p_customer_id,p_bill_id,v_balance_payment_id,'CREDIT_APPLIED',-v_credit_applied,v_running_balance,'BALANCE',
      'Previous customer credit applied to bill',p_staff_id,p_idempotency_key || ':credit-applied',v_now
    );
  end if;

  if v_shortfall > 0 then
    v_running_balance := round(v_running_balance-v_shortfall,2);
    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,payment_method,reason,created_by,idempotency_key,created_at
    ) values (
      p_customer_id,p_bill_id,v_balance_payment_id,'DEBIT_CREATED',-v_shortfall,v_running_balance,v_method,
      'Short payment carried forward as customer debit',p_staff_id,p_idempotency_key || ':debit-created',v_now
    );
  end if;

  if v_debit_settled > 0 then
    v_running_balance := round(v_running_balance+v_debit_settled,2);
    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,payment_method,reason,created_by,idempotency_key,created_at
    ) values (
      p_customer_id,p_bill_id,v_payment_id,'DEBIT_SETTLED',v_debit_settled,v_running_balance,v_method,
      'Previous customer debit settled from current payment',p_staff_id,p_idempotency_key || ':debit-settled',v_now
    );
  end if;

  if v_new_credit > 0 then
    v_running_balance := round(v_running_balance+v_new_credit,2);
    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,payment_method,reason,created_by,idempotency_key,created_at
    ) values (
      p_customer_id,p_bill_id,v_payment_id,'CREDIT_CREATED',v_new_credit,v_running_balance,v_method,
      'Extra payment carried forward as customer credit',p_staff_id,p_idempotency_key || ':credit-created',v_now
    );
  end if;

  update public.snooker_customers
  set balance_inr=v_running_balance,updated_at=v_now
  where id=p_customer_id;

  select coalesce(round(sum(p.amount_inr),2),0)
  into v_paid_after
  from public.snooker_bill_payments p
  where p.bill_id=p_bill_id
    and p.status in ('RECEIVED','VERIFIED');

  v_due_after := greatest(round(v_bill.total_inr-v_paid_after,2),0);
  v_status := case when v_due_after <= 0 then 'PAID' else 'PARTIALLY_PAID' end;

  update public.snooker_bills
  set paid_inr=v_paid_after,due_inr=v_due_after,status=v_status,updated_at=v_now
  where id=p_bill_id;

  v_result := jsonb_build_object(
    'ok',true,'mode','SETTLE','bill_id',p_bill_id,
    'payment_id',v_payment_id,'balance_payment_id',v_balance_payment_id,
    'method',v_method,'received_inr',v_received,
    'amount_applied_inr',v_actual_applied,
    'credit_applied_inr',v_credit_applied,
    'debit_created_inr',v_shortfall,
    'debit_settled_inr',v_debit_settled,
    'credit_created_inr',v_new_credit,
    'previous_balance_inr',v_balance,
    'customer_balance_inr',v_running_balance,
    'bill_status',v_status,'due_inr',v_due_after
  );

  insert into public.snooker_manual_settlements(
    idempotency_key,bill_id,customer_id,payment_method,received_inr,settle_mode,result,created_by
  ) values (
    p_idempotency_key,p_bill_id,p_customer_id,v_method,v_received,true,v_result,p_staff_id
  );

  return v_result;
end;
$$;

revoke all on function public.qclub_manual_settle_bill(uuid,uuid,text,numeric,boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.qclub_manual_settle_bill(uuid,uuid,text,numeric,boolean,text,text)
  to service_role;
