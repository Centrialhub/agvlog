-- Number allocation in the upstream provider must never receive concurrent CT-e requests.
create or replace function public.assert_cte_dispatch_idle(_tenant uuid,_emitter uuid,_environment text,_except uuid default null)
returns void language plpgsql security invoker set search_path='' as $fn$
declare busy uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 select id into busy from public.hub_fiscal_emissions where tenant_id=_tenant and emitter_id=_emitter
  and environment=_environment and doc_type='cte' and dispatch_key is not null
  and (_except is null or id<>_except)
  and (dispatch_state in('in_flight','uncertain') or (dispatch_state='recorded' and status in('pending','processing','transmitting','submitted','queued')))
  order by created_at,id limit 1;
 if busy is not null then raise exception 'fiscal_emitter_busy: CT-e pendente no emitente; concilie a operação % antes de emitir outro documento. Nenhum novo CT-e foi enviado.',busy;end if;
end;$fn$;
revoke all on function public.assert_cte_dispatch_idle(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.assert_cte_dispatch_idle(uuid,uuid,text,uuid) to service_role;

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
   if _type='cte' then perform public.assert_cte_dispatch_idle(_tenant,_emitter,_environment,e.id);end if;
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
 if _type='cte' then perform public.assert_cte_dispatch_idle(_tenant,_emitter,_environment,null);end if;
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

create or replace function public.complete_hub_fiscal_emission(_tenant uuid,_emission uuid,_response jsonb,_http_status integer)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare e public.hub_fiscal_emissions%rowtype; d jsonb; s text; local_status text; provider_rejection boolean; sync_authorization text[]; invalid_receipt boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and id=_emission for update;
 if not found then raise exception 'fiscal_emission_not_found';end if;
 d:=coalesce(_response->'document','{}');
 s:=lower(coalesce(d->>'status',d->>'plugnotasStatus',''));
 -- ManagerSaaS reports a fiscal rejection as error/EXCEPTION, with a typed rejection class.
 -- A generic error, timeout or unrecognized state is not a processing confirmation.
 provider_rejection:=e.doc_type='cte' and s in('error','erro','rejected','rejeitado') and (
  d#>>'{raw_response_json,managersaas,parsed,exceptionClass}'='EspdManCTeRejeicaoEnvioException'
  or _response#>>'{error,details,csv,classe}'='EspdManCTeRejeicaoEnvioException');
 s:=case when provider_rejection then 'rejected' when s in('authorized','autorizado','issued','concluido') then 'authorized' when s in('rejected','rejeitado') then 'rejected'
  when s in('cancelled','canceled','cancelado') then 'cancelled'
  when s in('processing','queued','submitted','pending','transmitting') then 'processing' else null end;
 if e.hub_document_id is not null and nullif(d->>'id','') is not null and e.hub_document_id is distinct from d->>'id' then raise exception 'fiscal_provider_identity_mismatch';end if;
 invalid_receipt:=s is null or nullif(d->>'id','') is null or
  ((_http_status>=400 or _response->>'success'='false' or (_response->'error' is not null and _response->'error'<>'null'::jsonb))
   and not coalesce(provider_rejection and d->>'idIntegracao'=e.id_integracao
    and d->>'environment'=e.environment and d->>'emitterCnpj'=e.emitter_cnpj,false));
 -- A committed terminal receipt outranks a late processing response or transport error.
 -- Keep its protocol, number, message, source flags and audit response together.
 if e.dispatch_state='recorded' and e.status in('authorized','rejected','cancelled') and (
  coalesce(invalid_receipt,false) or e.status='cancelled'
  or (e.status='authorized' and s not in('authorized','cancelled'))
  or (e.status='rejected' and s='processing')) then
  return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',e.status,'ignored',true);
 end if;
 if invalid_receipt then
  update public.hub_fiscal_emissions set dispatch_state='uncertain',last_response=_response,updated_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('confirmed',false,'emission_id',e.id);
 end if;
 -- Do not confuse the initial ManagerSaaS batch number with the authorization protocol.
 if e.doc_type='cte' and s='authorized' and coalesce(d->>'authorizationProtocol','') !~ '^[0-9]{15}$' then
  sync_authorization:=regexp_match(d#>>'{raw_response_json,managersaas_sync,raw}',
   '^([0-9]{44}),AUTORIZADA,100,([^,]*),([0-9]{15}),([0-9]+),([0-9]+)$');
  if sync_authorization[1]=d->>'accessKey' and sync_authorization[4]=d->>'number' and sync_authorization[5]=d->>'series' then
   d:=jsonb_set(d,'{authorizationProtocol}',to_jsonb(sync_authorization[3]));
  end if;
 end if;
 -- A later authorized response may still carry the original batch placeholder.
 if e.doc_type='cte' and s='authorized' and e.authorization_protocol ~ '^[0-9]{15}$'
  and coalesce(d->>'authorizationProtocol','') !~ '^[0-9]{15}$' then
  d:=jsonb_set(d,'{authorizationProtocol}',to_jsonb(e.authorization_protocol));
 end if;
 -- Late HTTP responses must not overwrite a terminal callback.
 if e.status='cancelled' or (e.status='authorized' and s<>'cancelled') or (e.status='rejected' and s='processing') then s:=e.status;end if;
 update public.hub_fiscal_emissions set dispatch_state='recorded',hub_document_id=d->>'id',status=s,
  access_key=coalesce(nullif(d->>'accessKey',''),access_key),authorization_protocol=coalesce(d->>'authorizationProtocol',d->>'plugnotasProtocol',authorization_protocol),
  plugnotas_id=coalesce(d->>'plugnotasId',plugnotas_id),c_stat=case when d->>'cStat' ~ '^[0-9]{1,6}$' then (d->>'cStat')::integer else c_stat end,
  number=coalesce(d->>'number',number),series=coalesce(d->>'series',series),message=coalesce(d->>'message',message),
  pdf_url=coalesce(d->>'pdfUrl',pdf_url),xml_url=coalesce(d->>'xmlUrl',xml_url),last_response=_response,updated_at=clock_timestamp()
 where id=e.id returning * into e;
 local_status:=case s when 'authorized' then 'authorized' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled' else 'transmitting' end;
 if e.fiscal_document_id is not null then
  update public.fiscal_documents set hub_document_id=e.hub_document_id,emission_id=e.id,status=local_status,sefaz_status=s,
   access_key=coalesce(e.access_key,access_key),sefaz_protocol=coalesce(e.authorization_protocol,sefaz_protocol),sefaz_message=e.message
   where tenant_id=_tenant and id=e.fiscal_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  -- Homologation has reservations, but must not consume production source flags.
  if e.doc_type='cte' and e.environment='production' then
   update public.fiscal_documents set cte_emitted_at=case when s in('rejected','cancelled') then null else clock_timestamp() end,
    cte_emitted_outbound_id=case when s in('rejected','cancelled') then null else e.fiscal_document_id end
   where tenant_id=_tenant and id in(select source_id from public.fiscal_source_reservations where tenant_id=_tenant and environment=e.environment and outbound_id=e.fiscal_document_id);
  end if;
 end if;
 if e.cte_document_id is not null then
  update public.cte_documents set status=local_status,sefaz_status=s,sefaz_environment=e.environment,access_key=e.access_key,
   protocol_number=e.authorization_protocol,cte_number=e.number,cte_series=e.series,pdf_url=e.pdf_url,xml_url=e.xml_url
   where tenant_id=_tenant and id=e.cte_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
 end if;
 if e.nfse_document_id is not null then
  update public.nfse_documents set status=case when s='authorized' then 'issued' when s='processing' then 'submitted' else s end,
   cancelled=(s='cancelled'),cancellation_date=case when s='cancelled' then coalesce(cancellation_date,clock_timestamp()) else cancellation_date end,
   provider='hub_fiscal',protocol_number=e.authorization_protocol,nfse_number=e.number,verification_code=e.access_key,
   pdf_url=e.pdf_url,xml_url=e.xml_url,authorization_date=case when s='authorized' then coalesce(authorization_date,clock_timestamp()) else authorization_date end,
   rejection_messages=case when s='rejected' then jsonb_build_object('message',e.message) else null end
   where tenant_id=_tenant and id=e.nfse_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  if e.environment='production' then
   update public.fiscal_documents set nfse_emitted_at=case when s in('rejected','cancelled') then null else clock_timestamp() end,
    nfse_emitted_document_id=case when s in('rejected','cancelled') then null else e.nfse_document_id end
   where tenant_id=_tenant and id in(select source_id from public.fiscal_source_reservations where tenant_id=_tenant and environment=e.environment and nfse_id=e.nfse_document_id);
  end if;
  if s in('rejected','cancelled') then delete from public.fiscal_source_reservations where tenant_id=_tenant and nfse_id=e.nfse_document_id;end if;
 end if;
 return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',s);
end;$fn$;
revoke all on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) to service_role;
