-- 2026-10-18 Q Club CMS revision safety and Massage Chair public prices.
-- Preserve the existing dangerous-collection-overwrite protections exactly.
-- A byte-identical JSONB document is not an edit. Suppress timestamp-only
-- revision bumps; leave existing callers' UPDATE result shape unchanged.
CREATE OR REPLACE FUNCTION public.qclub_protect_main_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_shop integer;
  new_shop integer;
  old_memberships integer;
  new_memberships integer;
  old_tournaments integer;
  new_tournaments integer;
  old_booking_tables integer;
  new_booking_tables integer;
BEGIN
  IF NEW.key <> 'main' THEN
    RETURN NEW;
  END IF;

  -- Public background sync used to refresh updated_at every ~30 seconds
  -- even with identical content, invalidating Admin drafts. Keep the prior
  -- revision when there is no substantive JSONB change, and skip backup spam.
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;

  old_shop := public.qclub_jsonb_array_len_safe(OLD.state #> '{shopCatalog,items}');
  new_shop := public.qclub_jsonb_array_len_safe(NEW.state #> '{shopCatalog,items}');

  old_memberships := public.qclub_jsonb_array_len_safe(OLD.state -> 'memberships');
  new_memberships := public.qclub_jsonb_array_len_safe(NEW.state -> 'memberships');

  old_tournaments := public.qclub_jsonb_array_len_safe(OLD.state -> 'tournaments');
  new_tournaments := public.qclub_jsonb_array_len_safe(NEW.state -> 'tournaments');

  old_booking_tables := public.qclub_jsonb_array_len_safe(OLD.state #> '{booking,tables}');
  new_booking_tables := public.qclub_jsonb_array_len_safe(NEW.state #> '{booking,tables}');

  INSERT INTO public.qclub_state_backups (
    key, old_updated_at, old_state, new_state, reason
  ) VALUES (
    OLD.key, OLD.updated_at, OLD.state, NEW.state, 'before_update'
  );

  -- Preserve all the existing protective thresholds.
  IF old_shop >= 8 AND new_shop <= 3 THEN
    RAISE EXCEPTION 'Q Club safety guard blocked dangerous overwrite: shop items dropped from % to %', old_shop, new_shop;
  END IF;
  IF old_memberships >= 4 AND new_memberships <= 1 THEN
    RAISE EXCEPTION 'Q Club safety guard blocked dangerous overwrite: memberships dropped from % to %', old_memberships, new_memberships;
  END IF;
  IF old_tournaments >= 4 AND new_tournaments <= 1 THEN
    RAISE EXCEPTION 'Q Club safety guard blocked dangerous overwrite: tournaments dropped from % to %', old_tournaments, new_tournaments;
  END IF;
  IF old_booking_tables >= 3 AND new_booking_tables = 0 THEN
    RAISE EXCEPTION 'Q Club safety guard blocked dangerous overwrite: booking tables dropped from % to %', old_booking_tables, new_booking_tables;
  END IF;

  RETURN NEW;
END;
$function$;

-- Update only the Massage Chair information body; all other site data and
-- operational charges remain untouched. An unexpected concurrent edit fails.
DO $prices$
DECLARE
  previous_text text;
  expected_header text := E'## Pricing\n- ₹200 for 10 minutes\n- ₹300 for 20 minutes';
  replacement_header text := E'## Pricing\n- ₹149 for 10 minutes\n- ₹199 for 15 minutes\n- ₹349 for 30 minutes\n- ₹599 for 60 minutes';
BEGIN
  SELECT state #>> '{club,massageChairInfoContent}' INTO previous_text
  FROM public.qclub_state WHERE key='main' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Q Club main website state not found';
  END IF;
  IF position(replacement_header in previous_text) = 1 THEN
    RETURN;
  END IF;
  IF position(expected_header in previous_text) <> 1 THEN
    RAISE EXCEPTION 'Massage pricing was edited concurrently: manual review needed';
  END IF;
  UPDATE public.qclub_state
  SET state = jsonb_set(
    state,
    '{club,massageChairInfoContent}',
    to_jsonb(replace(previous_text, expected_header, replacement_header)),
    false
  ), updated_at = clock_timestamp()
  WHERE key='main';
END;
$prices$;
