-- The six-argument implementation already provides defaults for the last two
-- arguments. Keeping the legacy four-argument wrapper makes four-argument
-- calls ambiguous in PostgreSQL.
drop function if exists public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer);

do $postcondition$
begin
  if to_regprocedure('public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer)') is not null
    or to_regprocedure('public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer,timestamptz,text)') is null then
    raise exception 'operator_pod_history_overload_remains_ambiguous';
  end if;
end;
$postcondition$;
