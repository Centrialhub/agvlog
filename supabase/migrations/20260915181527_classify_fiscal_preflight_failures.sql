-- Classify Hub preflight validation failures as definitive local rejections.
-- The provider did not create a fiscal document, so these responses must release
-- the serialized lane. Transport and unknown provider failures still fail closed.
create or replace function public.fiscal_preflight_failure_is_definitive(_doc_type text,_response jsonb)
returns boolean language sql immutable security invoker set search_path='' as $fn$
 select coalesce(_response->>'success','')='false'
  and coalesce(_response#>>'{error,category}','')='validation'
  and coalesce(_response#>>'{error,retryable}','')='false'
  and case _doc_type
   when 'cte' then _response#>>'{error,code}'='CTE_PREFLIGHT_FAILED'
   when 'mdfe' then _response#>>'{error,code}'='MDFE_PREFLIGHT_FAILED'
   else false
  end
$fn$;
revoke all on function public.fiscal_preflight_failure_is_definitive(text,jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_preflight_failure_is_definitive(text,jsonb) to service_role;

-- Reject an incomplete CT-e destination before a durable dispatch intent exists.
-- This is a server-side barrier for stale browser bundles.
create or replace function public.tg_validate_cte_dispatch_request()
returns trigger language plpgsql security invoker set search_path='' as $fn$
declare payload jsonb; address jsonb; missing text[]:='{}';
begin
 if new.doc_type<>'cte' or new.dispatch_key is null then return new;end if;
 payload:=case when jsonb_typeof(new.request_payload->'payload')='object' then new.request_payload->'payload' else new.request_payload end;
 address:=payload#>'{destinatario,endereco}';
 if nullif(btrim(coalesce(address->>'logradouro','')),'') is null then missing:=array_append(missing,'logradouro');end if;
 if nullif(btrim(coalesce(address->>'numero','')),'') is null then missing:=array_append(missing,'numero');end if;
 if nullif(btrim(coalesce(address->>'bairro','')),'') is null then missing:=array_append(missing,'bairro');end if;
 if length(regexp_replace(coalesce(address->>'cep',''),'[^0-9]','','g'))<>8 then missing:=array_append(missing,'cep');end if;
 if cardinality(missing)>0 then
  raise exception 'cte_destination_address_incomplete: %',array_to_string(missing,', ') using errcode='22023';
 end if;
 return new;
end;$fn$;
revoke all on function public.tg_validate_cte_dispatch_request() from public,anon,authenticated;
drop trigger if exists validate_cte_dispatch_request on public.hub_fiscal_emissions;
create trigger validate_cte_dispatch_request before insert on public.hub_fiscal_emissions
for each row execute function public.tg_validate_cte_dispatch_request();

create or replace function public.complete_hub_fiscal_emission(_tenant uuid,_emission uuid,_response jsonb,_http_status integer)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 e public.hub_fiscal_emissions%rowtype; d jsonb; raw_status text; s text; local_status text;
 provider_rejection boolean; local_preflight_failure boolean; sync_authorization text[]; invalid_receipt boolean;
 incoming_version bigint; incoming_occurred_at timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and id=_emission for update;
 if not found then raise exception 'fiscal_emission_not_found';end if;
 d:=coalesce(_response->'document','{}');
 raw_status:=lower(coalesce(d->>'status',d->>'plugnotasStatus',''));
 provider_rejection:=e.doc_type='cte' and raw_status in('error','erro','rejected','rejeitado') and (
  d#>>'{raw_response_json,managersaas,parsed,exceptionClass}'='EspdManCTeRejeicaoEnvioException'
  or _response#>>'{error,details,csv,classe}'='EspdManCTeRejeicaoEnvioException');
 local_preflight_failure:=e.hub_document_id is null and nullif(d->>'id','') is null
  and public.fiscal_preflight_failure_is_definitive(e.doc_type,_response);
 s:=case
  when local_preflight_failure or provider_rejection then 'rejected'
  when raw_status in('authorized','autorizado','issued','concluido','concluído','emitida') then 'authorized'
  when raw_status in('rejected','rejeitado','rejeitada') then 'rejected'
  when raw_status in('denied','denegado','denegada') then 'denied'
  when raw_status in('cancelled','canceled','cancelado','cancelada') then 'cancelled'
  when raw_status in('processing','queued','submitted','pending','transmitting','processando') then 'processing'
  when raw_status in('draft','rascunho') then 'draft'
  when raw_status='provider_unknown' then 'provider_unknown'
  when raw_status in('cancel_processing','cancelling','cancelando') then 'cancel_processing'
  when raw_status in('cancel_rejected','cancelamento_rejeitado') then 'cancel_rejected'
  when raw_status in('inutilized','inutilizada','inutilizado') then 'inutilized'
  when raw_status in('interrupted','interrompido','interrompida') then 'interrupted'
  when raw_status in('error','erro','failed') then 'error'
  else null end;
 if e.hub_document_id is not null and nullif(d->>'id','') is not null and e.hub_document_id is distinct from d->>'id' then raise exception 'fiscal_provider_identity_mismatch';end if;
 begin incoming_version:=nullif(_response->>'documentVersion','')::bigint;exception when invalid_text_representation or numeric_value_out_of_range then incoming_version:=null;end;
 begin incoming_occurred_at:=nullif(_response->>'occurredAt','')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then incoming_occurred_at:=null;end;
 if incoming_version is not null and e.provider_document_version is not null and incoming_version<=e.provider_document_version then
  return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',e.status,'ignored',true,'reason','out_of_order');
 end if;
 invalid_receipt:=not local_preflight_failure and (s is null or nullif(d->>'id','') is null or
  ((_http_status>=400 or _response->>'success'='false' or (_response->'error' is not null and _response->'error'<>'null'::jsonb))
   and not coalesce(provider_rejection and d->>'idIntegracao'=e.id_integracao
    and d->>'environment'=e.environment and d->>'emitterCnpj'=e.emitter_cnpj,false)));
 if e.dispatch_state='recorded' and e.status in('authorized','rejected','denied','cancelled','inutilized','cancel_rejected') and (
  coalesce(invalid_receipt,false) or e.status='cancelled'
  or (e.status='authorized' and s not in('authorized','cancel_processing','cancel_rejected','cancelled'))
  or (e.status in('rejected','denied','inutilized') and s in('pending','draft','processing','provider_unknown'))
  or (e.status='cancel_rejected' and s in('pending','draft','processing','provider_unknown'))
  or (e.status='cancel_processing' and s in('pending','draft','processing','provider_unknown'))
 ) then
  return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',e.status,'ignored',true,'reason','non_monotonic');
 end if;
 if invalid_receipt then
  update public.hub_fiscal_emissions set dispatch_state='uncertain',last_response=_response,updated_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('confirmed',false,'emission_id',e.id);
 end if;
 if e.doc_type='cte' and s='authorized' and coalesce(d->>'authorizationProtocol','') !~ '^[0-9]{15}$' then
  sync_authorization:=regexp_match(d#>>'{raw_response_json,managersaas_sync,raw}',
   '^([0-9]{44}),AUTORIZADA,100,([^,]*),([0-9]{15}),([0-9]+),([0-9]+)$');
  if sync_authorization[1]=d->>'accessKey' and sync_authorization[4]=d->>'number' and sync_authorization[5]=d->>'series' then
   d:=jsonb_set(d,'{authorizationProtocol}',to_jsonb(sync_authorization[3]));
  end if;
 end if;
 if e.doc_type='cte' and s='authorized' and e.authorization_protocol ~ '^[0-9]{15}$'
  and coalesce(d->>'authorizationProtocol','') !~ '^[0-9]{15}$' then d:=jsonb_set(d,'{authorizationProtocol}',to_jsonb(e.authorization_protocol));end if;
 update public.hub_fiscal_emissions set
  dispatch_state=case when s in('provider_unknown','interrupted','error') then 'uncertain' else 'recorded' end,
  hub_document_id=coalesce(nullif(d->>'id',''),hub_document_id),status=s,
  access_key=coalesce(nullif(d->>'accessKey',''),access_key),authorization_protocol=coalesce(d->>'authorizationProtocol',d->>'plugnotasProtocol',authorization_protocol),
  plugnotas_id=coalesce(d->>'plugnotasId',plugnotas_id),c_stat=case when d->>'cStat' ~ '^[0-9]{1,6}$' then (d->>'cStat')::integer else c_stat end,
  number=coalesce(d->>'number',number),series=coalesce(d->>'series',series),message=coalesce(d->>'message',_response#>>'{error,message}',message),
  pdf_url=coalesce(d->>'pdfUrl',pdf_url),xml_url=coalesce(d->>'xmlUrl',xml_url),last_response=_response,
  provider_document_version=coalesce(incoming_version,provider_document_version),provider_occurred_at=coalesce(incoming_occurred_at,provider_occurred_at),
  provider_effect_id=coalesce(nullif(_response->>'effectId',''),provider_effect_id),updated_at=clock_timestamp()
 where id=e.id returning * into e;
 local_status:=case when s='authorized' then 'authorized' when s in('rejected','denied','inutilized') then 'rejected'
  when s='cancelled' then 'cancelled' when s='cancel_rejected' then 'authorized' else 'transmitting' end;
 if e.fiscal_document_id is not null then
  update public.fiscal_documents set hub_document_id=e.hub_document_id,emission_id=e.id,status=local_status,sefaz_status=s,
   access_key=coalesce(e.access_key,access_key),sefaz_protocol=coalesce(e.authorization_protocol,sefaz_protocol),sefaz_message=e.message
   where tenant_id=_tenant and id=e.fiscal_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  if e.doc_type='cte' and e.environment='production' then
   update public.fiscal_documents set cte_emitted_at=case when s in('rejected','denied','cancelled','inutilized') then null else clock_timestamp() end,
    cte_emitted_outbound_id=case when s in('rejected','denied','cancelled','inutilized') then null else e.fiscal_document_id end
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
  update public.nfse_documents set status=case when s='authorized' then 'issued' when s='cancel_rejected' then 'issued'
    when s in('processing','draft','provider_unknown','cancel_processing') then 'submitted' else s end,
   cancelled=(s='cancelled'),cancellation_date=case when s='cancelled' then coalesce(cancellation_date,clock_timestamp()) else cancellation_date end,
   provider='hub_fiscal',protocol_number=e.authorization_protocol,nfse_number=e.number,verification_code=e.access_key,
   pdf_url=e.pdf_url,xml_url=e.xml_url,authorization_date=case when s='authorized' then coalesce(authorization_date,clock_timestamp()) else authorization_date end,
   rejection_messages=case when s in('rejected','denied') then jsonb_build_object('message',e.message) else null end
   where tenant_id=_tenant and id=e.nfse_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  if e.environment='production' then
   update public.fiscal_documents set nfse_emitted_at=case when s in('rejected','denied','cancelled','inutilized') then null else clock_timestamp() end,
    nfse_emitted_document_id=case when s in('rejected','denied','cancelled','inutilized') then null else e.nfse_document_id end
   where tenant_id=_tenant and id in(select source_id from public.fiscal_source_reservations where tenant_id=_tenant and environment=e.environment and nfse_id=e.nfse_document_id);
  end if;
  if s in('rejected','denied','cancelled','inutilized') then delete from public.fiscal_source_reservations where tenant_id=_tenant and nfse_id=e.nfse_document_id;end if;
 end if;
 return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',s);
end;$fn$;
revoke all on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) to service_role;

-- Repair only the exact non-retryable validation responses covered above.
-- Generic HTTP/provider errors remain untouched and continue to fail closed.
do $repair$
declare item record;
begin
 for item in
  select tenant_id,id,last_response from public.hub_fiscal_emissions
  where hub_document_id is null and status='pending' and dispatch_state='uncertain'
   and public.fiscal_preflight_failure_is_definitive(doc_type,last_response)
 loop
  perform public.complete_hub_fiscal_emission(item.tenant_id,item.id,item.last_response,422);
 end loop;
end$repair$;
