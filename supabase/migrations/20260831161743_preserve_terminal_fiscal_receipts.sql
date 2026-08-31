-- Preserve terminal fiscal evidence for both CT-e and NFS-e.
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
 provider_rejection:=e.doc_type='cte' and s in('error','erro') and (
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

-- Atomically terminalize an exhausted fiscal poll and create/update its
-- reconciliation queue entry. Only Edge Functions using service_role may call
-- this RPC; browser users retain read-only access to the queue through RLS.
CREATE OR REPLACE FUNCTION public.terminalize_fiscal_poll_v1(
  p_tenant_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_document_number text,
  p_reason_code text,
  p_attempt_count integer,
  p_first_seen_at timestamptz,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_message text;
  v_status text;
  v_durable boolean;
BEGIN
  IF p_document_kind NOT IN ('cte', 'nfse') THEN RAISE EXCEPTION 'invalid_document_kind'; END IF;
  IF p_reason_code NOT IN (
    'missing_provider_reference', 'provider_unavailable',
    'provider_rate_limited', 'status_timeout'
  ) THEN RAISE EXCEPTION 'invalid_reason_code'; END IF;
  IF p_attempt_count < 1 THEN RAISE EXCEPTION 'invalid_attempt_count'; END IF;

  -- Serialize against callbacks and dispatch reconciliation before deciding on timeout.
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal:'||p_tenant_id::text,0));
  IF p_document_kind='cte' THEN
    SELECT status INTO v_status FROM public.fiscal_documents WHERE tenant_id=p_tenant_id AND id=p_document_id FOR UPDATE;
  ELSE
    SELECT status INTO v_status FROM public.nfse_documents WHERE tenant_id=p_tenant_id AND id=p_document_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal_document_not_found'; END IF;
  IF v_status IN ('authorized','issued','confirmed','rejected','cancelled') THEN
    RETURN jsonb_build_object('document_id',p_document_id,'status',v_status,'queued_for_reconciliation',false);
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.hub_fiscal_emissions e WHERE e.tenant_id=p_tenant_id AND e.dispatch_key IS NOT NULL
    AND ((p_document_kind='cte' AND e.fiscal_document_id=p_document_id) OR (p_document_kind='nfse' AND e.nfse_document_id=p_document_id))) INTO v_durable;

  v_message := CASE p_reason_code
    WHEN 'missing_provider_reference' THEN 'Emissão sem identificador no provedor; encaminhada para reconciliação.'
    WHEN 'provider_rate_limited' THEN 'Provedor limitou as consultas além do prazo; encaminhado para reconciliação.'
    WHEN 'provider_unavailable' THEN 'Provedor indisponível além do prazo; encaminhado para reconciliação.'
    ELSE 'O provedor não concluiu o processamento em até 15 minutos.'
  END;

  IF p_document_kind = 'cte' THEN
    UPDATE public.fiscal_documents
    SET status = CASE WHEN v_durable THEN status ELSE 'error' END,
        sefaz_status = 'status_timeout',
        sefaz_message = v_message,
        last_status_check_at = now(),
        status_check_attempts = p_attempt_count,
        last_status_response = COALESCE(p_context, '{}'::jsonb)
    WHERE id = p_document_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.nfse_documents
    SET status = CASE WHEN v_durable THEN status ELSE 'error' END,
        rejection_messages = jsonb_build_object(
          'code', upper(p_reason_code),
          'message', v_message
        ),
        last_status_check_at = now(),
        status_check_attempts = p_attempt_count,
        last_status_response = COALESCE(p_context, '{}'::jsonb)
    WHERE id = p_document_id AND tenant_id = p_tenant_id;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal_document_not_found'; END IF;

  INSERT INTO public.fiscal_poll_dead_letters (
    tenant_id, document_kind, document_id, document_number, reason_code,
    attempt_count, first_seen_at, last_attempt_at, context, updated_at
  ) VALUES (
    p_tenant_id, p_document_kind, p_document_id, NULLIF(btrim(p_document_number), ''),
    p_reason_code, p_attempt_count, p_first_seen_at, now(),
    COALESCE(p_context, '{}'::jsonb), now()
  )
  ON CONFLICT (document_kind, document_id) WHERE status = 'open'
  DO UPDATE SET
    reason_code = EXCLUDED.reason_code,
    attempt_count = GREATEST(public.fiscal_poll_dead_letters.attempt_count, EXCLUDED.attempt_count),
    last_attempt_at = EXCLUDED.last_attempt_at,
    context = EXCLUDED.context,
    updated_at = now();

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'document_kind', p_document_kind,
    'status', CASE WHEN v_durable THEN v_status ELSE 'error' END,
    'queued_for_reconciliation', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.terminalize_fiscal_poll_v1(
  uuid, text, uuid, text, text, integer, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminalize_fiscal_poll_v1(
  uuid, text, uuid, text, text, integer, timestamptz, jsonb
) TO service_role;

