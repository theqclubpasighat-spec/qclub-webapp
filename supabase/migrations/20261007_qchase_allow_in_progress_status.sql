-- QChase/Rummy game lifecycle requires an explicit IN_PROGRESS state.
-- The original snooker_completed_games status check only allowed COMPLETED/VOIDED,
-- which caused QChase session creation to roll back when Game 1 was inserted.

alter table public.snooker_completed_games
  drop constraint if exists snooker_completed_games_status_check;

alter table public.snooker_completed_games
  add constraint snooker_completed_games_status_check
  check (status = any (array[
    'IN_PROGRESS'::text,
    'COMPLETED'::text,
    'VOIDED'::text
  ]));
