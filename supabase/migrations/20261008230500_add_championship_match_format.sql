alter table public.snooker_sessions
  drop constraint if exists snooker_sessions_match_format_check;

alter table public.snooker_sessions
  add constraint snooker_sessions_match_format_check
  check (
    match_format is null
    or match_format = any (
      array[
        'FLEX'::text,
        'SINGLES'::text,
        'DOUBLES'::text,
        'CHAMPIONSHIP'::text
      ]
    )
  );
