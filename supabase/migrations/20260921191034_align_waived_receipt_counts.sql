do $migration$
declare
  target regprocedure;
  previous_definition text;
  corrected_definition text;
begin
  foreach target in array array[
    'public.get_trip_cargo_control_v2(uuid,uuid)'::regprocedure,
    'public.list_trip_cargo_controls_v2(uuid,text,integer,integer,text)'::regprocedure
  ] loop
    previous_definition:=pg_get_functiondef(target);
    corrected_definition:=regexp_replace(
      previous_definition,
      'physical_status\s*<>\s*''received''',
      'physical_status not in (''received'',''waived'')',
      'gi'
    );
    if corrected_definition=previous_definition then
      raise exception 'waived_receipt_count_predicate_not_found: %',target;
    end if;
    execute corrected_definition;
  end loop;
end;
$migration$;

comment on function public.get_trip_cargo_control_v2(uuid,uuid) is
  'Returns a paged custody snapshot whose pending physical receipt count excludes received and formally waived receipts.';
