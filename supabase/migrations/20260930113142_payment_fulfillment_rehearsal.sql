-- REHEARSAL ONLY. Depends on the security-foundation private schema.
-- Existing public policies and legacy payment handlers are deliberately untouched.
create table qclub_private.payment_intents (
  order_id text primary key check (order_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 999999999),
  currency text not null default 'INR' check (currency='INR'),
  record_type text not null check (record_type in ('booking_request','q_lounge_order','qshop_receipt')),
  record_key text not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'pending' check (status in ('pending','fulfilled')),
  gateway_payment_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  fulfilled_at timestamptz,
  unique(record_type,record_key),
  check ((status='pending' and gateway_payment_id is null and fulfilled_at is null) or (status='fulfilled' and gateway_payment_id is not null and fulfilled_at is not null))
);
alter table qclub_private.payment_intents enable row level security;
revoke all on qclub_private.payment_intents from public,anon,authenticated;
grant select,insert,update on qclub_private.payment_intents to service_role;

create function public.qclub_payment_intent(p_order_id text,p_receipt_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('amount_paise',i.amount_paise,'status',i.status)
  from qclub_private.payment_intents i where i.order_id=p_order_id
    and i.receipt_hash=p_receipt_hash and i.expires_at>clock_timestamp()
$$;
revoke all on function public.qclub_payment_intent(text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_intent(text,text) to service_role;

create function public.qclub_payment_fulfill(p_order_id text,p_receipt_hash text,p_amount_paise bigint,p_currency text,p_payment_id text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare intent qclub_private.payment_intents%rowtype; target_status text; written integer;
begin
  select * into intent from qclub_private.payment_intents
    where order_id=p_order_id and receipt_hash=p_receipt_hash and expires_at>clock_timestamp() for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if intent.amount_paise is distinct from p_amount_paise or intent.currency is distinct from p_currency
    or p_payment_id is null or p_payment_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  if intent.status='fulfilled' then
    return jsonb_build_object('ok',intent.gateway_payment_id=p_payment_id,'conflict',intent.gateway_payment_id<>p_payment_id);
  end if;
  target_status:=case when intent.record_type='booking_request' then 'paid_verified' else 'paid' end;
  -- INSERT ONLY. Never rewind a record that a member of staff has already progressed.
  insert into public.qclub_operational_records(record_type,record_key,payload,source,status,updated_at)
    values(intent.record_type,intent.record_key,
      intent.payload || jsonb_build_object('gatewayOrderId',intent.order_id,'paymentStatus','Paid','source','cashfree_verified_server','updatedAt',clock_timestamp(),'status',case when intent.record_type='booking_request' then 'paid_verified' else 'Paid' end)
      || case when intent.record_type='booking_request' then jsonb_build_object('amount',intent.amount_paise/100.0) else jsonb_build_object('total',intent.amount_paise/100.0) end,
      'cashfree_verified_server',target_status,clock_timestamp())
    on conflict (record_type,record_key) do nothing;
  get diagnostics written=row_count;
  if written<>1 then return jsonb_build_object('ok',false,'conflict',true); end if;
  update qclub_private.payment_intents set status='fulfilled',gateway_payment_id=p_payment_id,fulfilled_at=clock_timestamp()
    where order_id=p_order_id;
  -- Unique payment identity and record creation commit together; any failure rolls both back.
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qclub_payment_fulfill(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qclub_payment_fulfill(text,text,bigint,text,text) to service_role;


-- Freeze commercial terms so delayed verification cannot settle a changed order.
create function qclub_private.freeze_payment_terms()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (to_jsonb(new)-array['status','gateway_payment_id','fulfilled_at']) is distinct from
     (to_jsonb(old)-array['status','gateway_payment_id','fulfilled_at']) then
    raise exception 'IMMUTABLE_PAYMENT_TERMS';
  end if;
  if old.status='fulfilled' and new is distinct from old then
    raise exception 'FULFILLED_PAYMENT_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function qclub_private.freeze_payment_terms() from public,anon,authenticated;
create trigger freeze_payment_terms before update on qclub_private.payment_intents
for each row execute function qclub_private.freeze_payment_terms();
