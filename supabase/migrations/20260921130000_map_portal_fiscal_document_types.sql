do $patch$
declare
  signature regprocedure := 'public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure;
  body text;
  needle text := 'AND (_document_type IS NULL OR fd.document_type = _document_type)';
  replacement text := E'AND (\n      _document_type IS NULL\n      OR (_document_type = ''nfe'' AND fd.document_type IN (''nfe'', ''inbound''))\n      OR (_document_type = ''cte'' AND fd.document_type IN (''cte'', ''outbound''))\n      OR (_document_type NOT IN (''nfe'', ''cte'', ''mdfe'') AND fd.document_type = _document_type)\n    )';
begin
  select pg_get_functiondef(signature) into body;
  if position('_document_type = ''nfe'' AND fd.document_type IN' in body) > 0 then return; end if;
  if position(needle in body) = 0 then raise exception 'portal_document_type_contract_changed'; end if;
  execute replace(body, needle, replacement);
end;
$patch$;
