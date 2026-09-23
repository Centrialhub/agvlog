do $migration$
declare
  v_function text;
  v_received_branch text := 'FROM public.available_delivery_proofs p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.received_at IS NOT NULL';
  v_received_replacement text := 'FROM public.proof_of_delivery p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.received_at IS NOT NULL';
  v_validated_branch text := 'FROM public.available_delivery_proofs p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.validated_at IS NOT NULL';
  v_validated_replacement text := 'FROM public.proof_of_delivery p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.validated_at IS NOT NULL';
begin
  select pg_get_functiondef('public.get_client_portal_shipment_detail_v2(uuid)'::regprocedure)
  into v_function;

  if position(v_received_branch in v_function) = 0
     or position(v_validated_branch in v_function) = 0 then
    raise exception 'portal_shipment_detail_pod_timeline_contract_not_found';
  end if;

  v_function := replace(v_function, v_received_branch, v_received_replacement);
  v_function := replace(v_function, v_validated_branch, v_validated_replacement);
  execute v_function;
end;
$migration$;

comment on function public.get_client_portal_shipment_detail_v2(uuid) is
  'Returns an authorized shipment detail whose timeline preserves received and validated events from every POD version.';
