-- REHEARSAL ONLY: operational recovery for durable post-payment effects.
-- Exposes aggregate queue health and explicit retry of dead-lettered effects.
-- No customer payloads are returned by the summary function.

create function public.qclub_payment_effect_summary()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'),
    'processing',count(*) filter(where status='processing'),
    'sent',count(*) filter(where status='sent'),
    'failed',count(*) filter(where status='failed'),
    'stale_processing',count(*) filter(
      where status='processing' and claimed_at<clock_timestamp()-interval '2 minutes'
    ),
    'oldest_pending_at',min(created_at) filter(where status='pending'),
    'oldest_failed_at',min(updated_at) filter(where status='failed')
  )
  from qclub_private.payment_effect_outbox
$$;
revoke all on function public.qclub_payment_effect_summary() from public,anon,authenticated;
grant execute on function public.qclub_payment_effect_summary() to service_role;

create function public.qclub_payment_effect_retry_failed(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare job qclub_private.payment_effect_outbox%rowtype;
begin
  if p_id is null then return jsonb_build_object('ok',false); end if;

  select * into job
  from qclub_private.payment_effect_outbox
  where id=p_id
  for update;

  if not found then return jsonb_build_object('ok',false); end if;
  if job.status='sent' then
    return jsonb_build_object('ok',false,'conflict',true,'status','sent');
  end if;
  if job.status<>'failed' then
    return jsonb_build_object('ok',false,'conflict',true,'status',job.status);
  end if;

  update qclub_private.payment_effect_outbox
    set status='pending',
        attempts=0,
        worker_id=null,
        claimed_at=null,
        sent_at=null,
        last_error=null,
        updated_at=clock_timestamp()
    where id=p_id;

  return jsonb_build_object(
    'ok',true,
    'status','pending',
    'id',p_id,
    'orderId',job.order_id,
    'effectType',job.effect_type
  );
end $$;
revoke all on function public.qclub_payment_effect_retry_failed(uuid) from public,anon,authenticated;
grant execute on function public.qclub_payment_effect_retry_failed(uuid) to service_role;
