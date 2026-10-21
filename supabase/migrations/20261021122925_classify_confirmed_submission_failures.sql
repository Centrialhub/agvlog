-- Explicit Hub terminal/non-submitted receipt. No data repair or outbound retry.
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create or replace function public.fiscal_submission_failure_is_definitive(_response jsonb)
returns boolean language sql immutable security invoker set search_path='' as $fn$
 select coalesce(
  _response @> '{"success":false,"processing":false,"terminal":true,"requiresReconciliation":false,"document":{"status":"error"},"error":{"code":"PROVIDER_SUBMISSION_BLOCKED","submissionOutcome":"not_submitted","automaticRetry":false}}'::jsonb
  and nullif(_response#>>'{document,id}','') is not null
  and nullif(_response#>>'{document,idIntegracao}','') is not null,
 false)
$fn$;
revoke all on function public.fiscal_submission_failure_is_definitive(jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_submission_failure_is_definitive(jsonb) to service_role;

create or replace function public.complete_hub_fiscal_emission(_tenant uuid,_emission uuid,_response jsonb,_http_status integer)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 e public.hub_fiscal_emissions%rowtype; d jsonb; raw_status text; s text; local_status text;
 provider_rejection boolean; local_preflight_failure boolean; submission_blocked boolean; sync_authorization text[]; invalid_receipt boolean;
 incoming_version bigint; incoming_occurred_at timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and id=_emission for update;
 if not found then raise exception 'fiscal_emission_not_found';end if;
 d:=coalesce(_response->'document','{}');
 raw_status:=lower(coalesce(d->>'status',d->>'plugnotasStatus',''));
 submission_blocked:=public.fiscal_submission_failure_is_definitive(_response)
  and d->>'idIntegracao'=e.id_integracao
  and coalesce(d->>'environment',e.environment)=e.environment
  and coalesce(d->>'emitterCnpj',e.emitter_cnpj)=e.emitter_cnpj
  and nullif(coalesce(d->>'accessKey',''),'') is null
  and nullif(coalesce(d->>'authorizationProtocol',''),'') is null
  and nullif(coalesce(e.access_key,''),'') is null
  and nullif(coalesce(e.authorization_protocol,''),'') is null;
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
   and not coalesce(submission_blocked or (s='rejected' and d->>'idIntegracao'=e.id_integracao
    and coalesce(d->>'environment',e.environment)=e.environment
    and coalesce(d->>'emitterCnpj',e.emitter_cnpj)=e.emitter_cnpj)
    or (s in('processing','provider_unknown') and _http_status=202 and d->>'idIntegracao'=e.id_integracao
    and coalesce(d->>'environment',e.environment)=e.environment
    and coalesce(d->>'emitterCnpj',e.emitter_cnpj)=e.emitter_cnpj) or (provider_rejection and d->>'idIntegracao'=e.id_integracao
    and d->>'environment'=e.environment and d->>'emitterCnpj'=e.emitter_cnpj),false)));
 if e.dispatch_state='recorded' and e.status in('authorized','rejected','denied','cancelled','inutilized','cancel_rejected','error') and (
  coalesce(invalid_receipt,false) or e.status='cancelled'
  or (e.status='error' and s='error' and not submission_blocked)
  or (e.status='authorized' and s not in('authorized','cancel_processing','cancel_rejected','cancelled'))
  or (e.status in('rejected','denied','inutilized','error') and s in('pending','draft','processing','provider_unknown'))
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
  dispatch_state=case when submission_blocked then 'recorded' when s in('provider_unknown','interrupted','error') then 'uncertain' else 'recorded' end,
  hub_document_id=coalesce(nullif(d->>'id',''),hub_document_id),status=s,
  access_key=coalesce(nullif(d->>'accessKey',''),access_key),authorization_protocol=coalesce(d->>'authorizationProtocol',d->>'plugnotasProtocol',authorization_protocol),
  plugnotas_id=coalesce(d->>'plugnotasId',plugnotas_id),c_stat=case when d->>'cStat' ~ '^[0-9]{1,6}$' then (d->>'cStat')::integer else c_stat end,
  number=coalesce(d->>'number',number),series=coalesce(d->>'series',series),message=coalesce(d->>'message',_response#>>'{error,message}',message),
  pdf_url=coalesce(d->>'pdfUrl',pdf_url),xml_url=coalesce(d->>'xmlUrl',xml_url),last_response=_response,
  provider_document_version=coalesce(incoming_version,provider_document_version),provider_occurred_at=coalesce(incoming_occurred_at,provider_occurred_at),
  provider_effect_id=coalesce(nullif(_response->>'effectId',''),provider_effect_id),updated_at=clock_timestamp()
 where id=e.id returning * into e;
 local_status:=case when s='authorized' then 'authorized' when s in('rejected','denied','inutilized') then 'rejected'
  when s='cancelled' then 'cancelled' when s='cancel_rejected' then 'authorized' when submission_blocked then 'error' else 'transmitting' end;
 if e.fiscal_document_id is not null then
  update public.fiscal_documents set hub_document_id=e.hub_document_id,emission_id=e.id,status=local_status,sefaz_status=s,
   access_key=coalesce(e.access_key,access_key),sefaz_protocol=coalesce(e.authorization_protocol,sefaz_protocol),sefaz_message=e.message
   where tenant_id=_tenant and id=e.fiscal_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  if e.doc_type='cte' and e.environment='production' then
   update public.fiscal_documents set cte_emitted_at=case when submission_blocked or s in('rejected','denied','cancelled','inutilized') then null else clock_timestamp() end,
    cte_emitted_outbound_id=case when submission_blocked or s in('rejected','denied','cancelled','inutilized') then null else e.fiscal_document_id end
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
   update public.fiscal_documents set nfse_emitted_at=case when submission_blocked or s in('rejected','denied','cancelled','inutilized') then null else clock_timestamp() end,
    nfse_emitted_document_id=case when submission_blocked or s in('rejected','denied','cancelled','inutilized') then null else e.nfse_document_id end
   where tenant_id=_tenant and id in(select source_id from public.fiscal_source_reservations where tenant_id=_tenant and environment=e.environment and nfse_id=e.nfse_document_id);
  end if;
  if submission_blocked or s in('rejected','denied','cancelled','inutilized') then delete from public.fiscal_source_reservations where tenant_id=_tenant and nfse_id=e.nfse_document_id;end if;
 end if;
 return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',s);
end;$fn$;
revoke all on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) to service_role;


-- Only a new user preparation creates another operation; replay of the old claim remains GET-only.
do $patch$
declare definition text; original text := $old$and status in('rejected','rejeitado','cancelled') and hub_document_id is not null and dispatch_state='recorded'$old$;
 replacement text := $new$and (status in('rejected','rejeitado','cancelled') or (status='error'
     and public.fiscal_submission_failure_is_definitive(last_response)))
    and hub_document_id is not null and dispatch_state='recorded'$new$;
begin
 definition:=pg_get_functiondef('public.prepare_cte_issue(uuid,uuid,text,uuid[],jsonb)'::regprocedure);
 if position(original in definition)=0 then raise exception 'prepare_cte_issue_contract_changed';end if;
 execute replace(definition,original,replacement);
end;$patch$;

-- Preserve the distinction in the local CT-e catalog as well as in the Hub receipt.
do $catalog$
declare expression text; definition text; original text := $old$when new.status in('cancelled','rejected') then new.status$old$;
begin
 select pg_get_expr(conbin,conrelid) into expression from pg_constraint
 where conrelid='public.cte_documents'::regclass and conname='cte_documents_status_check';
 if expression is null then raise exception 'cte_documents_status_contract_missing';end if;
 alter table public.cte_documents drop constraint cte_documents_status_check;
 execute 'alter table public.cte_documents add constraint cte_documents_status_check check (('||expression||') or status=''error'')';
 definition:=pg_get_functiondef('public.mirror_hub_cte_for_billing()'::regprocedure);
 if position(original in definition)=0 then raise exception 'mirror_hub_cte_status_contract_changed';end if;
 execute replace(definition,original,$new$when new.status in('cancelled','rejected','error') then new.status$new$);
end;$catalog$;
