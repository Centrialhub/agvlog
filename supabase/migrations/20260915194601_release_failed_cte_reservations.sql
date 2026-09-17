-- Failed outbound CT-e attempts may be removed by tenant administrators when
-- no document was created at the fiscal provider. Keep the source reservation
-- tied to the local attempt so both rows are released atomically.
alter table public.fiscal_source_reservations
  drop constraint fiscal_source_reservations_outbound_id_fkey;

alter table public.fiscal_source_reservations
  add constraint fiscal_source_reservations_outbound_id_fkey
  foreign key (outbound_id)
  references public.fiscal_documents(id)
  on delete cascade;

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

  if _document.hub_document_id is not null
     or _document.emission_id is not null
     or exists (
       select 1
         from public.hub_fiscal_emissions emission
        where emission.fiscal_document_id = _document.id
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
     and emission_id is null
  returning id into _deleted_id;

  if _deleted_id is null then
    raise exception using errcode = '40001', message = 'O estado da tentativa mudou durante a exclusão.';
  end if;

  return true;
end;
$function$;

revoke all on function public.delete_failed_cte_attempt_v1(uuid) from public, anon;
grant execute on function public.delete_failed_cte_attempt_v1(uuid) to authenticated, service_role;