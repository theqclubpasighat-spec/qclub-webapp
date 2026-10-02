-- REHEARSAL ONLY: reserve tracked F&B stock across uncertain Cashfree checkout.
-- This migration is never to be applied to production without release review.
-- It depends on the payment intent, food checkout and closed-checkout rehearsal migrations.

alter table qclub_private.payment_intents
  add column if not exists terminal_at timestamptz,
  add column if not exists terminal_reason text;

alter table qclub_private.payment_intents
  drop constraint if exists payment_intents_terminal_state_check;
alter table qclub_private.payment_intents
  add constraint payment_intents_terminal_state_check
  check (not (terminal_at is not null and status='fulfilled'));

create table if not exists qclub_private.checkout_stock_reservations (
  order_id text not null references qclub_private.payment_intents(order_id) on delete restrict,
  item_id text not null references public.snooker_catalogue_items(id) on delete restrict,
  quantity numeric not null check (quantity>0),
  status text not null default 'reserved' check (status in ('reserved','fulfilled','released')),
  created_at timestamptz not null default clock_timestamp(),
  fulfilled_at timestamptz,
  released_at timestamptz,
  primary key(order_id,item_id),
  check (
    (status='reserved' and fulfilled_at is null and released_at is null)
    or (status='fulfilled' and fulfilled_at is not null and released_at is null)
    or (status='released' and fulfilled_at is null and released_at is not null)
  )
);
alter table qclub_private.checkout_stock_reservations enable row level security;
revoke all on qclub_private.checkout_stock_reservations from public,anon,authenticated;
grant select,insert,update on qclub_private.checkout_stock_reservations to service_role;

-- Terminal state is a server-controlled lifecycle field, not a mutable commercial term.
create or replace function qclub_private.freeze_payment_terms()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (to_jsonb(new)-array['status','gateway_payment_id','fulfilled_at','terminal_at','terminal_reason']) is distinct from
     (to_jsonb(old)-array['status','gateway_payment_id','fulfilled_at','terminal_at','terminal_reason']) then
    raise exception 'IMMUTABLE_PAYMENT_TERMS';
  end if;
  if old.status='fulfilled' and new is distinct from old then
    raise exception 'FULFILLED_PAYMENT_IMMUTABLE';
  end if;
  if old.terminal_at is not null and new is distinct from old then
    raise exception 'TERMINAL_PAYMENT_IMMUTABLE';
  end if;
  if new.status='fulfilled' and new.terminal_at is not null then
    raise exception 'TERMINAL_PAYMENT_CANNOT_FULFILL';
  end if;
  return new;
end $$;

create or replace function public.qclub_payment_intent(p_order_id text,p_receipt_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'amount_paise',i.amount_paise,
    'status',i.status,
    'expires_at',i.expires_at,
    'terminal_at',i.terminal_at,
    'terminal_reason',i.terminal_reason
  )
  from qclub_private.payment_intents i
  where i.order_id=p_order_id and i.receipt_hash=p_receipt_hash
