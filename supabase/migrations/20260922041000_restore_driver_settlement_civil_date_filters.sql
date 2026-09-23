-- The paged v2 rewrite regressed DATE inputs to an implicit session-timezone cast.
-- Interpret settlement filters as Sao Paulo civil days, matching the UI contract.
do $patch$
declare
  body text;
  from_clause text;
  to_clause text;
begin
  body := pg_get_functiondef(
    'public.list_driver_settlements_v2(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,timestamptz,jsonb,integer)'::regprocedure
  );
  from_clause := 'and (_date_from is null or settlement.trip_completed_at >= _date_from)';
  to_clause := 'and (_date_to is null or settlement.trip_completed_at < (_date_to + interval ''1 day''))';

  if position('(_date_from::timestamp at time zone ''America/Sao_Paulo'')' in body) > 0
     and position('((_date_to + 1)::timestamp at time zone ''America/Sao_Paulo'')' in body) > 0 then
    return;
  end if;
  if position(from_clause in body) = 0 or position(to_clause in body) = 0 then
    raise exception 'driver_settlement_civil_date_predecessor_changed';
  end if;

  body := replace(body, from_clause,
    'and (_date_from is null or settlement.trip_completed_at >= (_date_from::timestamp at time zone ''America/Sao_Paulo''))');
  body := replace(body, to_clause,
    'and (_date_to is null or settlement.trip_completed_at < ((_date_to + 1)::timestamp at time zone ''America/Sao_Paulo''))');
  execute body;
end
$patch$;
