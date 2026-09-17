create or replace function public.audit_imported_notes_v1(
  _tenant_id uuid,
  _document_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requested integer;
  v_matched integer;
  v_cleared integer;
begin
  if not (public.is_tenant_admin(_tenant_id) or public.has_tenant_role(_tenant_id, 'operator')) then
    raise exception 'Sem permissão para auditar notas importadas' using errcode = '42501';
  end if;

  select count(distinct id)::integer into v_requested
  from unnest(coalesce(_document_ids, array[]::uuid[])) id;
  if v_requested = 0 then
    raise exception 'Selecione ao menos uma nota para auditar' using errcode = '22023';
  end if;

  perform 1
  from public.fiscal_documents document
  where document.tenant_id = _tenant_id
    and document.id = any(_document_ids)
    and document.document_type = 'inbound'
    and document.deleted_at is null
  for update;

  select count(*)::integer into v_matched
  from public.fiscal_documents document
  where document.tenant_id = _tenant_id
    and document.id = any(_document_ids)
    and document.document_type = 'inbound'
    and document.deleted_at is null
    and document.imported_note_status = 'processed';

  if v_matched <> v_requested then
    raise exception 'Uma ou mais notas não pertencem à fila de importadas processadas'
      using errcode = 'P0002';
  end if;

  insert into public.entity_audit_log (
    id, tenant_id, entity_type, entity_id, action, old_data, new_data,
    actor_user_id, actor_role, source, request_id, created_at
  )
  select
    gen_random_uuid(), document.tenant_id, 'fiscal_document', document.id,
    'imported_note_audited',
    jsonb_build_object(
      'imported_note_status', document.imported_note_status,
      'status', document.status,
      'delivery_meta', document.delivery_meta,
      'load_id', document.load_id
    ),
    jsonb_build_object(
      'audited', true,
      'cleared_legacy_processed_status', true
    ),
    auth.uid(),
    case when public.is_tenant_admin(_tenant_id) then 'admin' else 'operator' end,
    'imported_notes_summary',
    gen_random_uuid()::text,
    now()
  from public.fiscal_documents document
  where document.tenant_id = _tenant_id
    and document.id = any(_document_ids)
    and document.document_type = 'inbound'
    and document.deleted_at is null
    and document.imported_note_status = 'processed';

  perform set_config('app.imported_note_audit_command', 'on', true);
  update public.fiscal_documents
  set imported_note_status = null
  where tenant_id = _tenant_id
    and id = any(_document_ids)
    and document_type = 'inbound'
    and deleted_at is null
    and imported_note_status = 'processed';
  get diagnostics v_cleared = row_count;

  if v_cleared <> v_requested then
    raise exception 'A fila de notas importadas mudou durante a auditoria'
      using errcode = '40001';
  end if;

  return jsonb_build_object('audited_count', v_matched, 'legacy_statuses_cleared', v_cleared);
end;
$function$;

revoke all on function public.audit_imported_notes_v1(uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.audit_imported_notes_v1(uuid, uuid[])
to authenticated, service_role;
