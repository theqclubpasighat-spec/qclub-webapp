-- REHEARSAL ONLY: server-priced one-calendar-month membership activation/renewal.
-- Current production catalogue is read as authoritative; no browser price/expiry is accepted.

alter table qclub_private.payment_intents
  drop constraint if exists payment_intents_record_type_check;
alter table qclub_private.payment_intents
  add constraint payment_intents_record_type_check
  check (record_type in (
    'booking_request','q_lounge_order','qshop_receipt',
    'tournament_registration','membership_activation'
  ));

create table qclub_private.membership_reservations (
  order_id text primary key references qclub_private.payment_intents(order_id) on delete restrict,
  membership_id text not null,
  tier text not null,
  customer_name text not null,
  customer_phone text not null check (customer_phone ~ '^[6-9][0-9]{9}$'),
  status text not null default 'reserved' check(status in ('reserved','fulfilled','released')),
  created_at timestamptz not null default clock_timestamp(),
  fulfilled_at timestamptz,
  released_at timestamptz,
  check (
    (status='reserved' and fulfilled_at is null and released_at is null)
    or (status='fulfilled' and fulfilled_at is not null and released_at is null)
    or (status='released' and fulfilled_at is null and released_at is not null)
  )
);
create unique index membership_one_pending_payment
  on qclub_private.membership_reservations(customer_phone)
  where status='reserved';
alter table qclub_private.membership_reservations enable row level security;
revoke all on qclub_private.membership_reservations from public,anon,authenticated;
grant select,insert,update on qclub_private.membership_reservations to service_role;

create function qclub_private.sync_membership_reservation_lifecycle()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
  reservation qclub_private.membership_reservations%rowtype;
  v_state jsonb;
  registry jsonb;
  member_row jsonb;
  member_index integer;
  member_matches integer;
  today_date date;
  current_valid date;
  base_date date;
  valid_until date;
