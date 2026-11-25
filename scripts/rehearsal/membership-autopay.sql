-- Install only in the disposable rehearsal database.
begin;
create table public.qclub_autopay (
  id uuid primary key, owner_hash text not null, tier_id text not null,
  tier text not null, amount numeric(12,2) not null check (amount > 0),
  name text not null, phone text not null, email text not null,
  first_date date not null, paid_until date, status text not null default 'NEW'
);
create unique index qclub_autopay_open_phone on public.qclub_autopay(phone)
where status not in ('CANCELLED','CUSTOMER_CANCELLED','COMPLETED','EXPIRED','LINK_EXPIRED');
create table public.qclub_autopay_receipts (
  payment_id text primary key, subscription_id uuid not null references public.qclub_autopay,
  cycle_start date not null, amount numeric(12,2) not null, received_at timestamptz not null default now(),
  unique (subscription_id,cycle_start)
);
alter table public.qclub_autopay enable row level security;
alter table public.qclub_autopay_receipts enable row level security;
revoke all on public.qclub_autopay, public.qclub_autopay_receipts from public, anon, authenticated;
grant select,insert,update on public.qclub_autopay,public.qclub_autopay_receipts to service_role;

create function public.qclub_autopay_paid(p_id uuid,p_payment text,p_cycle date,p_amount numeric)
returns void language plpgsql security invoker set search_path='' as $$
declare
  sub public.qclub_autopay%rowtype;
  registry jsonb; member jsonb; idx integer; matches integer; months integer; expiry date;
begin
  select * into strict sub from public.qclub_autopay where id=p_id for update;
  months := (extract(year from p_cycle)-extract(year from sub.first_date))*12
    + extract(month from p_cycle)-extract(month from sub.first_date);
  if p_cycle is null or months < 0 or p_cycle <> (sub.first_date+make_interval(months=>months))::date
    or p_amount is distinct from sub.amount or nullif(p_payment,'') is null then
    raise exception 'Payment does not match billing cycle';
  end if;
  if exists(select from public.qclub_autopay_receipts where payment_id=p_payment
      and subscription_id=p_id and cycle_start=p_cycle) then return; end if;
  insert into public.qclub_autopay_receipts values(p_payment,p_id,p_cycle,p_amount,now());
  expiry := (sub.first_date+make_interval(months=>months+1))::date-1;
  select coalesce(state->'memberRegistry','[]'::jsonb) into strict registry
    from public.qclub_state where key='main' for update;
  select count(*), min(ordinality-1) into matches,idx from jsonb_array_elements(registry) with ordinality
    where right(regexp_replace(value->>'mobile','[^0-9]','','g'),10)=sub.phone;
  if matches>1 then raise exception 'Ambiguous member'; end if;
  member := case when matches=1 then registry->idx else jsonb_build_object(
    'id','reg_'||sub.id,'name',sub.name,'mobile',sub.phone,'joinedOn',p_cycle) end;
  if coalesce(nullif(member->>'validUntil','')::date,'-infinity'::date)<=expiry then
    member := member || jsonb_build_object('tier',sub.tier,'validUntil',expiry,'status','active');
    registry := case when matches=1 then jsonb_set(registry,array[idx::text],member)
      else registry||jsonb_build_array(member) end;
    update public.qclub_state set state=jsonb_set(state,'{memberRegistry}',registry),
      updated_at=clock_timestamp() where key='main';
  end if;
  update public.qclub_autopay set paid_until=greatest(paid_until,expiry) where id=p_id;
end $$;
revoke all on function public.qclub_autopay_paid(uuid,text,date,numeric) from public,anon,authenticated;
grant execute on function public.qclub_autopay_paid(uuid,text,date,numeric) to service_role;
commit;
