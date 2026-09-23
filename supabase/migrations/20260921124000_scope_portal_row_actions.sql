do $patch$
declare
  signature regprocedure;
  body text;
  needle text;
  replacement text;
begin
  signature := 'public.list_client_pickups_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text)'::regprocedure;
  select pg_get_functiondef(signature) into body;
  needle := 'select p.id, p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,';
  replacement := 'select p.id, p.remitter_client_id as client_id,' || E'\n' ||
    '      public._portal_user_has_perm(_tenant_id, p.remitter_client_id, ''can_request_pickup'') as can_cancel,' || E'\n' ||
    '      p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,';
  if position(needle in body) = 0 then raise exception 'portal_pickup_page_contract_changed'; end if;
  execute replace(body, needle, replacement);

  signature := 'public.list_client_occurrences_page_v1(uuid,uuid,text,boolean,integer,timestamptz,jsonb,text)'::regprocedure;
  select pg_get_functiondef(signature) into body;
  needle := 'select oe.id, oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,';
  replacement := 'select oe.id, oe.client_id,' || E'\n' ||
    '      public._portal_user_has_perm(_tenant_id, oe.client_id, ''can_open_occurrences'') as can_reply,' || E'\n' ||
    '      oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,';
  if position(needle in body) = 0 then raise exception 'portal_occurrence_page_contract_changed'; end if;
  execute replace(body, needle, replacement);
end;
$patch$;
