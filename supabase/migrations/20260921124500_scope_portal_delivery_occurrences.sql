do $patch$
declare
  signature regprocedure := 'public.get_client_portal_upcoming_deliveries(uuid,uuid,integer)'::regprocedure;
  body text;
  needle text := E'WHERE oo.load_id = fd.load_id AND oo.visible_to_client = true\n                AND oo.public_status = ''open''';
  replacement text := E'WHERE oo.tenant_id = fd.tenant_id\n                AND oo.visible_to_client = true\n                AND oo.public_status = ''open''\n                AND (\n                  oo.fiscal_document_id = fd.id\n                  OR (oo.fiscal_document_id IS NULL AND oo.client_id = fd.client_id AND oo.load_id = fd.load_id)\n                )';
begin
  select pg_get_functiondef(signature) into body;
  if position('oo.fiscal_document_id = fd.id' in body) > 0 then return; end if;
  if position(needle in body) = 0 then
    raise exception 'portal_upcoming_occurrence_contract_changed';
  end if;
  execute replace(body, needle, replacement);
end;
$patch$;
