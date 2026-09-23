-- Treat settlement search as literal text instead of a SQL LIKE program.
do $patch$
declare
  body text;
  needle text;
begin
  body := pg_get_functiondef(
    'public.list_driver_settlements_v2(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,timestamptz,jsonb,integer)'::regprocedure
  );

  if position('v_pattern text;' in body) > 0
     and position($marker$ilike v_pattern escape E'\\'$marker$ in body) > 0 then
    return;
  end if;

  needle := $old$  v_q text := nullif(trim(coalesce(_search, '')), '');
  v_scope text;$old$;
  if position(needle in body) = 0 then
    raise exception 'driver_settlement_search_variables_changed';
  end if;
  body := replace(body, needle, $new$  v_q text := nullif(trim(coalesce(_search, '')), '');
  v_pattern text;
  v_scope text;$new$);

  needle := $old$  if _date_from is not null and _date_to is not null and _date_from > _date_to then$old$;
  if position(needle in body) = 0 then
    raise exception 'driver_settlement_search_validation_changed';
  end if;
  body := replace(body, needle, $new$  v_pattern := case when v_q is null then null else
    '%' || replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
  end;

  if _date_from is not null and _date_to is not null and _date_from > _date_to then$new$);

  needle := $old$ilike '%' || v_q || '%'$old$;
  if (length(body) - length(replace(body, needle, ''))) / length(needle) <> 6 then
    raise exception 'driver_settlement_search_predicates_changed';
  end if;
  body := replace(body, needle, $new$ilike v_pattern escape E'\\'$new$);

  execute body;
end
$patch$;
