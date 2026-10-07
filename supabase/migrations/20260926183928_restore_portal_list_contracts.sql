-- Restore the list contracts in both deployed states: the published readers
-- scoped by fd.client_id and the newer readers scoped by a selected grant.
-- Patch only recognized, tenant-checked definitions; retain their existing
-- authorization predicates, ACLs and search_path settings.
do $patch$
declare
  signature regprocedure;
  body text;
  original_body text;
  access_call constant text := 'PERFORM public._portal_assert_client_access(_tenant_id, _client_id);';
  guard constant text := E'-- portal_bounded_pagination_v1\n  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 200 OR _offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000 THEN\n    RAISE EXCEPTION ''portal_invalid_pagination'' USING ERRCODE = ''22023'';\n  END IF;\n  ';
begin
  foreach signature in array array[
    'public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure,
    'public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into body;
    original_body := body;
    if position('fd.tenant_id = _tenant_id' in body) = 0
      or position('public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)' in body) = 0
      or (
        position('private.portal_fiscal_visible_for_client(_tenant_id, fd.id, _client_id)' in body) = 0
        and position('(_client_id IS NULL OR fd.client_id = _client_id)' in body) = 0
      ) then
      raise exception 'portal_list_authorization_contract_changed: %', signature;
    end if;

    if position('portal_bounded_pagination_v1' in body) = 0 then
      if position(access_call in body) = 0 then
        raise exception 'portal_pagination_anchor_changed: %', signature;
      end if;
      body := replace(body, access_call, guard || access_call);
    end if;

    if signature = 'public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure then
      if position('_document_type = ''nfe'' AND fd.document_type IN' in body) = 0 then
        if position('AND (_document_type IS NULL OR fd.document_type = _document_type)' in body) = 0 then
          raise exception 'portal_document_type_contract_changed';
        end if;
        body := replace(body,
          'AND (_document_type IS NULL OR fd.document_type = _document_type)',
          E'AND (\n      _document_type IS NULL\n      OR (_document_type = ''nfe'' AND fd.document_type IN (''nfe'', ''inbound''))\n      OR (_document_type = ''cte'' AND fd.document_type IN (''cte'', ''outbound''))\n      OR (_document_type NOT IN (''nfe'', ''cte'', ''mdfe'') AND fd.document_type = _document_type)\n    )');
      end if;
    else
      if position('fd.product_summary, fd.volume_count, fd.pallet_count' in body) = 0 then
        if position('fd.product_summary, fd.pallet_count, fd.weight_kg' in body) = 0 then
          raise exception 'portal_shipment_volume_contract_changed';
        end if;
        body := replace(body,
          'fd.product_summary, fd.pallet_count, fd.weight_kg',
          'fd.product_summary, fd.volume_count, fd.pallet_count, fd.weight_kg');
      end if;

      if position('LEFT JOIN public.loads l ON l.id = fd.load_id AND l.tenant_id = fd.tenant_id' in body) = 0 then
        if position('LEFT JOIN public.loads l ON l.id = fd.load_id' in body) = 0 then
          raise exception 'portal_shipment_load_join_contract_changed';
        end if;
        body := replace(body,
          'LEFT JOIN public.loads l ON l.id = fd.load_id',
          'LEFT JOIN public.loads l ON l.id = fd.load_id AND l.tenant_id = fd.tenant_id');
      end if;
    end if;

    if body is distinct from original_body then
      execute body;
    end if;
  end loop;
end;
$patch$;
