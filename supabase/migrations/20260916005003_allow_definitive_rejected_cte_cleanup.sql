-- A provider may allocate an internal Hub id and still return a definitive
-- rejection before a fiscal document exists. A rejected number may remain in
-- the audit, but without access key, protocol, callback or provider effect the
-- attempt may be detached so the source
-- notes can be corrected and emitted again. The emission row remains as audit.
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

  if exists (
    select 1
      from public.hub_fiscal_emissions emission
     where emission.fiscal_document_id = _document.id
       and (
         lower(coalesce(emission.dispatch_state, '')) <> 'recorded'
         or not (
           lower(coalesce(emission.status, '')) = 'rejected'
           or (
             lower(coalesce(emission.status, '')) = 'error'
             and coalesce(emission.last_response #>> '{error,code}', '') = 'CTE_PREFLIGHT_FAILED'
           )
         )
         or emission.plugnotas_id is not null
         or emission.access_key is not null
         or emission.authorization_protocol is not null
         or (lower(coalesce(emission.status, '')) <> 'rejected' and emission.number is not null)
         or emission.c_stat is not null
         or emission.last_callback is not null
         or emission.provider_effect_id is not null
       )
  ) then
    raise exception using errcode = '22023', message = 'O CT-e possui efeito fiscal e deve ser reconciliado ou cancelado.';
  end if;

  if _document.emission_id is not null
     and not exists (
       select 1
         from public.hub_fiscal_emissions emission
        where emission.id = _document.emission_id
          and emission.fiscal_document_id = _document.id
          and lower(coalesce(emission.dispatch_state, '')) = 'recorded'
          and (
            lower(coalesce(emission.status, '')) = 'rejected'
            or (
              lower(coalesce(emission.status, '')) = 'error'
              and coalesce(emission.last_response #>> '{error,code}', '') = 'CTE_PREFLIGHT_FAILED'
            )
          )
          and emission.plugnotas_id is null
          and emission.access_key is null
          and emission.authorization_protocol is null
          and (lower(coalesce(emission.status, '')) = 'rejected' or emission.number is null)
          and emission.c_stat is null
          and emission.last_callback is null
          and emission.provider_effect_id is null
          and (_document.hub_document_id is null or emission.hub_document_id = _document.hub_document_id)
     ) then
    raise exception using errcode = '22023', message = 'O CT-e possui efeito fiscal e deve ser reconciliado ou cancelado.';
  end if;

  if _document.hub_document_id is not null
     and not exists (
       select 1
         from public.hub_fiscal_emissions emission
        where emission.fiscal_document_id = _document.id
          and emission.hub_document_id = _document.hub_document_id
          and lower(coalesce(emission.status, '')) = 'rejected'
          and lower(coalesce(emission.dispatch_state, '')) = 'recorded'
          and emission.access_key is null
          and emission.authorization_protocol is null
          and emission.c_stat is null
          and emission.last_callback is null
          and emission.provider_effect_id is null
     ) then
    raise exception using errcode = '22023', message = 'O CT-e possui efeito fiscal e deve ser reconciliado ou cancelado.';
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
  returning id into _deleted_id;

  if _deleted_id is null then
    raise exception using errcode = '40001', message = 'O estado da tentativa mudou durante a exclusão.';
  end if;

  return true;
end;
$function$;

revoke all on function public.delete_failed_cte_attempt_v1(uuid) from public, anon;
grant execute on function public.delete_failed_cte_attempt_v1(uuid) to authenticated, service_role;
