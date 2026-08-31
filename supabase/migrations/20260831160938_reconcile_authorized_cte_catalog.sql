-- Preserve legacy values and admit the explicit fiscal states used by the service-owned mirror.
alter table public.cte_batches drop constraint cte_batches_source_type_check;
alter table public.cte_batches add constraint cte_batches_source_type_check check(source_type in('period','loads','fiscal_documents'));
alter table public.cte_documents drop constraint cte_documents_status_check;
alter table public.cte_documents add constraint cte_documents_status_check check(status in('draft','issued','cancelled','authorized','transmitting','rejected'));

create or replace function public.mirror_hub_cte_for_billing() returns trigger language plpgsql security definer set search_path='' as $fn$
declare e public.hub_fiscal_emissions%rowtype; ids uuid[]; cargo numeric; v_status text;
begin
 if new.document_type<>'outbound' then return new;end if;
 select * into e from public.hub_fiscal_emissions where tenant_id=new.tenant_id and fiscal_document_id=new.id and doc_type='cte'
  order by created_at desc,id desc limit 1;
 if not found then return new;end if;
 select array_agg(source_id order by source_id) into ids from public.fiscal_source_reservations where tenant_id=new.tenant_id and outbound_id=new.id and environment=e.environment;
 if cardinality(ids) is null then return new;end if;
 v_status:=case when new.status in('authorized','confirmed') then 'authorized' when new.status in('cancelled','rejected') then new.status else 'transmitting' end;
 if v_status='authorized' and e.status='authorized' then
  select coalesce(sum(value),0) into cargo from public.fiscal_documents where tenant_id=new.tenant_id and id=any(ids);
  insert into public.cte_batches(id,tenant_id,client_id,grouping_mode,grouping_mode_label,source_type,fiscal_document_ids,
   total_documents,total_value,total_freight,status,created_by,emitter_id)
  values(new.id,new.tenant_id,new.client_id,1,'CT-e Hub','fiscal_documents',ids,cardinality(ids),cargo,new.freight_value,'generated',new.created_by,new.emitter_id)
  on conflict(id) do nothing;
  insert into public.cte_documents(id,tenant_id,batch_id,client_id,cte_number,cte_series,remitter,recipient,recipient_city,recipient_state,
   fiscal_document_ids,invoice_count,pallet_count,weight_kg,cargo_value,freight_value,net_value,status,sefaz_status,sefaz_environment,issued_at,
   access_key,protocol_number,emitter_id,created_by,pdf_url,xml_url)
  values(new.id,new.tenant_id,new.id,new.client_id,e.number,e.series,new.remitter,new.recipient,new.recipient_city,new.recipient_state,
   ids,cardinality(ids),coalesce(new.pallet_count,0),coalesce(new.weight_kg,0),cargo,new.freight_value,new.freight_value,
   'authorized','authorized',e.environment,clock_timestamp(),e.access_key,e.authorization_protocol,new.emitter_id,new.created_by,e.pdf_url,e.xml_url)
  on conflict(id) do nothing;
 end if;
 update public.cte_documents set status=v_status,sefaz_status=v_status,sefaz_environment=e.environment,
  access_key=coalesce(e.access_key,access_key),protocol_number=coalesce(e.authorization_protocol,protocol_number),
  cte_number=coalesce(e.number,cte_number),pdf_url=coalesce(e.pdf_url,pdf_url),xml_url=coalesce(e.xml_url,xml_url),
  cancelled_at=case when v_status='cancelled' then coalesce(cancelled_at,clock_timestamp()) else cancelled_at end
 where tenant_id=new.tenant_id and id=new.id;
 return new;
end;$fn$;
revoke all on function public.mirror_hub_cte_for_billing() from public,anon,authenticated,service_role;

create or replace function public.complete_hub_fiscal_emission(_tenant uuid,_emission uuid,_response jsonb,_http_status integer)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare e public.hub_fiscal_emissions%rowtype; d jsonb; s text; local_status text; provider_rejection boolean; sync_authorization text[];
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and id=_emission for update;
 if not found then raise exception 'fiscal_emission_not_found';end if;
 d:=coalesce(_response->'document','{}');
 s:=lower(coalesce(d->>'status',d->>'plugnotasStatus',''));
 -- ManagerSaaS reports a fiscal rejection as error/EXCEPTION, with a typed rejection class.
 -- A generic error, timeout or unrecognized state is not a processing confirmation.
 provider_rejection:=e.doc_type='cte' and s in('error','erro') and (
  d#>>'{raw_response_json,managersaas,parsed,exceptionClass}'='EspdManCTeRejeicaoEnvioException'
  or _response#>>'{error,details,csv,classe}'='EspdManCTeRejeicaoEnvioException');
 s:=case when provider_rejection then 'rejected' when s in('authorized','autorizado','issued','concluido') then 'authorized' when s in('rejected','rejeitado') then 'rejected'
  when s in('cancelled','canceled','cancelado') then 'cancelled'
  when s in('processing','queued','submitted','pending','transmitting') then 'processing' else null end;
 if e.hub_document_id is not null and nullif(d->>'id','') is not null and e.hub_document_id is distinct from d->>'id' then raise exception 'fiscal_provider_identity_mismatch';end if;
 if s is null or nullif(d->>'id','') is null or
  ((_http_status>=400 or _response->>'success'='false' or (_response->'error' is not null and _response->'error'<>'null'::jsonb))
   and not coalesce(provider_rejection and d->>'idIntegracao'=e.id_integracao
    and d->>'environment'=e.environment and d->>'emitterCnpj'=e.emitter_cnpj,false)) then
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
