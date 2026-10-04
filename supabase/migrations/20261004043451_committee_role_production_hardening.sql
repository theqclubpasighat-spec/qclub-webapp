-- Production hardening paired with the canonical COMMITTEE session-role cutover.
-- Applied to Q Club production before the web API starts issuing COMMITTEE sessions.

alter table public.snooker_auth_sessions
  drop constraint if exists snooker_auth_sessions_role_check;

alter table public.snooker_auth_sessions
  add constraint snooker_auth_sessions_role_check
  check (role in ('STAFF','ADMIN','COMMITTEE'));

-- qclub_protect_main_state is a trigger-only SECURITY DEFINER safety guard.
-- Keep it executable by the server role but remove direct Data API/RPC execution.
revoke all on function public.qclub_protect_main_state()
  from public, anon, authenticated;

grant execute on function public.qclub_protect_main_state()
  to service_role;