begin
  select * into reservation
  from qclub_private.membership_reservations
  where order_id=new.order_id
  for update;
  if not found then return new; end if;

  if new.status='fulfilled' and old.status is distinct from 'fulfilled' then
    select q.state into v_state from public.qclub_state q where q.key='main' for update;
    if v_state is null then raise exception 'MEMBERSHIP_STATE_UNAVAILABLE'; end if;
    registry:=case when jsonb_typeof(v_state->'memberRegistry')='array'
      then v_state->'memberRegistry' else '[]'::jsonb end;

    select count(*) into member_matches
    from jsonb_array_elements(registry) m(value)
    where right(regexp_replace(coalesce(m.value->>'mobile',''),'[^0-9]','','g'),10)=reservation.customer_phone;
    if member_matches>1 then raise exception 'MEMBERSHIP_IDENTITY_CONFLICT'; end if;

    today_date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
    current_valid:=null;
    if member_matches=1 then
      select (ordinality-1)::integer,value into member_index,member_row
      from jsonb_array_elements(registry) with ordinality
      where right(regexp_replace(coalesce(value->>'mobile',''),'[^0-9]','','g'),10)=reservation.customer_phone
      limit 1;
      if coalesce(member_row->>'validUntil','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        current_valid:=(member_row->>'validUntil')::date;
      end if;
    end if;

    base_date:=case when current_valid is not null and current_valid>=today_date
      then current_valid else today_date end;
    valid_until:=(base_date+interval '1 month')::date;

    if member_matches=1 then
      member_row:=member_row||jsonb_build_object(
        'tier',reservation.tier,
        'mobile',reservation.customer_phone,
        'status','active',
        'validUntil',valid_until::text,
        'updatedAt',clock_timestamp()::text
      );
      if coalesce(member_row->>'joinedOn','')='' then
        member_row:=member_row||jsonb_build_object('joinedOn',today_date::text);
      end if;
      registry:=jsonb_set(registry,array[member_index::text],member_row,true);
    else
      registry:=registry||jsonb_build_array(jsonb_build_object(
        'id','m_pay_'||right(new.order_id,8),
        'name',reservation.customer_name,
        'mobile',reservation.customer_phone,
        'tier',reservation.tier,
        'joinedOn',today_date::text,
        'validUntil',valid_until::text,
        'status','active',
        'notes','',
        'createdAt',clock_timestamp()::text,
        'updatedAt',clock_timestamp()::text
      ));
    end if;

    v_state:=jsonb_set(v_state,'{memberRegistry}',registry,true);
    update public.qclub_state q
      set state=v_state,updated_at=clock_timestamp()
      where q.key='main';

    update qclub_private.membership_reservations
      set status='fulfilled',fulfilled_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  elsif new.terminal_at is not null and old.terminal_at is null then
    update qclub_private.membership_reservations
      set status='released',released_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  end if;
  return new;
end $$;
revoke all on function qclub_private.sync_membership_reservation_lifecycle() from public,anon,authenticated;
grant execute on function qclub_private.sync_membership_reservation_lifecycle() to service_role;
create trigger sync_membership_reservation_lifecycle
after update of status,terminal_at on qclub_private.payment_intents
for each row execute function qclub_private.sync_membership_reservation_lifecycle();

create function public.qclub_membership_checkout(
  p_order_id text,p_receipt_hash text,p_request_hash text,p_membership_id text,
  p_customer_name text,p_customer_phone text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  existing qclub_private.payment_intents%rowtype;
  v_state jsonb;
  plan jsonb;
  member_row jsonb;
  member_matches integer;
  fee numeric;
  amount_paise bigint;
  tier_name text;
  expires timestamptz;
begin
  if p_order_id is null or p_order_id !~ '^qcm_[0-9a-f-]{36}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_membership_id is null or length(p_membership_id) not between 1 and 160
    or p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120
    or p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok',false,'reason','INVALID_MEMBERSHIP_CHECKOUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id,58117));
  select * into existing from qclub_private.payment_intents where order_id=p_order_id;
  if found then
    if existing.receipt_hash<>p_receipt_hash or existing.request_hash is distinct from p_request_hash then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_CONFLICT');
    end if;
    if existing.terminal_at is not null or existing.expires_at<=clock_timestamp() then
      return jsonb_build_object('ok',false,'reason','CHECKOUT_EXPIRED');
    end if;
    return jsonb_build_object(
      'ok',true,'amount_paise',existing.amount_paise,'status',existing.status,
      'expires_at',existing.expires_at,'tier',existing.payload->>'tier'
    );
  end if;

  select q.state into v_state from public.qclub_state q where q.key='main' for update;
  if v_state is null or jsonb_typeof(v_state->'memberships')<>'array' then
    return jsonb_build_object('ok',false,'reason','MEMBERSHIP_UNAVAILABLE');
  end if;

  select value into plan
  from jsonb_array_elements(v_state->'memberships')
  where value->>'id'=p_membership_id
  limit 1;
  if plan is null or coalesce(plan->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$'
    or coalesce(trim(plan->>'tier'),'')='' then
    return jsonb_build_object('ok',false,'reason','MEMBERSHIP_NOT_AVAILABLE');
  end if;
  fee:=(plan->>'price')::numeric;
  if fee<=0 or fee>999999.99 or fee*100<>trunc(fee*100) then
    return jsonb_build_object('ok',false,'reason','MEMBERSHIP_NOT_AVAILABLE');
  end if;
  amount_paise:=(fee*100)::bigint;
  tier_name:=trim(plan->>'tier');

  select count(*) into member_matches
  from jsonb_array_elements(case when jsonb_typeof(v_state->'memberRegistry')='array'
    then v_state->'memberRegistry' else '[]'::jsonb end) m(value)
  where right(regexp_replace(coalesce(m.value->>'mobile',''),'[^0-9]','','g'),10)=p_customer_phone;
  if member_matches>1 then
    return jsonb_build_object('ok',false,'reason','MEMBERSHIP_IDENTITY_CONFLICT');
  end if;
  if member_matches=1 then
    select value into member_row
    from jsonb_array_elements(v_state->'memberRegistry')
    where right(regexp_replace(coalesce(value->>'mobile',''),'[^0-9]','','g'),10)=p_customer_phone
    limit 1;
    if lower(trim(coalesce(member_row->>'name','')))<>lower(trim(p_customer_name)) then
      return jsonb_build_object('ok',false,'reason','MEMBERSHIP_IDENTITY_MISMATCH');
    end if;
  end if;

  if exists(
    select 1 from qclub_private.membership_reservations r
    where r.customer_phone=p_customer_phone and r.status='reserved'
  ) then return jsonb_build_object('ok',false,'reason','MEMBERSHIP_PAYMENT_ALREADY_PENDING'); end if;

  expires:=clock_timestamp()+interval '1 hour';
  insert into qclub_private.payment_intents(
    order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload,expires_at
  ) values(
    p_order_id,p_receipt_hash,p_request_hash,amount_paise,'membership_activation',p_order_id,
    jsonb_build_object(
      'id','MEM-'||right(p_order_id,8),
      'membershipId','MEM-'||right(p_order_id,8),
      'catalogueMembershipId',p_membership_id,
      'tier',tier_name,
      'customerName',trim(p_customer_name),
      'customerMobile',p_customer_phone,
      'amount',fee,
      'durationMonths',1,
      'paymentStatus','Pending',
      'createdAt',clock_timestamp()
    ),
    expires
  );

  insert into qclub_private.membership_reservations(
    order_id,membership_id,tier,customer_name,customer_phone
  ) values(p_order_id,p_membership_id,tier_name,trim(p_customer_name),p_customer_phone);

  return jsonb_build_object(
    'ok',true,'amount_paise',amount_paise,'status','pending',
    'expires_at',expires,'tier',tier_name
  );
end $$;
revoke all on function public.qclub_membership_checkout(text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.qclub_membership_checkout(text,text,text,text,text,text)
  to service_role;

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
        or (i.record_type='tournament_registration' and i.order_id ~ '^qct_[0-9a-f-]{36}$')
        or (i.record_type='membership_activation' and i.order_id ~ '^qcm_[0-9a-f-]{36}$')
      )
    order by i.expires_at
    limit least(greatest(coalesce(p_limit,0),0),20)
  ) x
$$;
revoke all on function public.qclub_payment_stale_intents(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.qclub_payment_stale_intents(timestamptz,integer) to service_role;

create or replace function public.qclub_payment_close_terminal_service(p_order_id text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  intent qclub_private.payment_intents%rowtype;
  reservation qclub_private.checkout_stock_reservations%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^qc[rbstm]_[0-9a-f-]{36}$'
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
