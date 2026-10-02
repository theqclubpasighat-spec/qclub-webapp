-- REHEARSAL ONLY: QShop server pricing and atomic stock reservations.
-- QShop catalogue remains in qclub_state to mirror production, but this migration
-- is for an isolated rehearsal database only.

create table qclub_private.shop_stock_reservations (
  order_id text not null references qclub_private.payment_intents(order_id) on delete restrict,
  item_id text not null,
  option_id text not null default '',
  quantity integer not null check(quantity between 1 and 20),
  status text not null default 'reserved' check(status in ('reserved','fulfilled','released')),
  created_at timestamptz not null default clock_timestamp(),
  fulfilled_at timestamptz,
  released_at timestamptz,
  primary key(order_id,item_id,option_id),
  check (
    (status='reserved' and fulfilled_at is null and released_at is null)
    or (status='fulfilled' and fulfilled_at is not null and released_at is null)
    or (status='released' and fulfilled_at is null and released_at is not null)
  )
);
alter table qclub_private.shop_stock_reservations enable row level security;
revoke all on qclub_private.shop_stock_reservations from public,anon,authenticated;
grant select,insert,update on qclub_private.shop_stock_reservations to service_role;

create function qclub_private.adjust_shop_stock(
  p_item_id text,p_option_id text,p_delta integer
)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare
  state jsonb;
  items jsonb;
  item jsonb;
  options jsonb;
  option_row jsonb;
  item_index integer;
  option_index integer;
  current_stock integer;
  next_stock integer;
