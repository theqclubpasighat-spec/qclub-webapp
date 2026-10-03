-- Rehearsal only. Never discard an uncertain payment intent.
-- Closed unused IDs are permanent replay barriers; do not purge them while
-- checkout creation accepts those IDs without an enforced maximum request age.
create table qclub_private.closed_checkouts (
  order_id text primary key check (order_id ~ '^qcr_[0-9a-f-]{36}$'),
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  closed_at timestamptz not null default clock_timestamp()
);
alter table qclub_private.closed_checkouts enable row level security;
revoke all on qclub_private.closed_checkouts from public,anon,authenticated,service_role;
grant select,insert on qclub_private.closed_checkouts to service_role;

create function public.qclub_close_unused_checkout(p_order_id text,p_receipt_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare existing_hash text; closed_hash text;
begin
  if p_order_id is null or p_order_id !~ '^qcr_[0-9a-f-]{36}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'reason','INVALID_CHECKOUT');
  end if;
  -- Same lock and key as creation: either closure wins and blocks creation,
  -- or a private intent exists and closure must refuse, even if expired/unpaid.
  perform pg_advisory_xact_lock(hashtextextended(p_order_id,82918));
  select receipt_hash into existing_hash from qclub_private.payment_intents where order_id=p_order_id;
  if found then
    if existing_hash<>p_receipt_hash then return jsonb_build_object('ok',false,'reason','CHECKOUT_CONFLICT'); end if;
    return jsonb_build_object('ok',true,'state','existing');
  end if;
  select receipt_hash into closed_hash from qclub_private.closed_checkouts where order_id=p_order_id;
  if found then
    if closed_hash<>p_receipt_hash then return jsonb_build_object('ok',false,'reason','CHECKOUT_CONFLICT'); end if;
  else
    insert into qclub_private.closed_checkouts(order_id,receipt_hash) values(p_order_id,p_receipt_hash);
  end if;
  return jsonb_build_object('ok',true,'state','closed');
end $$;
revoke all on function public.qclub_close_unused_checkout(text,text) from public,anon,authenticated;
grant execute on function public.qclub_close_unused_checkout(text,text) to service_role;

create or replace function public.qclub_food_checkout(p_order_id text,p_receipt_hash text,p_request_hash text,p_items jsonb,p_customer_name text,p_customer_phone text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare existing qclub_private.payment_intents%rowtype; line jsonb; item public.snooker_catalogue_items%rowtype;
  quantity integer; total bigint:=0; unit_paise bigint; lines jsonb:='[]'::jsonb; seen text[]:='{}';
begin
  if p_order_id is null or p_order_id !~ '^qcr_[0-9a-f-]{36}$' or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120
    or p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok',false,'reason','INVALID_CHECKOUT');
  end if;
  -- Serialize identical checkout IDs before either inserting or reading frozen terms.
  perform pg_advisory_xact_lock(hashtextextended(p_order_id,82918));
  if exists(select 1 from qclub_private.closed_checkouts where order_id=p_order_id) then
    return jsonb_build_object('ok',false,'reason','CHECKOUT_CLOSED');
  end if;
  select * into existing from qclub_private.payment_intents where order_id=p_order_id;
  if found then
    if existing.receipt_hash<>p_receipt_hash or existing.request_hash is distinct from p_request_hash then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_CONFLICT');
    end if;
    if existing.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'reason','CHECKOUT_EXPIRED'); end if;
    return jsonb_build_object('ok',true,'amount_paise',existing.amount_paise,'status',existing.status);
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;
  if jsonb_array_length(p_items) not between 1 and 30 then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;
  for line in select value from jsonb_array_elements(p_items) order by value->>'itemId' loop
    if jsonb_typeof(line)<>'object' then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;
    if exists(select 1 from jsonb_object_keys(line) k where k not in ('itemId','quantity'))
      or jsonb_typeof(line->'itemId') is distinct from 'string'
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or coalesce(line->>'quantity','') !~ '^[0-9]{1,2}$'
      or coalesce(length(line->>'itemId'),0) not between 1 and 160
      or (line->>'itemId')=any(seen) then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;
    quantity:=(line->>'quantity')::integer;
    if quantity not between 1 and 20 then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;
    seen:=array_append(seen,line->>'itemId');
    select i.* into item from public.snooker_catalogue_items i
      join public.qclub_fnb_categories c on c.category_key=i.qlounge_category_key and c.active=true
      where i.id=line->>'itemId' and i.active=true and i.show_on_qlounge=true and i.online_order_enabled=true
      for share of i,c;
    if not found then return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE'); end if;
    -- No speculative stock claim: tracked inventory needs a reservation adapter first.
    if item.track_inventory then return jsonb_build_object('ok',false,'reason','STOCK_RESERVATION_REQUIRED'); end if;
    if item.selling_price_inr is null or item.selling_price_inr<=0 or item.selling_price_inr>999999.99
      or item.selling_price_inr*100<>trunc(item.selling_price_inr*100) then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;
    unit_paise:=(item.selling_price_inr*100)::bigint;
    total:=total+unit_paise*quantity;
    lines:=lines||jsonb_build_array(jsonb_build_object('id',item.id,'itemId',item.id,'name',item.name,'displayName',item.name,
      'qty',quantity,'quantity',quantity,'price',unit_paise/100.0,'lineTotal',(unit_paise*quantity)/100.0));
  end loop;
  if total>99999999 then return jsonb_build_object('ok',false,'reason','INVALID_CART'); end if;
  insert into qclub_private.payment_intents(order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload)
    values(p_order_id,p_receipt_hash,p_request_hash,total,'q_lounge_order',p_order_id,
      jsonb_build_object('id',p_order_id,'orderNo',p_order_id,'customerName',trim(p_customer_name),
      'customerMobile',p_customer_phone,'items',lines,'total',total/100.0,'printStatus','pending_auto_print','createdAt',clock_timestamp()));
  return jsonb_build_object('ok',true,'amount_paise',total,'status','pending');
end $$;
revoke all on function public.qclub_food_checkout(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.qclub_food_checkout(text,text,text,jsonb,text,text) to service_role;