$$;
revoke all on function public.qclub_payment_intent(text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_intent(text,text) to service_role;

create or replace function public.qclub_payment_intent_service(p_order_id text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'amount_paise',i.amount_paise,
    'status',i.status,
    'expires_at',i.expires_at,
    'terminal_at',i.terminal_at,
    'terminal_reason',i.terminal_reason
  )
  from qclub_private.payment_intents i where i.order_id=p_order_id
$$;
revoke all on function public.qclub_payment_intent_service(text) from public,anon,authenticated;
grant execute on function public.qclub_payment_intent_service(text) to service_role;

create or replace function public.qclub_food_checkout(
  p_order_id text,p_receipt_hash text,p_request_hash text,p_items jsonb,p_customer_name text,p_customer_phone text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  existing qclub_private.payment_intents%rowtype;
  line jsonb;
  item public.snooker_catalogue_items%rowtype;
  reservation jsonb;
  quantity integer;
  total bigint:=0;
  unit_paise bigint;
  lines jsonb:='[]'::jsonb;
  reservations jsonb:='[]'::jsonb;
  seen text[]:='{}';
  expires timestamptz;
begin
  if p_order_id is null or p_order_id !~ '^qcr_[0-9a-f-]{36}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120
    or p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok',false,'reason','INVALID_CHECKOUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id,82918));
  if exists(select 1 from qclub_private.closed_checkouts where order_id=p_order_id) then
    return jsonb_build_object('ok',false,'reason','CHECKOUT_CLOSED');
  end if;

  select * into existing from qclub_private.payment_intents where order_id=p_order_id;
  if found then
    if existing.receipt_hash<>p_receipt_hash or existing.request_hash is distinct from p_request_hash then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_CONFLICT');
    end if;
    if existing.terminal_at is not null or existing.expires_at<=clock_timestamp() then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_EXPIRED');
    end if;
    return jsonb_build_object(
      'ok',true,'amount_paise',existing.amount_paise,'status',existing.status,'expires_at',existing.expires_at
    );
  end if;

  if p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 30 then
    return jsonb_build_object('ok',false,'reason','INVALID_CART');
  end if;

  -- First pass validates and locks all catalogue rows in deterministic item-id order.
  -- No stock is changed until every line has passed validation.
  for line in select value from jsonb_array_elements(p_items) order by value->>'itemId' loop
    if jsonb_typeof(line)<>'object'
      or exists(select 1 from jsonb_object_keys(line) k where k not in ('itemId','quantity'))
      or jsonb_typeof(line->'itemId') is distinct from 'string'
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or coalesce(line->>'quantity','') !~ '^[0-9]{1,2}$'
      or coalesce(length(line->>'itemId'),0) not between 1 and 160
      or (line->>'itemId')=any(seen) then
      return jsonb_build_object('ok',false,'reason','INVALID_CART');
    end if;

    quantity:=(line->>'quantity')::integer;
    if quantity not between 1 and 20 then
      return jsonb_build_object('ok',false,'reason','INVALID_CART');
    end if;
    seen:=array_append(seen,line->>'itemId');

    select i.* into item
    from public.snooker_catalogue_items i
    join public.qclub_fnb_categories c on c.category_key=i.qlounge_category_key and c.active=true
    where i.id=line->>'itemId'
      and i.active=true
      and i.show_on_qlounge=true
      and i.online_order_enabled=true
    for update of i;

    if not found then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;
    if item.selling_price_inr is null or item.selling_price_inr<=0 or item.selling_price_inr>999999.99
      or item.selling_price_inr*100<>trunc(item.selling_price_inr*100) then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;
    if item.track_inventory and coalesce(item.current_stock,0)<quantity then
      return jsonb_build_object('ok',false,'reason','INSUFFICIENT_STOCK');
    end if;

    unit_paise:=(item.selling_price_inr*100)::bigint;
    total:=total+unit_paise*quantity;
    lines:=lines||jsonb_build_array(jsonb_build_object(
      'id',item.id,'itemId',item.id,'name',item.name,'displayName',item.name,
      'qty',quantity,'quantity',quantity,'price',unit_paise/100.0,
      'lineTotal',(unit_paise*quantity)/100.0,'trackInventory',item.track_inventory
    ));
    if item.track_inventory then
      reservations:=reservations||jsonb_build_array(jsonb_build_object('item_id',item.id,'quantity',quantity));
    end if;
  end loop;

  if total>99999999 then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;

  expires:=clock_timestamp()+interval '1 hour';
  insert into qclub_private.payment_intents(
    order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload,expires_at
  ) values(
    p_order_id,p_receipt_hash,p_request_hash,total,'q_lounge_order',p_order_id,
    jsonb_build_object(
      'id',p_order_id,'orderNo',p_order_id,'customerName',trim(p_customer_name),
      'customerMobile',p_customer_phone,'items',lines,'total',total/100.0,
      'printStatus','pending_auto_print','createdAt',clock_timestamp()
    ),
    expires
  );

  -- Second pass consumes available-to-sell stock as a reservation. Because every
  -- row is still locked from the validation pass, concurrent checkouts cannot oversell.
  for reservation in select value from jsonb_array_elements(reservations) order by value->>'item_id' loop
    update public.snooker_catalogue_items
      set current_stock=current_stock-(reservation->>'quantity')::numeric,
          updated_at=clock_timestamp()
      where id=reservation->>'item_id';
    insert into qclub_private.checkout_stock_reservations(order_id,item_id,quantity)
      values(p_order_id,reservation->>'item_id',(reservation->>'quantity')::numeric);
  end loop;

  return jsonb_build_object(
    'ok',true,'amount_paise',total,'status','pending','expires_at',expires
  );
