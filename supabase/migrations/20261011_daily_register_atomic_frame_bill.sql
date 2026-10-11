-- Prepared for review only. Apply to Q Club production immediately before promoting
-- the corresponding API/UI release; never run this on the live DB for a preview.
-- One atomic database transaction posts a register frame charge as an existing
-- PLAYER_ACCOUNT bill plus its GAME bill item. No second account balance exists.
create or replace function public.qclub_register_add_frame_bill(
  p_customer_id uuid,
  p_table_id text,
  p_game_type text,
  p_units integer,
  p_format text,
  p_idempotency_key text,
  p_staff_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer record;
  v_table record;
  v_game record;
  v_bill public.snooker_bills%rowtype;
  v_item public.snooker_bill_items%rowtype;
  v_total numeric(12,2);
  v_bill_id uuid;
  v_no text;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_format text := upper(coalesce(p_format, 'STANDARD'));
begin
  if v_key is null or length(v_key) > 180 then
    raise exception 'REGISTER_IDEMPOTENCY_REQUIRED' using errcode='22023';
  end if;
  if p_units is null or p_units < 1 or p_units > 50 then
    raise exception 'REGISTER_FRAMES_INVALID' using errcode='22023';
  end if;
  if v_format not in ('STANDARD','CHAMPIONSHIP') then
    raise exception 'REGISTER_FORMAT_INVALID' using errcode='22023';
  end if;
  if p_game_type not in ('SIX_BALL_SNOOKER','TEN_BALL_SNOOKER','QCHASE_RUMMY') then
    raise exception 'TIMED_GAME_REQUIRES_TABLE_ENGINE' using errcode='22023';
  end if;
  select * into v_customer from public.snooker_customers
    where id=p_customer_id and active=true;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023'; end if;
  select * into v_table from public.snooker_tables
    where id=p_table_id and active=true;
  if not found or v_table.table_type not in ('FULL_SIZE_SNOOKER','MINI_SNOOKER') then
    raise exception 'INVALID_SNOOKER_TABLE' using errcode='22023';
  end if;
  select * into v_game from public.snooker_game_rules
    where game_type=p_game_type and active=true and billing_mode='PER_PLAYER_PER_GAME';
  if not found or coalesce(v_game.rate_inr,0)<=0 then
    raise exception 'REGISTER_GAME_RATE_MISSING' using errcode='22023';
  end if;

  -- A live session already creates its own authoritative charges. Never double
  -- bill a running table or a customer playing on another live table.
  if exists(select 1 from public.snooker_sessions s
            where s.table_id=p_table_id and s.status in ('ACTIVE','PAUSED')) or
     exists(select 1 from public.snooker_session_people sp
            join public.snooker_sessions s on s.id=sp.session_id
            where sp.customer_id=p_customer_id and sp.status='ACTIVE'
              and s.status in ('ACTIVE','PAUSED')) then
    raise exception 'USE_ACTIVE_TABLE_ENGINE' using errcode='23514';
  end if;

  select * into v_bill from public.snooker_bills where idempotency_key=v_key;
  if found then
    select * into v_item from public.snooker_bill_items where bill_id=v_bill.id limit 1;
    if v_bill.customer_id is distinct from p_customer_id or
       v_item.metadata->>'source' is distinct from 'DAILY_REGISTER_FRAME' or
       v_item.metadata->>'table_id' is distinct from p_table_id or
       v_item.metadata->>'game_type' is distinct from p_game_type or
       v_item.metadata->>'register_format' is distinct from v_format or
       v_item.quantity is distinct from p_units then
      raise exception 'REGISTER_IDEMPOTENCY_KEY_REUSED' using errcode='23514';
    end if;
    return jsonb_build_object('ok',true,'reused',true,'bill_id',v_bill.id,
      'bill_no',v_bill.bill_no,'amount_inr',v_bill.total_inr);
  end if;

  v_total := round(v_game.rate_inr * p_units,2);
  v_bill_id := gen_random_uuid();
  v_no := 'QC-' || to_char(clock_timestamp(),'YYMMDD') || '-' ||
    upper(substr(replace(v_bill_id::text,'-',''),27,6));
  insert into public.snooker_bills(
    id,bill_no,customer_id,customer_name,customer_phone,
    bill_source,session_id,source_session_id,person_id,
    game_total_inr,fnb_total_inr,discount_inr,total_inr,paid_inr,due_inr,
    status,revision,finalized_at,finalized_by,idempotency_key
  ) values (
    v_bill_id,v_no,v_customer.id,v_customer.name,v_customer.phone,
    'PLAYER_ACCOUNT',null,null,null,
    v_total,0,0,v_total,0,v_total,
    'UNPAID','1',now(),p_staff_id,v_key
  ) returning * into v_bill;
  insert into public.snooker_bill_items(
    bill_id,item_type,description,quantity,unit_price_inr,line_total_inr,metadata
  ) values (
    v_bill.id,'GAME',
    case p_game_type
      when 'SIX_BALL_SNOOKER' then '6-Ball Snooker'
      when 'TEN_BALL_SNOOKER' then '10-Ball Snooker'
      else 'QChase / Rummy'
    end || case when v_format='CHAMPIONSHIP' then ' · Championship' else '' end,
    p_units,v_game.rate_inr,v_total,
    jsonb_build_object('source','DAILY_REGISTER_FRAME','table_id',p_table_id,
      'game_type',p_game_type,'register_format',v_format,'staff_id',p_staff_id)
  ) returning * into v_item;
  return jsonb_build_object('ok',true,'reused',false,'bill_id',v_bill.id,
    'bill_no',v_bill.bill_no,'amount_inr',v_bill.total_inr);
exception
  when unique_violation then
    -- Unique idempotency key conflicts roll back all writes in this function;
    -- caller can retry the same key once transaction has completed.
    raise exception 'REGISTER_DUPLICATE_RETRY_SAME_KEY' using errcode='23505';
end;
$$;

revoke all on function public.qclub_register_add_frame_bill(uuid,text,text,integer,text,text,text) from public;
revoke all on function public.qclub_register_add_frame_bill(uuid,text,text,integer,text,text,text) from anon;
revoke all on function public.qclub_register_add_frame_bill(uuid,text,text,integer,text,text,text) from authenticated;
grant execute on function public.qclub_register_add_frame_bill(uuid,text,text,integer,text,text,text) to service_role;