begin
  if p_item_id is null or length(p_item_id) not between 1 and 160
    or p_option_id is null or length(p_option_id)>160
    or p_delta is null or p_delta=0 then return false;
  end if;

  select q.state into state from public.qclub_state q where q.key='main' for update;
  if state is null then return false; end if;
  items:=case when jsonb_typeof(state#>'{shopCatalog,items}')='array'
    then state#>'{shopCatalog,items}' else '[]'::jsonb end;

  select (ordinality-1)::integer,value into item_index,item
  from jsonb_array_elements(items) with ordinality
  where value->>'id'=p_item_id
  limit 1;
  if item is null then return false; end if;

  options:=case when jsonb_typeof(item->'options')='array' then item->'options' else '[]'::jsonb end;
  if jsonb_array_length(options)>0 then
    if p_option_id='' then return false; end if;
    select (ordinality-1)::integer,value into option_index,option_row
    from jsonb_array_elements(options) with ordinality
    where value->>'id'=p_option_id
    limit 1;
    if option_row is null or coalesce(option_row->>'stock','') !~ '^[0-9]+$' then return false; end if;
    current_stock:=(option_row->>'stock')::integer;
    next_stock:=current_stock+p_delta;
    if next_stock<0 then return false; end if;
    option_row:=jsonb_set(option_row,'{stock}',to_jsonb(next_stock),true);
    options:=jsonb_set(options,array[option_index::text],option_row,true);
    item:=jsonb_set(item,'{options}',options,true);
  else
    if p_option_id<>'' or coalesce(item->>'stock','') !~ '^[0-9]+$' then return false; end if;
    current_stock:=(item->>'stock')::integer;
    next_stock:=current_stock+p_delta;
    if next_stock<0 then return false; end if;
    item:=jsonb_set(item,'{stock}',to_jsonb(next_stock),true);
  end if;

  items:=jsonb_set(items,array[item_index::text],item,true);
  state:=jsonb_set(state,'{shopCatalog,items}',items,true);
  update public.qclub_state set state=state,updated_at=clock_timestamp() where key='main';
  return true;
end $$;
revoke all on function qclub_private.adjust_shop_stock(text,text,integer) from public,anon,authenticated;
grant execute on function qclub_private.adjust_shop_stock(text,text,integer) to service_role;

create function qclub_private.sync_shop_reservation_lifecycle()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare reservation qclub_private.shop_stock_reservations%rowtype;
begin
  if new.status='fulfilled' and old.status is distinct from 'fulfilled' then
    update qclub_private.shop_stock_reservations
      set status='fulfilled',fulfilled_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  elsif new.terminal_at is not null and old.terminal_at is null then
    for reservation in
      select * from qclub_private.shop_stock_reservations
      where order_id=new.order_id and status='reserved'
      order by item_id,option_id
      for update
    loop
      if not qclub_private.adjust_shop_stock(reservation.item_id,reservation.option_id,reservation.quantity) then
        raise exception 'SHOP_STOCK_RESTORE_FAILED';
      end if;
      update qclub_private.shop_stock_reservations
        set status='released',released_at=clock_timestamp()
        where order_id=new.order_id and item_id=reservation.item_id
          and option_id=reservation.option_id and status='reserved';
    end loop;
  end if;
  return new;
end $$;
revoke all on function qclub_private.sync_shop_reservation_lifecycle() from public,anon,authenticated;
grant execute on function qclub_private.sync_shop_reservation_lifecycle() to service_role;
create trigger sync_shop_reservation_lifecycle
after update of status,terminal_at on qclub_private.payment_intents
for each row execute function qclub_private.sync_shop_reservation_lifecycle();

create function public.qclub_shop_checkout(
  p_order_id text,p_receipt_hash text,p_request_hash text,p_items jsonb,
  p_customer_name text,p_customer_phone text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  existing qclub_private.payment_intents%rowtype;
  state jsonb;
  line jsonb;
  item jsonb;
  option_row jsonb;
  reservation jsonb;
  quantity integer;
  option_id text;
  stock integer;
  total bigint:=0;
  unit_paise bigint;
  lines jsonb:='[]'::jsonb;
  reservations jsonb:='[]'::jsonb;
  seen text[]:='{}';
  key text;
  expires timestamptz;
begin
  if p_order_id is null or p_order_id !~ '^qcs_[0-9a-f-]{36}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120
    or p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$'
    or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 30 then
    return jsonb_build_object('ok',false,'reason','INVALID_SHOP_CHECKOUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id,31013));
  select * into existing from qclub_private.payment_intents where order_id=p_order_id;
  if found then
    if existing.receipt_hash<>p_receipt_hash or existing.request_hash is distinct from p_request_hash then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_CONFLICT');
    end if;
    if existing.terminal_at is not null or existing.expires_at<=clock_timestamp() then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_EXPIRED');
    end if;
    return jsonb_build_object('ok',true,'amount_paise',existing.amount_paise,'status',existing.status,'expires_at',existing.expires_at);
  end if;

  select q.state into state from public.qclub_state q where q.key='main' for update;
  if state is null or jsonb_typeof(state#>'{shopCatalog,items}')<>'array' then
    return jsonb_build_object('ok',false,'reason','SHOP_UNAVAILABLE');
  end if;

  for line in
    select value from jsonb_array_elements(p_items)
    order by value->>'itemId',coalesce(value->>'optionId','')
  loop
    if jsonb_typeof(line)<>'object'
      or exists(select 1 from jsonb_object_keys(line) k where k not in ('itemId','optionId','quantity'))
      or jsonb_typeof(line->'itemId') is distinct from 'string'
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or coalesce(line->>'quantity','') !~ '^[0-9]{1,2}$'
      or coalesce(length(line->>'itemId'),0) not between 1 and 160
      or length(coalesce(line->>'optionId',''))>160 then
      return jsonb_build_object('ok',false,'reason','INVALID_SHOP_CART');
    end if;

    quantity:=(line->>'quantity')::integer;
    option_id:=coalesce(line->>'optionId','');
    key:=(line->>'itemId')||chr(31)||option_id;
    if quantity not between 1 and 20 or key=any(seen) then
      return jsonb_build_object('ok',false,'reason','INVALID_SHOP_CART');
    end if;
    seen:=array_append(seen,key);

    select value into item
    from jsonb_array_elements(state#>'{shopCatalog,items}')
    where value->>'id'=line->>'itemId'
    limit 1;
    if item is null or coalesce(item->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;
    if (item->>'price')::numeric<=0 or (item->>'price')::numeric>999999.99 then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;

    if jsonb_typeof(item->'options')='array' and jsonb_array_length(item->'options')>0 then
      if option_id='' then return jsonb_build_object('ok',false,'reason','OPTION_REQUIRED'); end if;
      select value into option_row
      from jsonb_array_elements(item->'options')
      where value->>'id'=option_id
      limit 1;
      if option_row is null or coalesce(option_row->>'stock','') !~ '^[0-9]+$' then
        return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
      end if;
      stock:=(option_row->>'stock')::integer;
    else
      if option_id<>'' or coalesce(item->>'stock','') !~ '^[0-9]+$' then
        return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
      end if;
      option_row:=null;
      stock:=(item->>'stock')::integer;
    end if;

    if stock<quantity then return jsonb_build_object('ok',false,'reason','INSUFFICIENT_STOCK'); end if;

    unit_paise:=((item->>'price')::numeric*100)::bigint;
    total:=total+unit_paise*quantity;
    lines:=lines||jsonb_build_array(jsonb_build_object(
      'id',line->>'itemId','itemId',line->>'itemId','name',coalesce(item->>'name','Item'),
      'displayName',coalesce(item->>'name','Item'),'qty',quantity,'quantity',quantity,
      'price',unit_paise/100.0,'lineTotal',(unit_paise*quantity)/100.0,
      'selectedOptionId',nullif(option_id,''),
      'selectedOptionLabel',case when option_row is null then null else option_row->>'label' end
    ));
    reservations:=reservations||jsonb_build_array(jsonb_build_object(
      'item_id',line->>'itemId','option_id',option_id,'quantity',quantity
    ));
  end loop;

  if total<=0 or total>99999999 then return jsonb_build_object('ok',false,'reason','INVALID_SHOP_CART'); end if;
  expires:=clock_timestamp()+interval '1 hour';

  insert into qclub_private.payment_intents(
    order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload,expires_at
  ) values(
    p_order_id,p_receipt_hash,p_request_hash,total,'qshop_receipt',p_order_id,
    jsonb_build_object(
      'id','QSHOP-'||right(p_order_id,8),'receiptId','QSHOP-'||right(p_order_id,8),
      'orderNo','QSHOP-'||right(p_order_id,8),'customerName',trim(p_customer_name),
      'customerMobile',p_customer_phone,'items',lines,'total',total/100.0,
      'paymentStatus','Pending','pickupStatus','pending','stockAdjusted',true,
      'createdAt',clock_timestamp()
    ),
    expires
  );

  for reservation in
    select value from jsonb_array_elements(reservations)
    order by value->>'item_id',value->>'option_id'
  loop
    if not qclub_private.adjust_shop_stock(
      reservation->>'item_id',reservation->>'option_id',(reservation->>'quantity')::integer * -1
    ) then raise exception 'SHOP_STOCK_RESERVATION_FAILED'; end if;
    insert into qclub_private.shop_stock_reservations(order_id,item_id,option_id,quantity)
      values(p_order_id,reservation->>'item_id',reservation->>'option_id',(reservation->>'quantity')::integer);
  end loop;

  return jsonb_build_object('ok',true,'amount_paise',total,'status','pending','expires_at',expires);
end $$;
revoke all on function public.qclub_shop_checkout(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.qclub_shop_checkout(text,text,text,jsonb,text,text) to service_role;

-- Extend trusted stale discovery to QShop rehearsal orders.
create or replace function public.qclub_payment_stale_intents(p_before timestamptz,p_limit integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('order_id',x.order_id,'expires_at',x.expires_at) order by x.expires_at),
    '[]'::jsonb
  )
  from (
    select i.order_id,i.expires_at
    from qclub_private.payment_intents i
    where i.status='pending' and i.terminal_at is null and i.expires_at<=p_before
      and (
        (i.record_type='q_lounge_order' and i.order_id ~ '^qcr_[0-9a-f-]{36}$')
        or (i.record_type='booking_request' and i.order_id ~ '^qcb_[0-9a-f-]{36}$')
        or (i.record_type='qshop_receipt' and i.order_id ~ '^qcs_[0-9a-f-]{36}$')
      )
    order by i.expires_at
    limit least(greatest(coalesce(p_limit,0),0),20)
  ) x
$$;
revoke all on function public.qclub_payment_stale_intents(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.qclub_payment_stale_intents(timestamptz,integer) to service_role;

-- Terminal close still restores tracked Q Lounge rows directly. QShop restoration is
-- attached to the payment-intent terminal update through sync_shop_reservation_lifecycle.
create or replace function public.qclub_payment_close_terminal_service(p_order_id text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  intent qclub_private.payment_intents%rowtype;
  reservation qclub_private.checkout_stock_reservations%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^qc[rbs]_[0-9a-f-]{36}$'
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
