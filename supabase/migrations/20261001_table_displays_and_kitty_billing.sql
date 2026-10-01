-- Q Club table displays + simplified Kitty billing configuration
update public.snooker_tables set price_per_hour_inr=600, member_price_per_hour_inr=500 where table_no in (1,2);
update public.snooker_tables set price_per_hour_inr=500, member_price_per_hour_inr=400 where table_no=3;
update public.snooker_tables set price_per_hour_inr=400, member_price_per_hour_inr=300 where table_no=4;

insert into public.snooker_game_rules
  (game_type,display_name,billing_mode,rate_inr,min_players,max_players,timer_required,active,sort_order)
values
  ('KITTY','Kitty','HOURLY',null,2,6,true,true,60)
on conflict (game_type) do update set
  display_name=excluded.display_name,
  billing_mode=excluded.billing_mode,
  rate_inr=excluded.rate_inr,
  min_players=excluded.min_players,
  max_players=excluded.max_players,
  timer_required=excluded.timer_required,
  active=true,
  sort_order=excluded.sort_order;
