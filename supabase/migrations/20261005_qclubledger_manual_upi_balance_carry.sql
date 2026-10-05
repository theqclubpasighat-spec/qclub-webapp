-- QclubLedger manual Cash/UPI and timestamped player carry balances.
-- Positive snooker_customers.balance_inr = credit owed to player.
-- Negative snooker_customers.balance_inr = debit owed to The Q Club.

alter table public.snooker_customers
  add column if not exists balance_inr numeric(12,2) not null default 0;

alter table public.snooker_bill_items
  drop constraint if exists snooker_bill_items_item_type_check;
alter table public.snooker_bill_items
  add constraint snooker_bill_items_item_type_check
  check (item_type = any (array['GAME'::text,'TABLE_TIME'::text,'FNB'::text,'DISCOUNT'::text,'BALANCE'::text]));

create table if not exists public.snooker_customer_balance_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.snooker_customers(id) on delete restrict,
  bill_id uuid references public.snooker_bills(id) on delete restrict,
  payment_id uuid references public.snooker_bill_payments(id) on delete restrict,
  entry_type text not null check (entry_type = any (array[
    'CREDIT_CARRY'::text,
    'DEBIT_CARRY'::text,
    'CREDIT_APPLIED'::text,
    'DEBIT_APPLIED'::text,
    'ADMIN_ADJUSTMENT'::text
  ])),
  delta_inr numeric(12,2) not null check (delta_inr <> 0),
  balance_after_inr numeric(12,2) not null,
  note text,
  staff_id text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create index if not exists snooker_customer_balance_entries_customer_idx
  on public.snooker_customer_balance_entries(customer_id, created_at desc);
create index if not exists snooker_customer_balance_entries_bill_idx
  on public.snooker_customer_balance_entries(bill_id, created_at desc);

alter table public.snooker_customer_balance_entries enable row level security;
revoke all on public.snooker_customer_balance_entries from public, anon, authenticated;
grant select, insert on public.snooker_customer_balance_entries to service_role;

-- Historical Cashfree dynamic-QR rows were previously labelled UPI.
-- ONLINE now means Cashfree dynamic QR; UPI is reserved for staff-confirmed manual QR payments.
update public.snooker_bill_payments
set method = 'ONLINE', updated_at = now()
where method = 'UPI' and cashfree_order_id is not null;