end $$;
revoke all on function public.qclub_food_checkout(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.qclub_food_checkout(text,text,text,jsonb,text,text) to service_role;

create or replace function public.qclub_payment_fulfill(
  p_order_id text,p_receipt_hash text,p_amount_paise bigint,p_currency text,p_payment_id text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare intent qclub_private.payment_intents%rowtype; target_status text; written integer;
begin
  select * into intent from qclub_private.payment_intents
    where order_id=p_order_id and receipt_hash=p_receipt_hash for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if intent.terminal_at is not null then return jsonb_build_object('ok',false,'conflict',true); end if;
  if intent.amount_paise is distinct from p_amount_paise or intent.currency is distinct from p_currency
    or p_payment_id is null or p_payment_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  if intent.status='fulfilled' then
    return jsonb_build_object('ok',intent.gateway_payment_id=p_payment_id,'conflict',intent.gateway_payment_id<>p_payment_id);
  end if;
  target_status:=case when intent.record_type='booking_request' then 'paid_verified' else 'paid' end;
  insert into public.qclub_operational_records(record_type,record_key,payload,source,status,updated_at)
    values(intent.record_type,intent.record_key,
      intent.payload || jsonb_build_object(
        'gatewayOrderId',intent.order_id,'paymentStatus','Paid',
        'source','cashfree_verified_server','updatedAt',clock_timestamp(),
        'status',case when intent.record_type='booking_request' then 'paid_verified' else 'Paid' end
      ) || case when intent.record_type='booking_request'
           then jsonb_build_object('amount',intent.amount_paise/100.0)
           else jsonb_build_object('total',intent.amount_paise/100.0) end,
      'cashfree_verified_server',target_status,clock_timestamp())
    on conflict (record_type,record_key) do nothing;
  get diagnostics written=row_count;
  if written<>1 then return jsonb_build_object('ok',false,'conflict',true); end if;

  update qclub_private.checkout_stock_reservations
    set status='fulfilled',fulfilled_at=clock_timestamp()
    where order_id=p_order_id and status='reserved';

  update qclub_private.payment_intents
    set status='fulfilled',gateway_payment_id=p_payment_id,fulfilled_at=clock_timestamp()
    where order_id=p_order_id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qclub_payment_fulfill(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_fulfill(text,text,bigint,text,text) to service_role;

create or replace function public.qclub_payment_fulfill_service(
  p_order_id text,p_amount_paise bigint,p_currency text,p_payment_id text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare intent qclub_private.payment_intents%rowtype; target_status text; written integer;
begin
  select * into intent from qclub_private.payment_intents where order_id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if intent.terminal_at is not null then return jsonb_build_object('ok',false,'conflict',true); end if;
  if intent.amount_paise is distinct from p_amount_paise or intent.currency is distinct from p_currency
    or p_payment_id is null or p_payment_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  if intent.status='fulfilled' then
    return jsonb_build_object('ok',intent.gateway_payment_id=p_payment_id,'conflict',intent.gateway_payment_id<>p_payment_id);
  end if;
  target_status:=case when intent.record_type='booking_request' then 'paid_verified' else 'paid' end;
  insert into public.qclub_operational_records(record_type,record_key,payload,source,status,updated_at)
    values(intent.record_type,intent.record_key,
      intent.payload || jsonb_build_object(
        'gatewayOrderId',intent.order_id,'paymentStatus','Paid',
        'source','cashfree_verified_server','updatedAt',clock_timestamp(),
        'status',case when intent.record_type='booking_request' then 'paid_verified' else 'Paid' end
      ) || case when intent.record_type='booking_request'
           then jsonb_build_object('amount',intent.amount_paise/100.0)
           else jsonb_build_object('total',intent.amount_paise/100.0) end,
      'cashfree_verified_server',target_status,clock_timestamp())
    on conflict (record_type,record_key) do nothing;
  get diagnostics written=row_count;
  if written<>1 then return jsonb_build_object('ok',false,'conflict',true); end if;

  update qclub_private.checkout_stock_reservations
    set status='fulfilled',fulfilled_at=clock_timestamp()
    where order_id=p_order_id and status='reserved';

  update qclub_private.payment_intents
    set status='fulfilled',gateway_payment_id=p_payment_id,fulfilled_at=clock_timestamp()
    where order_id=p_order_id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qclub_payment_fulfill_service(text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_fulfill_service(text,bigint,text,text) to service_role;

-- Called only after the server independently verifies that Cashfree itself is final
-- (EXPIRED or TERMINATED) and there is no SUCCESS/PENDING transaction.
create function public.qclub_payment_close_terminal_service(p_order_id text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  intent qclub_private.payment_intents%rowtype;
  reservation qclub_private.checkout_stock_reservations%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^qcr_[0-9a-f-]{36}$'
    or p_reason not in ('EXPIRED','TERMINATED') then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id,82918));
  select * into intent from qclub_private.payment_intents where order_id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if intent.status='fulfilled' then return jsonb_build_object('ok',false,'conflict',true); end if;
  if intent.terminal_at is not null then
    return jsonb_build_object('ok',true,'released',false,'terminal_reason',intent.terminal_reason);
  end if;

  for reservation in
    select * from qclub_private.checkout_stock_reservations
    where order_id=p_order_id and status='reserved'
    order by item_id
    for update
  loop
    perform 1 from public.snooker_catalogue_items where id=reservation.item_id for update;
    update public.snooker_catalogue_items
      set current_stock=coalesce(current_stock,0)+reservation.quantity,
          updated_at=clock_timestamp()
      where id=reservation.item_id;
    update qclub_private.checkout_stock_reservations
      set status='released',released_at=clock_timestamp()
      where order_id=p_order_id and item_id=reservation.item_id and status='reserved';
  end loop;

  update qclub_private.payment_intents
    set terminal_at=clock_timestamp(),terminal_reason=p_reason
    where order_id=p_order_id;

  return jsonb_build_object('ok',true,'released',true,'terminal_reason',p_reason);
end $$;
revoke all on function public.qclub_payment_close_terminal_service(text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_close_terminal_service(text,text) to service_role;
