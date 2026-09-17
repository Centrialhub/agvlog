create or replace function public.delete_failed_cte_draft_v1(_cte_document_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $function$
declare
  v_draft public.cte_documents%rowtype;
  v_source_count integer;
  v_expected_count integer;
  v_deleted uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select * into v_draft
  from public.cte_documents
  where id = _cte_document_id
  for update;
  if not found then return false; end if;

  if not private.is_request_tenant_member(v_draft.tenant_id)
     or not public.is_tenant_admin(v_draft.tenant_id) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if lower(coalesce(v_draft.sefaz_status, '')) not in
      ('error','rejected','sent_error','processed_error','sefaz_error','status_timeout')
     or v_draft.access_key is not null
     or v_draft.protocol_number is not null
     or v_draft.status in ('issued','authorized','cancelled') then
    raise exception 'cte_draft_has_fiscal_effect_or_is_not_terminal' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.hub_fiscal_emissions emission
    where emission.cte_document_id = v_draft.id
      and (emission.access_key is not null
        or emission.authorization_protocol is not null
        or emission.c_stat is not null
        or emission.last_callback is not null
        or emission.provider_effect_id is not null
        or lower(coalesce(emission.status, '')) not in ('error','rejected'))
  ) then
    raise exception 'cte_draft_has_provider_effect' using errcode = '23514';
  end if;

  v_expected_count := coalesce((
    select count(distinct source_id)
    from unnest(coalesce(v_draft.fiscal_document_ids, '{}'::uuid[])) source_id
  ), 0);

  perform 1
  from public.fiscal_documents source
  where source.id = any(coalesce(v_draft.fiscal_document_ids, '{}'::uuid[]))
  order by source.id
  for update;

  select count(*) into v_source_count
  from public.fiscal_documents source
  where source.tenant_id = v_draft.tenant_id
    and source.id = any(coalesce(v_draft.fiscal_document_ids, '{}'::uuid[]))
    and source.deleted_at is null;
  if v_source_count <> v_expected_count then
    raise exception 'cte_draft_source_set_changed' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.fiscal_documents source
    where source.tenant_id = v_draft.tenant_id
      and source.id = any(coalesce(v_draft.fiscal_document_ids, '{}'::uuid[]))
      and source.cte_emitted_outbound_id is not null
  ) then
    raise exception 'cte_draft_source_already_linked_to_outbound' using errcode = '23514';
  end if;

  update public.fiscal_documents
  set cte_emitted_at = null,
      cte_emitted_outbound_id = null
  where tenant_id = v_draft.tenant_id
    and id = any(coalesce(v_draft.fiscal_document_ids, '{}'::uuid[]))
    and deleted_at is null;

  delete from public.cte_documents
  where id = v_draft.id and tenant_id = v_draft.tenant_id
  returning id into v_deleted;
  if v_deleted is null then
    raise exception 'cte_draft_changed_during_cleanup' using errcode = '40001';
  end if;
  return true;
end;
$function$;

revoke all on function public.delete_failed_cte_draft_v1(uuid) from public, anon;
grant execute on function public.delete_failed_cte_draft_v1(uuid) to authenticated, service_role;

comment on function public.delete_failed_cte_draft_v1(uuid) is
  'Atomically releases source invoices and removes a terminal CT-e draft only when no fiscal/provider effect exists.';
