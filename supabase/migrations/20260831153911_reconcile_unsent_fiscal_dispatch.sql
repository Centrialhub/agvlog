-- A service-only audited decision can resume a proven local non-send exactly once.
-- The browser has no INSERT/UPDATE/DELETE privileges on this ledger.
alter table public.hub_fiscal_emissions add column dispatch_reconciliation jsonb;
comment on column public.hub_fiscal_emissions.dispatch_reconciliation is 'Service-side evidence of verified local non-send, payload binding and single-use resume authorization. Never auto-populate from timeout or empty lookup alone.';

create or replace function public.claim_hub_fiscal_emission(_tenant uuid,_actor uuid,_emitter uuid,_type text,_environment text,_body jsonb,
 _fiscal_id uuid default null,_cte_id uuid default null,_nfse_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare k text; e public.hub_fiscal_emissions%rowtype; eid uuid:=gen_random_uuid(); request jsonb; local_id uuid; scoped_cnpj text; source uuid; source_ids uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 if _environment is null or _environment not in('sandbox','homologation','production') or _type not in('cte','nfse','mdfe','nfe','nfce','nfcom') then raise exception 'fiscal_environment_or_type_invalid';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active and role in('owner','admin','operator') for share;
 if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
 select regexp_replace(cnpj,'[^0-9]','','g') into scoped_cnpj from public.tenant_emitters where tenant_id=_tenant and id=_emitter and active;
 if scoped_cnpj is null or scoped_cnpj is distinct from regexp_replace(_body->>'emitterCnpj','[^0-9]','','g') then raise exception 'fiscal_emitter_invalid';end if;
 if num_nonnulls(_fiscal_id,_cte_id,_nfse_id)>1 then raise exception 'fiscal_link_ambiguous';end if;
 if _fiscal_id is not null and not exists(select 1 from public.fiscal_documents where tenant_id=_tenant and id=_fiscal_id and emitter_id=_emitter and document_type='outbound' and deleted_at is null) then raise exception 'fiscal_document_invalid';end if;
 if _cte_id is not null and (_type<>'cte' or not exists(select 1 from public.cte_documents where tenant_id=_tenant and id=_cte_id and emitter_id=_emitter)) then raise exception 'fiscal_document_invalid';end if;
 if _nfse_id is not null and (_type<>'nfse' or not exists(select 1 from public.nfse_documents where tenant_id=_tenant and id=_nfse_id and emitter_id=_emitter and not cancelled and not is_preview)) then raise exception 'fiscal_document_invalid';end if;
 local_id:=coalesce(_fiscal_id,_cte_id,_nfse_id);
 k:=_type||':'||_environment||':'||_emitter||':'||coalesce(local_id::text,nullif(_body->>'externalId',''),nullif(_body->>'idIntegracao',''));
 if k is null or length(k)>500 then raise exception 'fiscal_identity_required';end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text||k,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and
  (dispatch_key=k or (local_id is not null and (fiscal_document_id=_fiscal_id or cte_document_id=_cte_id or nfse_document_id=_nfse_id)))
  order by created_at desc,id desc limit 1 for update;
 if found then
  if e.environment is distinct from _environment or e.emitter_id is distinct from _emitter or e.doc_type is distinct from _type then raise exception 'fiscal_existing_environment_mismatch';end if;
  -- Explicit service-side reconciliation only. Never infer this from a timeout,
  -- elapsed time or a provider query alone. Preserve the identity and audit evidence.
  if e.status='pending' and e.dispatch_state='uncertain' and e.hub_document_id is null
   and e.last_response->'error'->>'code'='TRANSPORT_UNCERTAIN'
   and e.dispatch_reconciliation->>'resolution'='confirmed_not_sent_local_configuration'
   and e.dispatch_reconciliation->>'resume_authorized'='true'
   and e.dispatch_reconciliation->>'operator_confirmed_provider_absence'='true'
   and e.dispatch_reconciliation->'preflight'->>'baseConfigured'='false'
   and e.dispatch_reconciliation->'provider_lookup'->>'httpStatus'='200'
   and e.dispatch_reconciliation->'provider_lookup'->>'providerSuccess'='true'
   and e.dispatch_reconciliation->'provider_lookup'->>'recordsReturned'='0'
   and e.dispatch_reconciliation->>'payload_md5'=md5(e.request_payload::text)
   and e.id_integracao='agvlog-'||e.id::text and e.request_payload->>'idIntegracao'=e.id_integracao then
   update public.hub_fiscal_emissions set dispatch_state='in_flight',
    dispatch_reconciliation=dispatch_reconciliation||jsonb_build_object('resume_authorized',false,'resumed_at',clock_timestamp()),
    updated_at=clock_timestamp() where id=e.id returning * into e;
   return jsonb_build_object('dispatch',true,'emission',to_jsonb(e));
  end if;
  -- Definitive rejected + changed payload allows correction. An unknown/error result never does.
  if not(e.status in('rejected','rejeitado') and e.hub_document_id is not null and e.dispatch_state='recorded'
    and ((e.request_payload->'payload')-'idIntegracao') is distinct from ((_body->'payload')-'idIntegracao')) then
   return jsonb_build_object('dispatch',false,'emission',to_jsonb(e));
  end if;
 end if;
 if _type='cte' and _fiscal_id is not null and not exists(select 1 from public.fiscal_source_reservations where tenant_id=_tenant and outbound_id=_fiscal_id and environment=_environment) then raise exception 'fiscal_preparation_required';end if;
 if _nfse_id is not null then
  select array(select distinct x from unnest(fiscal_document_ids) x order by x) into source_ids from public.nfse_documents where id=_nfse_id and tenant_id=_tenant for update;
  if cardinality(source_ids)>500 then raise exception 'fiscal_too_many_sources';end if;
  foreach source in array coalesce(source_ids,'{}'::uuid[]) loop
   perform 1 from public.fiscal_documents where tenant_id=_tenant and id=source and document_type='inbound' and deleted_at is null for update;
   if not found then raise exception 'fiscal_source_invalid';end if;
   if exists(select 1 from public.fiscal_source_reservations where tenant_id=_tenant and environment=_environment and source_id=source and nfse_id is distinct from _nfse_id) then raise exception 'fiscal_sources_reserved';end if;
   if exists(select 1 from public.fiscal_documents where id=source and (cte_emitted_at is not null or (nfse_emitted_document_id is not null and nfse_emitted_document_id<>_nfse_id))) then raise exception 'fiscal_source_already_issued';end if;
   insert into public.fiscal_source_reservations(tenant_id,environment,source_id,nfse_id) values(_tenant,_environment,source,_nfse_id) on conflict do nothing;
  end loop;
 end if;
 request:=_body||jsonb_build_object('externalId','agvlog-'||eid,'idIntegracao','agvlog-'||eid);
 request:=jsonb_set(request,'{payload}',coalesce(request->'payload','{}')||jsonb_build_object('idIntegracao','agvlog-'||eid));
 if _type='nfse' then request:=jsonb_set(request,'{payload,ambiente}',to_jsonb(case when _environment='production' then 'producao' else 'homologacao' end));end if;
 insert into public.hub_fiscal_emissions(id,tenant_id,emitter_id,doc_type,environment,emitter_cnpj,external_id,id_integracao,status,
  dispatch_key,dispatch_state,fiscal_document_id,cte_document_id,nfse_document_id,request_payload,created_by,created_at)
 values(eid,_tenant,_emitter,_type,_environment,scoped_cnpj,'agvlog-'||eid,'agvlog-'||eid,'pending',k,'in_flight',_fiscal_id,_cte_id,_nfse_id,request,_actor,clock_timestamp())
 returning * into e;
 if _nfse_id is not null then update public.nfse_documents set status='submitted',provider='hub_fiscal' where id=_nfse_id and tenant_id=_tenant;end if;
 return jsonb_build_object('dispatch',true,'emission',to_jsonb(e));
end;$fn$;
revoke all on function public.claim_hub_fiscal_emission(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_hub_fiscal_emission(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid) to service_role;
