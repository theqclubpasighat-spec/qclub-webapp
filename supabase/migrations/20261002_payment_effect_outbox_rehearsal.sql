-- REHEARSAL ONLY: durable post-payment effects.
-- Payment fulfilment never calls MSG91 or PrintBridge directly.

create table qclub_private.payment_effect_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references qclub_private.payment_intents(order_id) on delete restrict,
  effect_type text not null check(effect_type in ('whatsapp_success','print_food')),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check(attempts>=0),
  worker_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(order_id,effect_type),
  check (
    (status='pending' and worker_id is null and claimed_at is null and sent_at is null)
    or (status='processing' and worker_id is not null and claimed_at is not null and sent_at is null)
    or (status='sent' and sent_at is not null)
    or (status='failed' and sent_at is null)
  )
);
alter table qclub_private.payment_effect_outbox enable row level security;
revoke all on qclub_private.payment_effect_outbox from public,anon,authenticated;
grant select,insert,update on qclub_private.payment_effect_outbox to service_role;

create function qclub_private.enqueue_payment_effects()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
  phone text;
  label text;
  context text;
  effect_payload jsonb;
  notification_data jsonb;
  member_row jsonb;
begin
  if new.status is distinct from 'fulfilled' or old.status='fulfilled' then return new; end if;

  phone:=right(regexp_replace(
    coalesce(new.payload->>'customerMobile',new.payload->>'mobile',''),
    '[^0-9]','','g'
  ),10);
  if phone ~ '^[6-9][0-9]{9}$' then
    context:=case new.record_type
      when 'q_lounge_order' then 'food'
      when 'qshop_receipt' then 'shop'
      when 'booking_request' then 'booking'
      when 'membership_activation' then 'membership'
      when 'tournament_registration' then 'tournament'
      else ''
    end;
    label:=case new.record_type
      when 'q_lounge_order' then 'food_success'
      when 'qshop_receipt' then 'qshop_order_success'
      when 'booking_request' then 'booking_success'
      when 'membership_activation' then 'membership_success'
      when 'tournament_registration' then 'tournament_success'
      else ''
    end;
    if label<>'' then
      notification_data:=new.payload;
      if new.record_type='membership_activation' then
        select value into member_row
        from public.qclub_state q,
             lateral jsonb_array_elements(case when jsonb_typeof(q.state->'memberRegistry')='array'
               then q.state->'memberRegistry' else '[]'::jsonb end)
        where q.key='main'
          and right(regexp_replace(coalesce(value->>'mobile',''),'[^0-9]','','g'),10)=phone
        limit 1;
        if member_row is not null then
          notification_data:=notification_data||jsonb_build_object(
            'validUntil',member_row->>'validUntil',
            'activatedAt',clock_timestamp()::text
          );
        end if;
      end if;
      effect_payload:=jsonb_build_object(
        'provider','msg91',
        'label',label,
        'context',context,
        'phone',phone,
        'orderId',new.order_id,
        'amount',new.amount_paise/100.0,
        'data',notification_data
      );
      insert into qclub_private.payment_effect_outbox(order_id,effect_type,payload)
      values(new.order_id,'whatsapp_success',effect_payload)
      on conflict(order_id,effect_type) do nothing;
    end if;
  end if;

  if new.record_type='q_lounge_order' then
    effect_payload:=jsonb_build_object(
      'orderId',new.order_id,
      'customerName',coalesce(new.payload->>'customerName','Customer'),
      'customerMobile',coalesce(new.payload->>'customerMobile',''),
      'total',new.amount_paise/100.0,
      'items',coalesce(new.payload->'items','[]'::jsonb),
      'createdAt',coalesce(new.payload->'createdAt',to_jsonb(clock_timestamp()))
    );
    insert into qclub_private.payment_effect_outbox(order_id,effect_type,payload)
    values(new.order_id,'print_food',effect_payload)
    on conflict(order_id,effect_type) do nothing;
  end if;
  return new;
end $$;
revoke all on function qclub_private.enqueue_payment_effects() from public,anon,authenticated;
grant execute on function qclub_private.enqueue_payment_effects() to service_role;
create trigger zz_enqueue_payment_effects
after update of status on qclub_private.payment_intents
for each row execute function qclub_private.enqueue_payment_effects();

create function public.qclub_payment_effect_claim(p_effect_type text,p_worker_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare job qclub_private.payment_effect_outbox%rowtype;
begin
  if p_effect_type not in ('whatsapp_success','print_food')
    or p_worker_id is null or length(trim(p_worker_id)) not between 1 and 120 then
    return jsonb_build_object('ok',false);
  end if;

  select * into job
  from qclub_private.payment_effect_outbox
  where effect_type=p_effect_type
    and (
      status='pending'
      or (status='processing' and claimed_at<clock_timestamp()-interval '2 minutes')
    )
  order by created_at,id
  for update skip locked
  limit 1;

  if not found then return jsonb_build_object('ok',true,'job',null); end if;

  update qclub_private.payment_effect_outbox
    set status='processing',worker_id=trim(p_worker_id),claimed_at=clock_timestamp(),
        attempts=attempts+1,last_error=null,updated_at=clock_timestamp()
    where id=job.id
    returning * into job;

  return jsonb_build_object('ok',true,'job',jsonb_build_object(
    'id',job.id,'orderId',job.order_id,'effectType',job.effect_type,
    'payload',job.payload,'attempts',job.attempts
  ));
end $$;
revoke all on function public.qclub_payment_effect_claim(text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_effect_claim(text,text) to service_role;

create function public.qclub_payment_effect_complete(
  p_id uuid,p_worker_id text,p_success boolean,p_error text default null
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare job qclub_private.payment_effect_outbox%rowtype;
begin
  if p_id is null or p_worker_id is null or length(trim(p_worker_id)) not between 1 and 120
    or p_success is null or length(coalesce(p_error,''))>1000 then
    return jsonb_build_object('ok',false);
  end if;

  select * into job
  from qclub_private.payment_effect_outbox
  where id=p_id for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if job.status='sent' then return jsonb_build_object('ok',true,'status','sent'); end if;
  if job.status<>'processing' or job.worker_id<>trim(p_worker_id) then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;

  if p_success then
    update qclub_private.payment_effect_outbox
      set status='sent',sent_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_id;
    return jsonb_build_object('ok',true,'status','sent');
  end if;

  if job.attempts>=10 then
    update qclub_private.payment_effect_outbox
      set status='failed',worker_id=null,claimed_at=null,last_error=left(coalesce(p_error,'Effect failed'),1000),
          updated_at=clock_timestamp()
      where id=p_id;
    return jsonb_build_object('ok',true,'status','failed');
  end if;

  update qclub_private.payment_effect_outbox
    set status='pending',worker_id=null,claimed_at=null,last_error=left(coalesce(p_error,'Effect failed'),1000),
        updated_at=clock_timestamp()
    where id=p_id;
  return jsonb_build_object('ok',true,'status','pending');
end $$;
revoke all on function public.qclub_payment_effect_complete(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_effect_complete(uuid,text,boolean,text) to service_role;
