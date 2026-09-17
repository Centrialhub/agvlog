drop function if exists public.list_finance_account_artifacts_v1(uuid,uuid,integer);

create function public.list_finance_account_artifacts_v1(
  _tenant_id uuid,
  _account_id uuid,
  _offset integer default 0,
  _snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  rows jsonb;
  total integer;
  snapshot_at timestamptz := coalesce(_snapshot_at,statement_timestamp());
begin
  perform finance_private.require_access(_tenant_id);
  if _offset<0
     or not isfinite(snapshot_at)
     or snapshot_at>statement_timestamp()+interval '5 minutes' then
    raise exception 'invalid_artifact_page' using errcode='22023';
  end if;

  select count(*)
    into total
  from secure_upload_private.artifacts artifact
  where artifact.tenant_id=_tenant_id
    and artifact.source_type='bank_account'
    and artifact.source_id=_account_id
    and artifact.created_at<=snapshot_at;

  select coalesce(
    jsonb_agg(secure_upload_private.dto(artifact) order by artifact.created_at desc,artifact.id),
    '[]'::jsonb
  )
    into rows
  from (
    select candidate.*
    from secure_upload_private.artifacts candidate
    where candidate.tenant_id=_tenant_id
      and candidate.source_type='bank_account'
      and candidate.source_id=_account_id
      and candidate.created_at<=snapshot_at
    order by candidate.created_at desc,candidate.id
    limit 30 offset _offset
  ) artifact;

  return jsonb_build_object(
    'tenant_id',_tenant_id,
    'account_id',_account_id,
    'offset',_offset,
    'snapshot_at',snapshot_at,
    'total',total,
    'rows',rows,
    'next_offset',case
      when _offset+jsonb_array_length(rows)<total then _offset+jsonb_array_length(rows)
    end
  );
end;
$function$;

revoke all on function public.list_finance_account_artifacts_v1(uuid,uuid,integer,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function public.list_finance_account_artifacts_v1(uuid,uuid,integer,timestamptz)
to authenticated;
