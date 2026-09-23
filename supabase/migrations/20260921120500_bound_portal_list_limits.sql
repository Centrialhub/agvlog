do $patch$
declare
  signature regprocedure;
  body text;
  anchor text := E'BEGIN\n  PERFORM public._portal_assert_client_access';
  guard text := E'BEGIN\n  -- portal_bounded_pagination_v1\n  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 200 OR _offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000 THEN\n    RAISE EXCEPTION ''portal_invalid_pagination'' USING ERRCODE = ''22023'';\n  END IF;\n  PERFORM public._portal_assert_client_access';
begin
  foreach signature in array array[
    'public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure,
    'public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)'::regprocedure,
    'public.list_client_pickups_v2(uuid,uuid,text,timestamptz,timestamptz,integer,integer)'::regprocedure,
    'public.list_client_occurrences_v2(uuid,uuid,text,boolean,integer,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into body;
    if position('portal_bounded_pagination_v1' in body) > 0 then continue; end if;
    if position(anchor in body) = 0 then raise exception 'portal_pagination_contract_changed: %', signature; end if;
    execute replace(body, anchor, guard);
  end loop;
end;
$patch$;
