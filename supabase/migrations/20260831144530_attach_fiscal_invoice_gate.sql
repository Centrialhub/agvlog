-- Attach fiscal proof only after the audited invoice lifecycle is installed.
-- The fiscal dispatch core can be deployed independently. This gate remains mandatory for the new invoice API.
alter function public._client_invoice_draft_snapshot(uuid,jsonb,boolean,uuid) rename to _client_invoice_draft_before_fiscal_gate;
create function public._client_invoice_draft_snapshot(_tenant uuid,_draft jsonb,_lock boolean default false,_exclude_invoice uuid default null)
 returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare result jsonb; charge jsonb; evidence jsonb:='[]'; emission public.hub_fiscal_emissions%rowtype; sid uuid; typ text;
begin
 result:=public._client_invoice_draft_before_fiscal_gate(_tenant,_draft,_lock,_exclude_invoice);
 for charge in select * from jsonb_array_elements(_draft->'charges') loop
  typ:=charge->>'source_type';sid:=(charge->>'source_id')::uuid;
  if typ in('cte_document','nfse_document') then
   -- Fiscal documents are already locked by the source snapshot.
   if not public.fiscal_source_is_billable(_tenant,typ,sid) then raise exception 'invoice_source_not_authorized_production' using errcode='23514';end if;
   select * into emission from public.hub_fiscal_emissions where tenant_id=_tenant and
    ((typ='cte_document' and (cte_document_id=sid or fiscal_document_id=sid)) or (typ='nfse_document' and nfse_document_id=sid))
    order by created_at desc,id desc limit 1;
   evidence:=evidence||jsonb_build_array(jsonb_build_object('source',sid,'emission',emission.id,'status',emission.status,'environment',emission.environment));
  end if;
 end loop;
 result:=result-'revision'||jsonb_build_object('fiscal_evidence',evidence);
 return result||jsonb_build_object('revision',md5(result::text));
end;$fn$;
revoke all on function public._client_invoice_draft_snapshot(uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