create or replace function public.qclub_snooker_record_manual_payment(
  p_bill_id uuid,
  p_method text,
  p_received_inr numeric,
  p_staff_id text,
  p_idempotency_key text,
  p_carry_difference boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill public.snooker_bills%rowtype;
  v_customer public.snooker_customers%rowtype;
  v_payment public.snooker_bill_payments%rowtype;
  v_existing public.snooker_bill_payments%rowtype;
  v_due numeric(12,2);
  v_received numeric(12,2);
  v_applied numeric(12,2);
  v_difference numeric(12,2);
  v_change numeric(12,2) := 0;
  v_balance_after numeric(12,2);
  v_paid numeric(12,2);
  v_new_due numeric(12,2);
  v_status text;
  v_pending boolean;
begin
  if p_method not in ('CASH','UPI') then
    raise exception 'INVALID_MANUAL_PAYMENT_METHOD';
  end if;

  v_received := round(coalesce(p_received_inr,0)::numeric,2);
  if v_received <= 0 then
    raise exception 'PAYMENT_AMOUNT_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is not null then
    select * into v_existing
    from public.snooker_bill_payments
    where idempotency_key = p_idempotency_key
    limit 1;
    if found then
      select * into v_bill from public.snooker_bills where id=v_existing.bill_id;
      if v_bill.customer_id is not null then
        select * into v_customer from public.snooker_customers where id=v_bill.customer_id;
      end if;
      return jsonb_build_object(
        'payment_id',v_existing.id,'bill_id',v_existing.bill_id,'method',v_existing.method,
        'amount_applied_inr',v_existing.amount_inr,'cash_tendered_inr',v_existing.cash_tendered_inr,
        'change_inr',coalesce(v_existing.change_inr,0),'status',v_existing.status,
        'bill_status',v_bill.status,'due_inr',v_bill.due_inr,
        'customer_balance_inr',coalesce(v_customer.balance_inr,0),'duplicate',true
      );
    end if;
  end if;

  select * into v_bill from public.snooker_bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.status='CANCELLED' then raise exception 'BILL_CANCELLED'; end if;
  if v_bill.status='PAID' or coalesce(v_bill.due_inr,0)<=0 then raise exception 'BILL_ALREADY_PAID'; end if;

  select exists(
    select 1 from public.snooker_bill_payments
    where bill_id=p_bill_id and status='PENDING' and cashfree_order_id is not null
  ) into v_pending;
  if v_pending then raise exception 'ONLINE_PAYMENT_PENDING_CANCEL_FIRST'; end if;

  v_due := round(coalesce(v_bill.due_inr,0)::numeric,2);
  v_applied := least(v_due,v_received);
  v_difference := round((v_received-v_due)::numeric,2);

  if p_carry_difference and v_difference <> 0 and v_bill.customer_id is null then
    raise exception 'CUSTOMER_REQUIRED_FOR_BALANCE';
  end if;

  if not p_carry_difference and p_method='CASH' and v_difference > 0 then
    v_change := v_difference;
  end if;

  insert into public.snooker_bill_payments(
    bill_id,method,amount_inr,cash_tendered_inr,change_inr,status,provider_payload,received_by,idempotency_key
  ) values (
    p_bill_id,p_method,v_applied,
    case when p_method='CASH' then v_received else null end,
    case when p_method='CASH' then v_change else null end,
    'RECEIVED',
    jsonb_build_object('manual',true,'received_inr',v_received,'carry_difference',p_carry_difference),
    p_staff_id,nullif(btrim(coalesce(p_idempotency_key,'')),'')
  ) returning * into v_payment;

  if p_carry_difference and v_difference < 0 then
    insert into public.snooker_bill_payments(
      bill_id,method,amount_inr,status,provider_payload,received_by
    ) values (
      p_bill_id,'BALANCE',abs(v_difference),'RECEIVED',
      jsonb_build_object('kind','DEBIT_CARRY','customer_id',v_bill.customer_id),
      p_staff_id
    );

    update public.snooker_customers
    set balance_inr=round((balance_inr+v_difference)::numeric,2),updated_at=now()
    where id=v_bill.customer_id
    returning * into v_customer;
    v_balance_after := v_customer.balance_inr;

    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,note,staff_id,idempotency_key
    ) values (
      v_bill.customer_id,p_bill_id,v_payment.id,'DEBIT_CARRY',v_difference,v_balance_after,
      'Short payment carried forward from bill '||v_bill.bill_no,p_staff_id,
      case when nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then null else p_idempotency_key||':balance' end
    );
  elsif p_carry_difference and v_difference > 0 then
    update public.snooker_customers
    set balance_inr=round((balance_inr+v_difference)::numeric,2),updated_at=now()
    where id=v_bill.customer_id
    returning * into v_customer;
    v_balance_after := v_customer.balance_inr;

    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,note,staff_id,idempotency_key
    ) values (
      v_bill.customer_id,p_bill_id,v_payment.id,'CREDIT_CARRY',v_difference,v_balance_after,
      'Extra payment carried forward from bill '||v_bill.bill_no,p_staff_id,
      case when nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then null else p_idempotency_key||':balance' end
    );
  elsif v_bill.customer_id is not null then
    select * into v_customer from public.snooker_customers where id=v_bill.customer_id;
    v_balance_after := coalesce(v_customer.balance_inr,0);
  else
    v_balance_after := 0;
  end if;

  select coalesce(sum(amount_inr),0)::numeric(12,2),
         bool_or(status='PENDING')
  into v_paid,v_pending
  from public.snooker_bill_payments
  where bill_id=p_bill_id and status in ('RECEIVED','VERIFIED','PENDING');

  select coalesce(sum(amount_inr),0)::numeric(12,2)
  into v_paid
  from public.snooker_bill_payments
  where bill_id=p_bill_id and status in ('RECEIVED','VERIFIED');

  select exists(
    select 1 from public.snooker_bill_payments where bill_id=p_bill_id and status='PENDING'
  ) into v_pending;

  v_new_due := greatest(0,round((v_bill.total_inr-v_paid)::numeric,2));
  v_status := case
    when v_new_due<=0 then 'PAID'
    when v_pending then 'PAYMENT_PENDING'
    when v_paid>0 then 'PARTIALLY_PAID'
    else 'UNPAID'
  end;

  update public.snooker_bills
  set paid_inr=v_paid,due_inr=v_new_due,status=v_status,updated_at=now()
  where id=p_bill_id;

  return jsonb_build_object(
    'payment_id',v_payment.id,'bill_id',p_bill_id,'method',p_method,
    'amount_applied_inr',v_applied,'cash_tendered_inr',case when p_method='CASH' then v_received else null end,
    'change_inr',v_change,'carry_inr',case when p_carry_difference then v_difference else 0 end,
    'customer_balance_inr',v_balance_after,'status','RECEIVED',
    'bill_status',v_status,'due_inr',v_new_due
  );
