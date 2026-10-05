-- Shared hourly QChase/Rummy billing.
-- The table cost is split equally among players who are ACTIVE during each time slice.
-- A roster change settles the previous slice before the player joins/leaves.

alter table public.snooker_sessions
  add column if not exists shared_hourly_last_at timestamptz,
  add column if not exists shared_hourly_rate_inr numeric(12,2);

create or replace function public.settle_shared_hourly_slice(
  p_session_id uuid,
  p_at timestamptz default now(),
  p_staff_id text default null,
  p_reason text default 'ROSTER_CHANGE'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.snooker_sessions%rowtype;
  v_start timestamptz;
  v_end timestamptz := coalesce(p_at, now());
  v_seconds integer := 0;
  v_count integer := 0;
  v_rate numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_base numeric(12,2) := 0;
  v_used numeric(12,2) := 0;
  v_amount numeric(12,2) := 0;
  v_index integer := 0;
  v_reference text;
  p public.snooker_session_people%rowtype;
  v_allocations jsonb := '[]'::jsonb;
begin
  select * into s
  from public.snooker_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if coalesce(s.payment_rule, '') <> 'HOURLY_SHARED' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'NOT_SHARED_HOURLY');
  end if;

  v_start := coalesce(s.shared_hourly_last_at, s.timer_started_at, s.started_at, v_end);
  v_rate := coalesce(s.shared_hourly_rate_inr, 0);

  if not coalesce(s.timer_running, false) then
    update public.snooker_sessions
      set shared_hourly_last_at = v_end
    where id = p_session_id;
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'TIMER_NOT_RUNNING');
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (v_end - v_start)))::integer);

  select count(*) into v_count
  from public.snooker_session_people
  where session_id = p_session_id
    and status = 'ACTIVE';

  if v_seconds <= 0 or v_count <= 0 or v_rate <= 0 then
    update public.snooker_sessions
      set shared_hourly_last_at = v_end
    where id = p_session_id;
    return jsonb_build_object(
      'ok', true,
      'elapsed_seconds', v_seconds,
      'active_players', v_count,
      'total_inr', 0,
      'allocations', v_allocations
    );
  end if;

  v_total := round((v_rate * v_seconds::numeric / 3600.0)::numeric, 2);
  v_base := round((v_total / v_count)::numeric, 2);
  v_reference := 'shared:' || p_session_id::text || ':' ||
    (extract(epoch from v_start) * 1000)::bigint::text || ':' ||
    (extract(epoch from v_end) * 1000)::bigint::text;

  for p in
    select *
    from public.snooker_session_people
    where session_id = p_session_id
      and status = 'ACTIVE'
    order by joined_at, id
  loop
    v_index := v_index + 1;
    if v_index = v_count then
      v_amount := round((v_total - v_used)::numeric, 2);
    else
      v_amount := v_base;
    end if;
    v_used := round((v_used + v_amount)::numeric, 2);

    if v_amount > 0 then
      insert into public.snooker_person_charges (
        session_id,
        person_id,
        charge_type,
        reference_id,
        description,
        amount_inr,
        metadata,
        created_by
      ) values (
        p_session_id,
        p.id,
        'TABLE',
        v_reference,
        'Shared table time — ' || round(v_seconds::numeric / 60.0, 1)::text ||
          ' min / ' || v_count::text || ' players',
        v_amount,
        jsonb_build_object(
          'source', 'HOURLY_SHARED',
          'segment_started_at', v_start,
          'segment_ended_at', v_end,
          'elapsed_seconds', v_seconds,
          'active_player_count', v_count,
          'hourly_rate_inr', v_rate,
          'segment_total_inr', v_total,
          'reason', coalesce(p_reason, 'ROSTER_CHANGE')
        ),
        p_staff_id
      );

      v_allocations := v_allocations || jsonb_build_array(
        jsonb_build_object(
          'person_id', p.id,
          'name', p.name,
          'amount_inr', v_amount
        )
      );
    end if;
  end loop;

  update public.snooker_sessions
    set shared_hourly_last_at = v_end
  where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'started_at', v_start,
    'ended_at', v_end,
    'elapsed_seconds', v_seconds,
    'active_players', v_count,
    'hourly_rate_inr', v_rate,
    'total_inr', v_total,
    'allocations', v_allocations
  );
end;
$$;

revoke all on function public.settle_shared_hourly_slice(uuid,timestamptz,text,text) from public;
revoke all on function public.settle_shared_hourly_slice(uuid,timestamptz,text,text) from anon;
revoke all on function public.settle_shared_hourly_slice(uuid,timestamptz,text,text) from authenticated;
grant execute on function public.settle_shared_hourly_slice(uuid,timestamptz,text,text) to service_role;
