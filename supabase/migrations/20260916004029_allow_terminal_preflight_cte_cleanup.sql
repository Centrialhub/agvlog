-- A rejected CT-e preflight is recorded in hub_fiscal_emissions for audit even
-- though no document reached the provider. Permit administrators to remove the
-- local outbound attempt in that one terminal case, releasing its source-note
-- reservation while preserving the detached emission audit row.
create or replace function public.delete_failed_cte_attempt_v1(_fiscal_document_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  _document public.fiscal_documents%rowtype;
  _deleted_id uuid;
begin
  select *
    into _document
    from public.fiscal_documents
   where id = _fiscal_document_id
     and document_type = 'outbound'
   for update;

  if not found then
    return false;
  end if;

  if not public.is_tenant_admin(_document.tenant_id) then
    raise exception using errcode = '42501', message = 'Somente administradores podem excluir uma tentativa de CT-e.';
  end if;

  if _document.hub_document_id is not null then
    raise exception using errcode = '22023', message = 'O CT-e possui referência no provedor e deve ser reconciliado ou cancelado.';
  end if;

  -- Any provider evidence, uncertain dispatch, callback, or non-preflight
  -- response keeps the operation immutable. A technical emission row is safe
  -- to detach only when it records our terminal local preflight rejection.
  if exists (
    select 1
      from public.hub_fiscal_emissions emission
     where emission.fiscal_document_id = _document.id
       and (
         lower(coalesce(emission.status, '')) not in ('error', 'rejected')
         or lower(coalesce(emission.dispatch_state, '')) <> 'recorded'
         or coalesce(emission.last_response #>> '{error,code}', '') <> 'CTE_PREFLIGHT_FAILED'
         or emission.hub_document_id is not null
         or emission.plugnotas_id is not null
         or emission.access_key is not null
         or emission.authorization_protocol is not null
         or emission.number is not null
         or emission.c_stat is not null
         or emission.last_callback is not null
         or emission.provider_effect_id is not null
       )
  ) then
    raise exception using errcode = '22023', message = 'O CT-e possui referência no provedor e deve ser reconciliado ou cancelado.';
  end if;

  if _document.emission_id is not null
     and not exists (
       select 1
         from public.hub_fiscal_emissions emission
        where emission.id = _document.emission_id
          and emission.fiscal_document_id = _document.id
          and lower(coalesce(emission.status, '')) in ('error', 'rejected')
          and lower(coalesce(emission.dispatch_state, '')) = 'recorded'
          and coalesce(emission.last_response #>> '{error,code}', '') = 'CTE_PREFLIGHT_FAILED'
          and emission.hub_document_id is null
          and emission.plugnotas_id is null
          and emission.access_key is null
          and emission.authorization_protocol is null
          and emission.number is null
          and emission.c_stat is null
          and emission.last_callback is null
          and emission.provider_effect_id is null
     ) then
    raise exception using errcode = '22023', message = 'O CT-e possui referência no provedor e deve ser reconciliado ou cancelado.';
  end if;

  if lower(coalesce(_document.status, '')) not in ('error', 'rejected', 'processed_error', 'sent_error', 'sefaz_error', 'status_timeout')
     and lower(coalesce(_document.sefaz_status, '')) not in ('error', 'rejected', 'processed_error', 'sent_error', 'sefaz_error', 'status_timeout') then
    raise exception using errcode = '22023', message = 'Apenas tentativas de CT-e com falha terminal podem ser excluídas.';
  end if;

  update public.fiscal_documents
     set cte_emitted_at = null,
         cte_emitted_outbound_id = null
   where tenant_id = _document.tenant_id
     and cte_emitted_outbound_id = _document.id
     and deleted_at is null;

  delete from public.fiscal_documents
   where id = _document.id
     and tenant_id = _document.tenant_id
     and document_type = 'outbound'
     and hub_document_id is null
  returning id into _deleted_id;

  if _deleted_id is null then
    raise exception using errcode = '40001', message = 'O estado da tentativa mudou durante a exclusão.';
  end if;

  return true;
end;
$function$;

revoke all on function public.delete_failed_cte_attempt_v1(uuid) from public, anon;
grant execute on function public.delete_failed_cte_attempt_v1(uuid) to authenticated, service_role;