end;
$$;

revoke all on function public.qclub_snooker_record_manual_payment(uuid,text,numeric,text,text,boolean) from public, anon, authenticated;
grant execute on function public.qclub_snooker_record_manual_payment(uuid,text,numeric,text,text,boolean) to service_role;

create or replace function public.qclub_snooker_apply_customer_balance(
  p_bill_id uuid,
  p_staff_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill public.snooker_bills%rowtype;
  v_customer public.snooker_customers%rowtype;
  v_existing public.snooker_customer_balance_entries%rowtype;
  v_payment_id uuid;
  v_balance numeric(12,2);
  v_amount numeric(12,2);
  v_paid numeric(12,2);
  v_due numeric(12,2);
  v_status text;
begin
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is not null then
    select * into v_existing from public.snooker_customer_balance_entries
    where idempotency_key=p_idempotency_key limit 1;
    if found then
      select * into v_bill from public.snooker_bills where id=v_existing.bill_id;
      select * into v_customer from public.snooker_customers where id=v_existing.customer_id;
      return jsonb_build_object(
        'bill_id',v_existing.bill_id,'applied_inr',abs(v_existing.delta_inr),
        'entry_type',v_existing.entry_type,'customer_balance_inr',v_customer.balance_inr,
        'bill_status',v_bill.status,'due_inr',v_bill.due_inr,'duplicate',true
      );
    end if;
  end if;

  select * into v_bill from public.snooker_bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.bill_source='WALK_IN_FNB' then raise exception 'BALANCE_NOT_AVAILABLE_FOR_WALKIN_FNB'; end if;
  if v_bill.status in ('PAID','CANCELLED') then raise exception 'BILL_NOT_OPEN'; end if;
  if v_bill.customer_id is null then raise exception 'CUSTOMER_REQUIRED_FOR_BALANCE'; end if;

  if exists(select 1 from public.snooker_bill_payments where bill_id=p_bill_id and status='PENDING' and cashfree_order_id is not null) then
    raise exception 'ONLINE_PAYMENT_PENDING_CANCEL_FIRST';
  end if;

  select * into v_customer from public.snooker_customers where id=v_bill.customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  v_balance := round(coalesce(v_customer.balance_inr,0)::numeric,2);
  if v_balance=0 then
    return jsonb_build_object('bill_id',p_bill_id,'applied_inr',0,'entry_type','NONE','customer_balance_inr',0,'bill_status',v_bill.status,'due_inr',v_bill.due_inr);
  end if;

  if v_balance > 0 then
    v_amount := least(v_balance,round(coalesce(v_bill.due_inr,0)::numeric,2));
    if v_amount<=0 then raise exception 'NO_BILL_DUE_FOR_CREDIT'; end if;
    insert into public.snooker_bill_payments(
      bill_id,method,amount_inr,status,provider_payload,received_by,idempotency_key
    ) values (
      p_bill_id,'BALANCE',v_amount,'RECEIVED',jsonb_build_object('kind','CREDIT_APPLIED','customer_id',v_bill.customer_id),
      p_staff_id,nullif(btrim(coalesce(p_idempotency_key,'')),'')
    ) returning id into v_payment_id;

    update public.snooker_customers
    set balance_inr=round((balance_inr-v_amount)::numeric,2),updated_at=now()
    where id=v_bill.customer_id returning * into v_customer;

    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,note,staff_id,idempotency_key
    ) values (
      v_bill.customer_id,p_bill_id,v_payment_id,'CREDIT_APPLIED',-v_amount,v_customer.balance_inr,
      'Player credit applied to bill '||v_bill.bill_no,p_staff_id,
      case when nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then null else p_idempotency_key||':entry' end
    );
  else
    v_amount := abs(v_balance);
    insert into public.snooker_bill_items(
      bill_id,item_type,reference_id,description,quantity,unit_price_inr,line_total_inr,metadata
    ) values (
      p_bill_id,'BALANCE',null,'Previous player debit carried forward',1,v_amount,v_amount,
      jsonb_build_object('kind','DEBIT_APPLIED','customer_id',v_bill.customer_id,'prior_balance_inr',v_balance)
    );

    update public.snooker_bills
    set total_inr=round((total_inr+v_amount)::numeric,2),due_inr=round((due_inr+v_amount)::numeric,2),
        status=case when paid_inr>0 then 'PARTIALLY_PAID' else 'UNPAID' end,updated_at=now()
    where id=p_bill_id returning * into v_bill;

    update public.snooker_customers
    set balance_inr=round((balance_inr+v_amount)::numeric,2),updated_at=now()
    where id=v_bill.customer_id returning * into v_customer;

    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,note,staff_id,idempotency_key
    ) values (
      v_bill.customer_id,p_bill_id,null,'DEBIT_APPLIED',v_amount,v_customer.balance_inr,
      'Previous player debit added to bill '||v_bill.bill_no,p_staff_id,
      nullif(btrim(coalesce(p_idempotency_key,'')),'')
    );
  end if;

  select coalesce(sum(amount_inr),0)::numeric(12,2)
  into v_paid from public.snooker_bill_payments
  where bill_id=p_bill_id and status in ('RECEIVED','VERIFIED');

  select * into v_bill from public.snooker_bills where id=p_bill_id;
  v_due := greatest(0,round((v_bill.total_inr-v_paid)::numeric,2));
  v_status := case when v_due<=0 then 'PAID' when v_paid>0 then 'PARTIALLY_PAID' else 'UNPAID' end;
  update public.snooker_bills set paid_inr=v_paid,due_inr=v_due,status=v_status,updated_at=now() where id=p_bill_id;

  return jsonb_build_object(
    'bill_id',p_bill_id,'applied_inr',v_amount,
    'entry_type',case when v_balance>0 then 'CREDIT_APPLIED' else 'DEBIT_APPLIED' end,
    'customer_balance_inr',v_customer.balance_inr,'bill_status',v_status,'due_inr',v_due
  );
end;
$$;

revoke all on function public.qclub_snooker_apply_customer_balance(uuid,text,text) from public, anon, authenticated;
grant execute on function public.qclub_snooker_apply_customer_balance(uuid,text,text) to service_role;
