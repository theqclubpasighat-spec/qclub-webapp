-- Atomic customer-level Club Tab settlement allocation.
create or replace function public.qclub_snooker_record_customer_manual_settlement(
  p_customer_id uuid,
  p_method text,
  p_received_inr numeric,
  p_staff_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer public.snooker_customers%rowtype;
  v_existing public.snooker_customer_settlements%rowtype;
  v_settlement_id uuid := gen_random_uuid();
  v_settlement_no text;
  v_received numeric(12,2);
  v_remaining numeric(12,2);
  v_total_due numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_pay numeric(12,2);
  v_bill public.snooker_bills%rowtype;
  v_payment_id uuid;
  v_last_payment_id uuid;
  v_last_bill_id uuid;
  v_balance_after numeric(12,2);
  v_due_after numeric(12,2);
  v_open_count integer;
begin
  if p_method not in ('CASH','UPI') then
    raise exception 'INVALID_MANUAL_PAYMENT_METHOD';
  end if;
  v_received := round(coalesce(p_received_inr,0)::numeric,2);
  if v_received <= 0 then raise exception 'PAYMENT_AMOUNT_REQUIRED'; end if;

  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is not null then
    select * into v_existing
    from public.snooker_customer_settlements
    where idempotency_key=p_idempotency_key
    limit 1;
    if found then
      select coalesce(sum(due_inr),0)::numeric(12,2) into v_due_after
      from public.snooker_bills
      where customer_id=p_customer_id and status not in ('PAID','CANCELLED') and due_inr>0;
      return jsonb_build_object(
        'settlement_id',v_existing.id,'settlement_no',v_existing.settlement_no,
        'method',v_existing.method,'received_inr',v_existing.received_inr,
        'amount_applied_inr',v_existing.amount_inr-v_existing.carry_inr,
        'carry_inr',v_existing.carry_inr,'due_inr',v_due_after,
        'closed',v_due_after<=0,'duplicate',true
      );
    end if;
  end if;

  select * into v_customer from public.snooker_customers where id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  if exists(
    select 1
    from public.snooker_bills b
    join public.snooker_bill_payments p on p.bill_id=b.id
    where b.customer_id=p_customer_id
      and b.status not in ('PAID','CANCELLED')
      and p.status='PENDING'
      and p.cashfree_order_id is not null
  ) or exists(
    select 1 from public.snooker_customer_settlements
    where customer_id=p_customer_id and status='PENDING' and cashfree_order_id is not null
  ) then
    raise exception 'ONLINE_PAYMENT_PENDING_CANCEL_FIRST';
  end if;

  select coalesce(sum(due_inr),0)::numeric(12,2),count(*)::int
  into v_total_due,v_open_count
  from public.snooker_bills
  where customer_id=p_customer_id and status not in ('PAID','CANCELLED') and due_inr>0;

  if v_open_count=0 or v_total_due<=0 then raise exception 'NOTHING_TO_PAY'; end if;

  v_settlement_no := 'QS-' || to_char(now(),'YYMMDD') || '-' || upper(substr(replace(v_settlement_id::text,'-',''),1,6));

  insert into public.snooker_customer_settlements(
    id,settlement_no,customer_id,method,amount_inr,received_inr,carry_inr,status,
    received_by,idempotency_key,provider_payload
  ) values (
    v_settlement_id,v_settlement_no,p_customer_id,p_method,v_received,v_received,0,'RECEIVED',
    p_staff_id,nullif(btrim(coalesce(p_idempotency_key,'')),''),
    jsonb_build_object('manual',true,'total_due_before_inr',v_total_due)
  );

  v_remaining := v_received;

  for v_bill in
    select * from public.snooker_bills
    where customer_id=p_customer_id and status not in ('PAID','CANCELLED') and due_inr>0
    order by coalesce(finalized_at,updated_at),updated_at,id
    for update
  loop
    exit when v_remaining<=0;
    v_pay := least(round(v_bill.due_inr::numeric,2),v_remaining);
    if v_pay<=0 then continue; end if;

    insert into public.snooker_bill_payments(
      bill_id,method,amount_inr,status,provider_payload,received_by,idempotency_key
    ) values (
      v_bill.id,p_method,v_pay,'RECEIVED',
      jsonb_build_object('customer_settlement_id',v_settlement_id,'settlement_no',v_settlement_no),
      p_staff_id,
      case when nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then null
           else p_idempotency_key||':'||v_bill.id::text end
    ) returning id into v_payment_id;

    insert into public.snooker_customer_settlement_allocations(settlement_id,bill_id,amount_inr)
    values(v_settlement_id,v_bill.id,v_pay)
    on conflict(settlement_id,bill_id) do update set amount_inr=excluded.amount_inr;

    update public.snooker_bills
    set paid_inr=round((coalesce(paid_inr,0)+v_pay)::numeric,2),
        due_inr=greatest(0,round((coalesce(due_inr,0)-v_pay)::numeric,2)),
        status=case
          when greatest(0,round((coalesce(due_inr,0)-v_pay)::numeric,2))<=0 then 'PAID'
          else 'PARTIALLY_PAID'
        end,
        updated_at=now()
    where id=v_bill.id;

    v_remaining := round((v_remaining-v_pay)::numeric,2);
    v_applied := round((v_applied+v_pay)::numeric,2);
    v_last_payment_id := v_payment_id;
    v_last_bill_id := v_bill.id;
  end loop;

  if v_remaining>0 then
    update public.snooker_customers
    set balance_inr=round((coalesce(balance_inr,0)+v_remaining)::numeric,2),updated_at=now()
    where id=p_customer_id
    returning balance_inr into v_balance_after;

    insert into public.snooker_customer_balance_entries(
      customer_id,bill_id,payment_id,entry_type,delta_inr,balance_after_inr,note,staff_id,idempotency_key
    ) values(
      p_customer_id,v_last_bill_id,v_last_payment_id,'CREDIT_CARRY',v_remaining,v_balance_after,
      'Extra payment carried forward from Club Tab settlement '||v_settlement_no,p_staff_id,
      case when nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then null else p_idempotency_key||':credit' end
    );
  else
    v_balance_after:=coalesce(v_customer.balance_inr,0);
  end if;

  update public.snooker_customer_settlements
  set carry_inr=v_remaining,updated_at=now()
  where id=v_settlement_id;

  select coalesce(sum(due_inr),0)::numeric(12,2) into v_due_after
  from public.snooker_bills
  where customer_id=p_customer_id and status not in ('PAID','CANCELLED') and due_inr>0;

  return jsonb_build_object(
    'settlement_id',v_settlement_id,'settlement_no',v_settlement_no,
    'method',p_method,'received_inr',v_received,'amount_applied_inr',v_applied,
    'carry_inr',v_remaining,'customer_balance_inr',v_balance_after,
    'total_due_before_inr',v_total_due,'due_inr',v_due_after,'closed',v_due_after<=0
  );
end;
$$;

create or replace function public.qclub_snooker_fulfill_customer_settlement(
  p_settlement_id uuid,
  p_cashfree_payment_id text,
  p_provider_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settlement public.snooker_customer_settlements%rowtype;
  v_alloc public.snooker_customer_settlement_allocations%rowtype;
  v_bill public.snooker_bills%rowtype;
  v_payment_id uuid;
  v_pay numeric(12,2);
  v_due_after numeric(12,2);
begin
  select * into v_settlement
  from public.snooker_customer_settlements
  where id=p_settlement_id
  for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;

  if v_settlement.status='VERIFIED' then
    select coalesce(sum(due_inr),0)::numeric(12,2) into v_due_after
    from public.snooker_bills
    where customer_id=v_settlement.customer_id and status not in ('PAID','CANCELLED') and due_inr>0;
    return jsonb_build_object('settlement_id',v_settlement.id,'status','VERIFIED','due_inr',v_due_after,'closed',v_due_after<=0,'duplicate',true);
  end if;
  if v_settlement.method<>'ONLINE' or v_settlement.status<>'PENDING' then
    raise exception 'SETTLEMENT_NOT_PENDING';
  end if;

  for v_alloc in
    select * from public.snooker_customer_settlement_allocations
    where settlement_id=p_settlement_id
    order by created_at,id
  loop
    select * into v_bill from public.snooker_bills where id=v_alloc.bill_id for update;
    if not found or v_bill.status in ('PAID','CANCELLED') or v_bill.due_inr<=0 then
      continue;
    end if;
    v_pay:=least(round(v_alloc.amount_inr::numeric,2),round(v_bill.due_inr::numeric,2));
    if v_pay<=0 then continue; end if;

    insert into public.snooker_bill_payments(
      bill_id,method,amount_inr,status,cashfree_payment_id,provider_payload,received_by,verified_at,idempotency_key
    ) values(
      v_bill.id,'ONLINE',v_pay,'VERIFIED',nullif(btrim(coalesce(p_cashfree_payment_id,'')),''),
      jsonb_build_object(
        'customer_settlement_id',v_settlement.id,
        'settlement_no',v_settlement.settlement_no,
        'cashfree_order_id',v_settlement.cashfree_order_id,
        'provider',coalesce(p_provider_payload,'{}'::jsonb)
      ),
      v_settlement.received_by,now(),'club-settlement:'||v_settlement.id::text||':'||v_bill.id::text
    )
    on conflict(idempotency_key) do nothing
    returning id into v_payment_id;

    update public.snooker_bills
    set paid_inr=round((coalesce(paid_inr,0)+v_pay)::numeric,2),
        due_inr=greatest(0,round((coalesce(due_inr,0)-v_pay)::numeric,2)),
        status=case
          when greatest(0,round((coalesce(due_inr,0)-v_pay)::numeric,2))<=0 then 'PAID'
          else 'PARTIALLY_PAID'
        end,
        updated_at=now()
    where id=v_bill.id;
  end loop;

  update public.snooker_customer_settlements
  set status='VERIFIED',cashfree_payment_id=nullif(btrim(coalesce(p_cashfree_payment_id,'')),''),
      verified_at=now(),provider_payload=coalesce(provider_payload,'{}'::jsonb)||coalesce(p_provider_payload,'{}'::jsonb),updated_at=now()
  where id=p_settlement_id
  returning * into v_settlement;

  select coalesce(sum(due_inr),0)::numeric(12,2) into v_due_after
  from public.snooker_bills
  where customer_id=v_settlement.customer_id and status not in ('PAID','CANCELLED') and due_inr>0;

  return jsonb_build_object(
    'settlement_id',v_settlement.id,'settlement_no',v_settlement.settlement_no,
    'status',v_settlement.status,'due_inr',v_due_after,'closed',v_due_after<=0
  );
end;
$$;

revoke all on function public.qclub_snooker_record_customer_manual_settlement(uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.qclub_snooker_fulfill_customer_settlement(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.qclub_snooker_record_customer_manual_settlement(uuid,text,numeric,text,text) to service_role;
grant execute on function public.qclub_snooker_fulfill_customer_settlement(uuid,text,jsonb) to service_role;
