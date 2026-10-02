-- REHEARSAL ONLY: server-priced tournament registration checkout.
-- Existing production tournament/payment flows are untouched.

alter table qclub_private.payment_intents
  drop constraint if exists payment_intents_record_type_check;
alter table qclub_private.payment_intents
  add constraint payment_intents_record_type_check
  check (record_type in (
    'booking_request','q_lounge_order','qshop_receipt','tournament_registration'
  ));

create table qclub_private.tournament_registration_reservations (
  order_id text primary key references qclub_private.payment_intents(order_id) on delete restrict,
  tournament_id text not null,
  player_id text not null,
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
create unique index tournament_registration_active_player
  on qclub_private.tournament_registration_reservations(tournament_id,player_id)
  where status in ('reserved','fulfilled');
alter table qclub_private.tournament_registration_reservations enable row level security;
revoke all on qclub_private.tournament_registration_reservations from public,anon,authenticated;
grant select,insert,update on qclub_private.tournament_registration_reservations to service_role;

create function qclub_private.sync_tournament_registration_lifecycle()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
  reservation qclub_private.tournament_registration_reservations%rowtype;
  state jsonb;
  tournaments jsonb;
  tournament jsonb;
  index_no integer;
  participants jsonb;
begin
  select * into reservation
  from qclub_private.tournament_registration_reservations
  where order_id=new.order_id
  for update;
  if not found then return new; end if;

  if new.status='fulfilled' and old.status is distinct from 'fulfilled' then
    select q.state into state from public.qclub_state q where q.key='main' for update;
    if state is null or jsonb_typeof(state->'tournaments')<>'array' then
      raise exception 'TOURNAMENT_STATE_UNAVAILABLE';
    end if;
    tournaments:=state->'tournaments';
    select (ordinality-1)::integer,value into index_no,tournament
    from jsonb_array_elements(tournaments) with ordinality
    where value->>'id'=reservation.tournament_id
    limit 1;
    if tournament is null then raise exception 'TOURNAMENT_NOT_FOUND'; end if;

    participants:=case when jsonb_typeof(tournament->'participantIds')='array'
      then tournament->'participantIds' else '[]'::jsonb end;
    if not exists(
      select 1 from jsonb_array_elements_text(participants) p(value)
      where p.value=reservation.player_id
    ) then
      participants:=participants||to_jsonb(reservation.player_id);
      tournament:=jsonb_set(tournament,'{participantIds}',participants,true);
      tournaments:=jsonb_set(tournaments,array[index_no::text],tournament,true);
      state:=jsonb_set(state,'{tournaments}',tournaments,true);
      update public.qclub_state set state=state,updated_at=clock_timestamp() where key='main';
    end if;

    update qclub_private.tournament_registration_reservations
      set status='fulfilled',fulfilled_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  elsif new.terminal_at is not null and old.terminal_at is null then
    update qclub_private.tournament_registration_reservations
      set status='released',released_at=clock_timestamp()
      where order_id=new.order_id and status='reserved';
  end if;
  return new;
end $$;
revoke all on function qclub_private.sync_tournament_registration_lifecycle() from public,anon,authenticated;
grant execute on function qclub_private.sync_tournament_registration_lifecycle() to service_role;
create trigger sync_tournament_registration_lifecycle
after update of status,terminal_at on qclub_private.payment_intents
for each row execute function qclub_private.sync_tournament_registration_lifecycle();

create function public.qclub_tournament_checkout(
  p_order_id text,p_receipt_hash text,p_request_hash text,p_tournament_id text,
  p_player_id text,p_customer_name text,p_customer_phone text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  existing qclub_private.payment_intents%rowtype;
  state jsonb;
  tournament jsonb;
  player jsonb;
  participants jsonb;
  fee numeric;
  amount_paise bigint;
  normalized_mobile text;
  expires timestamptz;
begin
  if p_order_id is null or p_order_id !~ '^qct_[0-9a-f-]{36}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_tournament_id is null or length(p_tournament_id) not between 1 and 160
    or p_player_id is null or length(p_player_id) not between 1 and 160
    or p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120
    or p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok',false,'reason','INVALID_TOURNAMENT_CHECKOUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id,48117));
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
      'expires_at',existing.expires_at,
      'tournament_name',existing.payload->>'tournamentName'
    );
  end if;

  select q.state into state from public.qclub_state q where q.key='main' for update;
  if state is null or jsonb_typeof(state->'tournaments')<>'array'
    or jsonb_typeof(state->'players')<>'array' then
    return jsonb_build_object('ok',false,'reason','TOURNAMENT_UNAVAILABLE');
  end if;

  select value into tournament
  from jsonb_array_elements(state->'tournaments')
  where value->>'id'=p_tournament_id
  limit 1;
  if tournament is null then return jsonb_build_object('ok',false,'reason','TOURNAMENT_NOT_FOUND'); end if;
  if coalesce((tournament->>'isCurrent')::boolean,false) is not true then
    return jsonb_build_object('ok',false,'reason','TOURNAMENT_NOT_OPEN');
  end if;
  if coalesce(tournament->>'registrationFee','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
    return jsonb_build_object('ok',false,'reason','TOURNAMENT_NOT_OPEN');
  end if;
  fee:=(tournament->>'registrationFee')::numeric;
  if fee<=0 or fee>999999.99 or fee*100<>trunc(fee*100) then
    return jsonb_build_object('ok',false,'reason','TOURNAMENT_NOT_OPEN');
  end if;
  amount_paise:=(fee*100)::bigint;

  select value into player
  from jsonb_array_elements(state->'players')
  where value->>'id'=p_player_id
  limit 1;
  if player is null then return jsonb_build_object('ok',false,'reason','PLAYER_NOT_FOUND'); end if;
  normalized_mobile:=right(regexp_replace(coalesce(player->>'mobile',''),'[^0-9]','','g'),10);
  if normalized_mobile<>p_customer_phone then
    return jsonb_build_object('ok',false,'reason','PLAYER_IDENTITY_MISMATCH');
  end if;

  participants:=case when jsonb_typeof(tournament->'participantIds')='array'
    then tournament->'participantIds' else '[]'::jsonb end;
  if exists(
    select 1 from jsonb_array_elements_text(participants) p(value)
    where p.value=p_player_id
  ) then return jsonb_build_object('ok',false,'reason','ALREADY_REGISTERED'); end if;

  if exists(
    select 1 from qclub_private.tournament_registration_reservations r
    where r.tournament_id=p_tournament_id and r.player_id=p_player_id
      and r.status in ('reserved','fulfilled')
  ) then return jsonb_build_object('ok',false,'reason','REGISTRATION_ALREADY_RESERVED'); end if;

  expires:=clock_timestamp()+interval '1 hour';
  insert into qclub_private.payment_intents(
    order_id,receipt_hash,request_hash,amount_paise,record_type,record_key,payload,expires_at
  ) values(
    p_order_id,p_receipt_hash,p_request_hash,amount_paise,'tournament_registration',p_order_id,
    jsonb_build_object(
      'id','TR-'||right(p_order_id,8),
      'registrationId','TR-'||right(p_order_id,8),
      'tournamentId',p_tournament_id,
      'tournamentName',coalesce(tournament->>'name','Tournament'),
      'tournamentGame',coalesce(tournament->>'game',''),
      'tournamentFee',fee,
      'playerId',p_player_id,
      'customerName',trim(p_customer_name),
      'customerMobile',p_customer_phone,
      'paymentStatus','Pending',
      'registeredAt',null,
      'createdAt',clock_timestamp()
    ),
    expires
  );

  insert into qclub_private.tournament_registration_reservations(
    order_id,tournament_id,player_id,customer_phone
  ) values(p_order_id,p_tournament_id,p_player_id,p_customer_phone);

  return jsonb_build_object(
    'ok',true,'amount_paise',amount_paise,'status','pending',
    'expires_at',expires,'tournament_name',coalesce(tournament->>'name','Tournament')
  );
end $$;
revoke all on function public.qclub_tournament_checkout(text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.qclub_tournament_checkout(text,text,text,text,text,text,text)
  to service_role;

-- Include tournament registration in bounded abandoned-payment reconciliation.
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
      )
    order by i.expires_at
    limit least(greatest(coalesce(p_limit,0),0),20)
  ) x
$$;
revoke all on function public.qclub_payment_stale_intents(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.qclub_payment_stale_intents(timestamptz,integer) to service_role;

-- Terminal close releases any tournament hold through the lifecycle trigger.
create or replace function public.qclub_payment_close_terminal_service(p_order_id text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  intent qclub_private.payment_intents%rowtype;
  reservation qclub_private.checkout_stock_reservations%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^qc[rbst]_[0-9a-f-]{36}$'
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
