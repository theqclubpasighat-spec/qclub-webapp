-- REHEARSAL ONLY: bounded discovery for stale payment/stock reconciliation.
-- The caller must still independently re-read Cashfree before fulfilment or stock release.

create function public.qclub_payment_stale_intents(p_before timestamptz,p_limit integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('order_id',x.order_id,'expires_at',x.expires_at)
      order by x.expires_at
    ),
    '[]'::jsonb
  )
  from (
    select i.order_id,i.expires_at
    from qclub_private.payment_intents i
    where i.status='pending'
      and i.record_type='q_lounge_order'
      and i.order_id ~ '^qcr_[0-9a-f-]{36}$'
      and i.terminal_at is null
      and i.expires_at<=p_before
    order by i.expires_at
    limit least(greatest(coalesce(p_limit,0),0),20)
  ) x
$$;

revoke all on function public.qclub_payment_stale_intents(timestamptz,integer)
  from public,anon,authenticated;
grant execute on function public.qclub_payment_stale_intents(timestamptz,integer)
  to service_role;
