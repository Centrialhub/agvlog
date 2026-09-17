alter table public.merchandise_shortage_import_batches
  add column if not exists payload_hash text;

alter table public.merchandise_shortage_import_batches
  add constraint merchandise_shortage_import_payload_hash_format
  check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$');

create or replace function public.import_merchandise_shortage_batch_v1(
  _tenant_id uuid,
  _request_id uuid,
  _file_name text,
  _row_count integer,
  _file_hash text,
  _cases jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  batch public.merchandise_shortage_import_batches%rowtype;
  case_payload jsonb;
  imported integer := 0;
  v_payload_hash text;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if _request_id is null
     or nullif(btrim(_file_name), '') is null
     or _row_count < 0
     or coalesce(_file_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(jsonb_typeof(_cases), '') <> 'array'
     or jsonb_array_length(_cases) > 10000 then
    raise exception 'invalid_shortage_import' using errcode = '22023';
  end if;

  if _row_count <> jsonb_array_length(_cases) then
    raise exception 'shortage_import_row_count_mismatch' using errcode = '22023';
  end if;

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'file_name', btrim(_file_name),
          'row_count', _row_count,
          'file_hash', _file_hash,
          'cases', _cases
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- A fixed lock order serializes both collision dimensions. A different file
  -- cannot reuse a request while a different request cannot claim the same file.
  perform pg_advisory_xact_lock(
    hashtextextended(_tenant_id::text || ':shortage-request:' || _request_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(_tenant_id::text || ':shortage-file:' || _file_hash, 0)
  );

  select * into batch
  from public.merchandise_shortage_import_batches existing
  where existing.tenant_id = _tenant_id
    and existing.request_id = _request_id
  for update;

  if found then
    if batch.file_hash is distinct from _file_hash
       or batch.payload_hash is distinct from v_payload_hash then
      raise exception 'shortage_import_request_payload_mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'version', 1,
      'tenant_id', _tenant_id,
      'actor_id', auth.uid(),
      'batch_id', batch.id,
      'imported_count', batch.imported_count,
      'status', batch.status,
      'replayed', true
    );
  end if;

  select * into batch
  from public.merchandise_shortage_import_batches existing
  where existing.tenant_id = _tenant_id
    and existing.file_hash = _file_hash
  for update;

  if found then
    raise exception 'shortage_import_file_identity_mismatch' using errcode = '22023';
  end if;

  insert into public.merchandise_shortage_import_batches (
    tenant_id, file_name, row_count, imported_count, updated_count,
    unmatched_count, error_count, status, errors, metadata, created_by,
    request_id, file_hash, payload_hash
  ) values (
    _tenant_id, btrim(_file_name), _row_count, 0, 0,
    0, 0, 'processing', '[]'::jsonb, '{}'::jsonb, auth.uid(),
    _request_id, _file_hash, v_payload_hash
  ) returning * into batch;

  for case_payload in select value from jsonb_array_elements(_cases) loop
    perform public.create_merchandise_shortage_case(
      _tenant_id,
      jsonb_set(case_payload, '{import_batch_id}', to_jsonb(batch.id::text), true)
    );
    imported := imported + 1;
  end loop;

  update public.merchandise_shortage_import_batches
  set imported_count = imported,
      status = 'completed'
  where id = batch.id
    and tenant_id = _tenant_id;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', auth.uid(),
    'batch_id', batch.id,
    'imported_count', imported,
    'status', 'completed',
    'replayed', false
  );
end;
$function$;

revoke all on function public.import_merchandise_shortage_batch_v1(uuid,uuid,text,integer,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.import_merchandise_shortage_batch_v1(uuid,uuid,text,integer,text,jsonb)
to authenticated;
