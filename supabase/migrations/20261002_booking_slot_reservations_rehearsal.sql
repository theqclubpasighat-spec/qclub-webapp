-- REHEARSAL ONLY: atomic table-slot reservation before Cashfree payment.
-- Reads current booking configuration from qclub_state but never mutates that shared production-style state.

create function qclub_private.booking_time_minutes(p_time text)
returns integer language plpgsql immutable strict set search_path=pg_catalog as $$
declare h integer; m integer;
begin
  if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  h:=substring(p_time from 1 for 2)::integer;
  m:=substring(p_time from 4 for 2)::integer;
  return h*60+m;
end $$;
revoke all on function qclub_private.booking_time_minutes(text) from public,anon,authenticated;
grant execute on function qclub_private.booking_time_minutes(text) to service_role;

create table qclub_private.booking_slot_reservations (
  order_id text primary key references qclub_private.payment_intents(order_id) on delete restrict,
  item_id text not null,
  booking_date date not null,
  start_minutes integer not null check(start_minutes between 0 and 1439),
  end_minutes integer not null check(end_minutes between 1 and 1440 and end_minutes>start_minutes),
  booking_type text not null check(booking_type in ('member','nonmember')),
  customer_name text not null,
  customer_phone text not null check(customer_phone ~ '^[6-9][0-9]{9}$'),
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
alter table qclub_private.booking_slot_reservations enable row level security;
revoke all on qclub_private.booking_slot_reservations from public,anon,authenticated;
grant select,insert,update on qclub_private.booking_slot_reservations to service_role;
create index booking_slot_reservations_lookup
  on qclub_private.booking_slot_reservations(item_id,booking_date,start_minutes,end_minutes,status);

create function qclub_private.sync_booking_reservation_lifecycle()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.status='fulfilled' and old.status is distinct from 'fulfilled' then
    update qclub_private.booking_slot_reservations
      set status='fulfilled',fulfilled_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  elsif new.terminal_at is not null and old.terminal_at is null then
    update qclub_private.booking_slot_reservations
      set status='released',released_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  end if;
  return new;
end $$;
revoke all on function qclub_private.sync_booking_reservation_lifecycle() from public,anon,authenticated;
create trigger sync_booking_reservation_lifecycle
after update of status,terminal_at on qclub_private.payment_intents
for each row execute function qclub_private.sync_booking_reservation_lifecycle();

create function public.qclub_booking_checkout(
  p_order_id text,
  p_receipt_hash text,
  p_request_hash text,
  p_item_id text,
  p_booking_date date,
  p_start_time text,
  p_duration_hours integer,
  p_booking_type text,
  p_customer_name text,
  p_customer_phone text,
  p_note text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  existing qclub_private.payment_intents%rowtype;
  state jsonb;
  table_row jsonb;
  row jsonb;
  start_min integer;
  end_min integer;
  other_start integer;
  other_end integer;
  other_duration integer;
  hourly numeric;
  total_paise bigint;
  expires timestamptz;
  member_ok boolean:=false;
  slot_label text;
begin
  if p_order_id is null or p_order_id !~ '^qcb_[0-9a-f-]{36}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_item_id is null or length(p_item_id) not between 1 and 160
    or p_booking_date is null or p_booking_date<current_date or p_booking_date>current_date+90
    or p_duration_hours not between 1 and 5
    or p_booking_type not in ('member','nonmember')
    or p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120
    or p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$'
    or p_note is null or length(p_note)>1000 then
    return jsonb_build_object('ok',false,'reason','INVALID_BOOKING');
  end if;

  start_min:=qclub_private.booking_time_minutes(p_start_time);
  end_min:=start_min+p_duration_hours*60;
  if start_min is null or start_min<11*60 or start_min>22*60 or start_min%15<>0 or end_min>23*60 then
    return jsonb_build_object('ok',false,'reason','INVALID_BOOKING');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id,19471));
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

  -- Serialize all competing holds for one physical resource/date.
  perform pg_advisory_xact_lock(hashtextextended(p_item_id||':'||p_booking_date::text,19472));

  select q.state into state from public.qclub_state q where q.key='main' for share;
  if state is null then return jsonb_build_object('ok',false,'reason','BOOKING_UNAVAILABLE'); end if;

  select value into table_row
  from jsonb_array_elements(coalesce(state#>'{booking,tables}','[]'::jsonb))
  where value->>'id'=p_item_id
  limit 1;
  if table_row is null then return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE'); end if;

  if p_booking_type='member' then
    select exists(
      select 1
      from jsonb_array_elements(coalesce(state->'memberRegistry','[]'::jsonb)) member
      where lower(trim(coalesce(member->>'name','')))=lower(trim(p_customer_name))
        and right(regexp_replace(coalesce(member->>'mobile',''),'[^0-9]','','g'),10)=p_customer_phone
        and lower(coalesce(member->>'status',''))='active'
        and (
          coalesce(member->>'validUntil','')=''
          or ((member->>'validUntil') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (member->>'validUntil')::date>=p_booking_date)
        )
    ) into member_ok;
    if not member_ok then return jsonb_build_object('ok',false,'reason','MEMBER_VERIFICATION_REQUIRED'); end if;
  end if;

  if p_booking_type='member' then
    if coalesce(table_row->>'memberPricePerHour',table_row->>'pricePerHour','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;
    hourly:=coalesce(table_row->>'memberPricePerHour',table_row->>'pricePerHour')::numeric;
  else
    if coalesce(table_row->>'pricePerHour','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
    end if;
    hourly:=(table_row->>'pricePerHour')::numeric;
  end if;
  if hourly<=0 or hourly>999999.99 or hourly*100<>trunc(hourly*100) then
    return jsonb_build_object('ok',false,'reason','ITEM_UNAVAILABLE');
  end if;
  total_paise:=(hourly*100)::bigint*p_duration_hours;
  slot_label:=p_start_time||' to '||lpad((end_min/60)::text,2,'0')||':'||lpad((end_min%60)::text,2,'0');

  -- Private rehearsal holds.
  if exists(
    select 1 from qclub_private.booking_slot_reservations h
    where h.item_id=p_item_id and h.booking_date=p_booking_date
      and h.status in ('reserved','fulfilled')
      and start_min<h.end_minutes and end_min>h.start_minutes
  ) then return jsonb_build_object('ok',false,'reason','SLOT_UNAVAILABLE'); end if;

  -- Admin-blocked windows in current shared state.
  for row in select value from jsonb_array_elements(coalesce(state#>'{booking,blockedSlots}','[]'::jsonb)) loop
    if row->>'itemId'=p_item_id and row->>'bookingDate'=p_booking_date::text then
      other_start:=qclub_private.booking_time_minutes(split_part(coalesce(row->>'timeSlot',row->>'startTime',''),' to ',1));
      if position(' to ' in coalesce(row->>'timeSlot',''))>0 then
        other_end:=qclub_private.booking_time_minutes(split_part(row->>'timeSlot',' to ',2));
      else
        other_duration:=case when coalesce(row->>'durationHours','')~'^[1-5]$' then (row->>'durationHours')::integer else 1 end;
        other_end:=other_start+other_duration*60;
      end if;
      if other_start is not null and other_end is not null and start_min<other_end and end_min>other_start then
        return jsonb_build_object('ok',false,'reason','SLOT_UNAVAILABLE');
      end if;
    end if;
  end loop;

  -- Current whole-state booking requests; preserve the production active-status contract.
  for row in select value from jsonb_array_elements(coalesce(state#>'{booking,requests}','[]'::jsonb)) loop
    if row->>'itemId'=p_item_id and row->>'bookingDate'=p_booking_date::text
      and coalesce(row->>'status','') in ('pending','verified','pending_member_verification','member_verified') then
      other_start:=qclub_private.booking_time_minutes(split_part(coalesce(row->>'timeSlot',''),' to ',1));
      if coalesce(row->>'endTime','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        other_end:=qclub_private.booking_time_minutes(row->>'endTime');
      elsif position(' to ' in coalesce(row->>'timeSlot',''))>0 then
        other_end:=qclub_private.booking_time_minutes(split_part(row->>'timeSlot',' to ',2));
      else
        other_duration:=case when coalesce(row->>'durationHours','')~'^[1-5]$' then (row->>'durationHours')::integer else 1 end;
        other_end:=other_start+other_duration*60;
      end if;
      if other_start is not null and other_end is not null and start_min<other_end and end_min>other_start then
        return jsonb_build_object('ok',false,'reason','SLOT_UNAVAILABLE');
      end if;
    end if;
  end loop;

  -- Operational records may already contain paid/current bookings not present in a stale browser state.
  for row in
    select r.payload
    from public.qclub_operational_records r
    where r.record_type='booking_request'
      and r.deleted_at is null
      and lower(coalesce(r.status,'')) not in ('rejected','failed','cancelled','canceled','deleted')
  loop
    if coalesce(row->>'itemId',row->>'item_id')=p_item_id
      and coalesce(row->>'bookingDate',row->>'booking_date')=p_booking_date::text then
      other_start:=qclub_private.booking_time_minutes(split_part(coalesce(row->>'timeSlot',row->>'time_slot',''),' to ',1));
      if coalesce(row->>'endTime',row->>'end_time','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        other_end:=qclub_private.booking_time_minutes(coalesce(row->>'endTime',row->>'end_time'));
      elsif position(' to ' in coalesce(row->>'timeSlot',row->>'time_slot',''))>0 then
        other_end:=qclub_private.booking_time_minutes(split_part(coalesce(row->>'timeSlot',row->>'time_slot'),' to ',2));
      else
        other_duration:=case when coalesce(row->>'durationHours',row->>'duration_hours','')~'^[1-5]$'
          then coalesce(row->>'durationHours',row->>'duration_hours')::integer else 1 end;
        other_end:=other_start+other_duration*60;
      end if;
      if other_start is not null and other_end is not null and start_min<other_end and end_min>other_start then
        return jsonb_build_object('ok',false,'reason','SLOT_UNAVAILABLE');
      end if;
    end if;
  end loop;

  expires:=clock_timestamp()+interval '1 hour';
  insert into qclub_private.payment_intents(
    order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload,expires_at
  ) values(
    p_order_id,p_receipt_hash,p_request_hash,total_paise,'booking_request',p_order_id,
    jsonb_build_object(
      'id',p_order_id,'name',trim(p_customer_name),'mobile',p_customer_phone,
      'bookingType',p_booking_type,'itemId',p_item_id,'itemLabel',coalesce(table_row->>'label','Booked Table'),
      'bookingDate',p_booking_date::text,'timeSlot',p_start_time,'durationHours',p_duration_hours,
      'endTime',lpad((end_min/60)::text,2,'0')||':'||lpad((end_min%60)::text,2,'0'),
      'slotLabel',slot_label,'note',trim(p_note),'amount',total_paise/100.0,
      'status','pending','createdAt',extract(epoch from clock_timestamp())*1000
    ),
    expires
  );

  insert into qclub_private.booking_slot_reservations(
    order_id,item_id,booking_date,start_minutes,end_minutes,booking_type,customer_name,customer_phone
  ) values(
    p_order_id,p_item_id,p_booking_date,start_min,end_min,p_booking_type,trim(p_customer_name),p_customer_phone
  );

  return jsonb_build_object(
    'ok',true,'amount_paise',total_paise,'status','pending','expires_at',expires,
    'item_label',coalesce(table_row->>'label','Booked Table'),'slot_label',slot_label
  );
end $$;
revoke all on function public.qclub_booking_checkout(text,text,text,text,date,text,integer,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.qclub_booking_checkout(text,text,text,text,date,text,integer,text,text,text,text)
  to service_role;

-- Expand stale discovery to booking holds as well as tracked food reservations.
create or replace function public.qclub_payment_stale_intents(p_before timestamptz,p_limit integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('order_id',x.order_id,'expires_at',x.expires_at) order by x.expires_at),
    '[]'::jsonb
  )
  from (
    select i.order_id,i.expires_at
    from qclub_private.payment_intents i
    where i.status='pending'
      and i.terminal_at is null
      and i.expires_at<=p_before
      and (
        (i.record_type='q_lounge_order' and i.order_id ~ '^qcr_[0-9a-f-]{36}$')
        or (i.record_type='booking_request' and i.order_id ~ '^qcb_[0-9a-f-]{36}$')
      )
    order by i.expires_at
    limit least(greatest(coalesce(p_limit,0),0),20)
  ) x
$$;
revoke all on function public.qclub_payment_stale_intents(timestamptz,integer)
  from public,anon,authenticated;
grant execute on function public.qclub_payment_stale_intents(timestamptz,integer)
  to service_role;

-- The shared terminal-close primitive now recognizes both rehearsal food (qcr_) and
-- booking (qcb_) orders. Booking release itself is handled by the lifecycle trigger.
create or replace function public.qclub_payment_close_terminal_service(p_order_id text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  intent qclub_private.payment_intents%rowtype;
  reservation qclub_private.checkout_stock_reservations%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^qc[rb]_[0-9a-f-]{36}$'
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
revoke all on function public.qclub_payment_close_terminal_service(text,text)
  from public,anon,authenticated;
grant execute on function public.qclub_payment_close_terminal_service(text,text)
  to service_role;
