set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  definition text;
  marker text := '  -- doccob_authoritative_bundle_check';
  validation text;
begin
  if to_regprocedure('public.register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,integer,numeric,integer,integer,text)') is null then
    raise exception 'DOCCOB registration dependency is missing';
  end if;
  select pg_get_functiondef('public.register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,integer,numeric,integer,integer,text)'::regprocedure)
    into definition;
  if position('doccob_profile_client_scope_check' in definition) > 0 then
    raise exception 'DOCCOB profile/client scope check is already installed';
  end if;
  if position(marker in definition) = 0 then
    raise exception 'DOCCOB registration validation anchor is missing';
  end if;

  validation := $sql$  -- doccob_profile_client_scope_check
  IF _client_id IS DISTINCT FROM (
    SELECT CASE WHEN count(DISTINCT invoice.client_id)=1
      THEN (array_agg(DISTINCT invoice.client_id))[1] ELSE NULL END
    FROM public.client_invoices invoice
    WHERE invoice.tenant_id=_tenant_id AND invoice.id=ANY(_client_invoice_ids)
  ) THEN
    RAISE EXCEPTION 'doccob_client_mismatch' USING ERRCODE='22023';
  END IF;
  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients client WHERE client.tenant_id=_tenant_id AND client.id=_client_id
  ) THEN
    RAISE EXCEPTION 'doccob_client_mismatch' USING ERRCODE='22023';
  END IF;
  IF _profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.billing_edi_profiles profile
    WHERE profile.tenant_id=_tenant_id AND profile.id=_profile_id AND profile.enabled
      AND (profile.client_id IS NULL OR profile.client_id=_client_id)
  ) THEN
    RAISE EXCEPTION 'doccob_profile_mismatch' USING ERRCODE='22023';
  END IF;

$sql$;
  execute replace(definition, marker, validation || marker);
end;
$migration$;
