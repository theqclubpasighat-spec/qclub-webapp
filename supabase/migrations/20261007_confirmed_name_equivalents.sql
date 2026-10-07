insert into public.snooker_customer_aliases(normalized_alias,alias_name,customer_id,created_by)
values
  ('yomso wilson','YOMSO WILSON','9b513f83-88e0-4256-abaf-e41f735a4628'::uuid,'staff_confirmed_20261007'),
  ('kamin tali','KAMIN TALI','ab8bd876-3298-42e2-9080-d2c830ea40b0'::uuid,'staff_confirmed_20261007'),
  ('tali kiron','TALI KIRON','90d8e6e2-8ff0-427b-86b5-6dcc296dbc4b'::uuid,'staff_confirmed_20261007')
on conflict(normalized_alias) do update
set alias_name=excluded.alias_name,customer_id=excluded.customer_id,created_by=excluded.created_by;
