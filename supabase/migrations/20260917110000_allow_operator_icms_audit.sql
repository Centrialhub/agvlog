create or replace function public.monitor_simples_nacional_icms_violations(_tenant_id uuid)
returns table(
  fiscal_document_id uuid,
  cte_number text,
  emitter_name text,
  icms_base numeric,
  icms_aliquota numeric,
  icms_valor numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role'
     and (
       not private.is_request_tenant_member(_tenant_id)
       or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false)
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    document.id,
    coalesce(
      document.invoice_number,
      document.cte_payload->'payload'->'ide'->>'nCT',
      document.id::text
    )::text,
    coalesce(
      emitter.razao_social,
      document.cte_payload->'payload'->'emitente'->>'nome',
      'Emitente não identificado'
    )::text,
    coalesce(nullif(document.cte_payload->'payload'->'valores'->>'baseIcms', '')::numeric, 0),
    coalesce(nullif(document.cte_payload->'payload'->'valores'->>'aliquotaIcms', '')::numeric, 0),
    coalesce(nullif(document.cte_payload->'payload'->'valores'->>'valorIcms', '')::numeric, 0),
    document.created_at
  from public.fiscal_documents document
  left join public.tenant_emitters emitter
    on emitter.id = document.emitter_id
   and emitter.tenant_id = document.tenant_id
  where document.tenant_id = _tenant_id
    and document.status = 'authorized'
    and document.deleted_at is null
    and document.cte_payload is not null
    and lower(coalesce(
      emitter.regime_tributario,
      document.cte_payload->>'regimeTributario',
      document.cte_payload->'payload'->>'regimeTributario',
      ''
    )) in ('simples', 'mei', '1')
    and (
      coalesce(nullif(document.cte_payload->'payload'->'valores'->>'baseIcms', '')::numeric, 0) > 0
      or coalesce(nullif(document.cte_payload->'payload'->'valores'->>'aliquotaIcms', '')::numeric, 0) > 0
      or coalesce(nullif(document.cte_payload->'payload'->'valores'->>'valorIcms', '')::numeric, 0) > 0
    );
end;
$function$;

revoke all on function public.monitor_simples_nacional_icms_violations(uuid) from public, anon;
grant execute on function public.monitor_simples_nacional_icms_violations(uuid) to authenticated, service_role;

comment on function public.monitor_simples_nacional_icms_violations(uuid) is
  'Reads ICMS violations for the active tenant; authorized for owner, admin, and operator roles.';
