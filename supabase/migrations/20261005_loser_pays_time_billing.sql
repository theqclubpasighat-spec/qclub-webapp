alter table public.snooker_completed_games
  add column if not exists frame_elapsed_seconds bigint not null default 0,
  add column if not exists session_elapsed_seconds_snapshot bigint not null default 0,
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;

comment on column public.snooker_completed_games.frame_elapsed_seconds is 'Active table seconds consumed by this completed frame/game; pauses are excluded.';
comment on column public.snooker_completed_games.session_elapsed_seconds_snapshot is 'Cumulative active session seconds at completion, used to start the next frame timer from zero without double charging.';
comment on column public.snooker_completed_games.pricing_snapshot is 'Server-side pricing audit for timed loser-pays/member-rate calculations.';