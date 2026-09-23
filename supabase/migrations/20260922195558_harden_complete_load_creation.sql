-- Keep fiscal identity intact when a confirmed, unassigned invoice receives
-- its first planned load. Moving/removing issued cargo remains a fiscal review.
do $migration$
declare body text; old_guard text; new_guard text;
begin
  body := replace(pg_get_functiondef('public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)'::regprocedure), E'\r\n', E'\n');
  old_guard := $$  or cte_emitted_at is not null or cte_emitted_outbound_id is not null or nfse_emitted_at is not null)) then$$;
  new_guard := $$  or ((cte_emitted_at is not null or cte_emitted_outbound_id is not null or nfse_emitted_at is not null)
    and not (_action='attach' and load_id is null and status='confirmed'
      and current_delivery_attempt_id is null and v_trip is null
      and exists(select 1 from public.loads target where target.id=_load_id
        and target.tenant_id=_tenant_id and target.status='planned' and target.trip_id is null)
      and not exists(select 1 from public.current_load_items assigned where assigned.fiscal_document_id=public.fiscal_documents.id)
      and not exists(select 1 from public.fiscal_documents issued where issued.id=public.fiscal_documents.cte_emitted_outbound_id
        and (issued.tenant_id is distinct from _tenant_id or (issued.load_id is not null and issued.load_id<>_load_id))))))) then$$;
  if position(old_guard in body)=0 then raise exception 'document_fiscal_guard_definition_drift'; end if;
  execute replace(body,old_guard,new_guard);
end $migration$;

create table private.load_creation_commands (
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  kind text not null check(kind in ('grouped','documents')),
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,actor_id,request_id)
);
create index load_creation_commands_actor_idx on private.load_creation_commands(actor_id);
alter table private.load_creation_commands enable row level security;
revoke all on private.load_creation_commands from public,anon,authenticated,service_role;

-- Internal implementations are inaccessible to callers, who must pass the
-- complete command through the authenticated, atomic ledger below.
do $migration$
declare body text; name text;
begin
  foreach name in array array['create_grouped_load_v1','create_load_with_documents_v1'] loop
    body := pg_get_functiondef(('public.'||name||'(jsonb)')::regprocedure);
    body := replace(body,'FUNCTION public.'||name||'(', 'FUNCTION private.'||name||'_impl(');
    execute body;
    execute format('revoke all on function private.%I(jsonb) from public,anon,authenticated,service_role',name||'_impl');
  end loop;
end $migration$;

create function private.create_complete_load(_kind text,_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  tenant uuid:=(_payload->>'tenant_id')::uuid;
  actor uuid:=auth.uid(); request uuid:=(_payload->>'request_id')::uuid;
  canonical jsonb; previous private.load_creation_commands%rowtype;
  result jsonb; allowed text[]; doc_ids uuid[]; patch jsonb; document public.fiscal_documents%rowtype;
begin
  if actor is null or tenant is null or request is null then
    raise exception 'tenant_actor_request_required' using errcode='22023';
  end if;
  perform 1 from public.tenant_memberships tm where tm.tenant_id=tenant and tm.user_id=actor
    and tm.active and tm.role::text in ('owner','admin','operator') for share;
  if not found then raise exception 'operator_required' using errcode='42501'; end if;
  if _kind not in ('grouped','documents') or jsonb_typeof(_payload) is distinct from 'object' then
    raise exception 'invalid_load_creation_command' using errcode='22023';
  end if;
  allowed := case when _kind='grouped' then array['tenant_id','request_id','changes','document_ids']
    else array['tenant_id','request_id','changes','selected_document_ids','single_document_patch','manual_document','audit_events'] end;
  if exists(select 1 from jsonb_object_keys(_payload) k where not(k=any(allowed))) then
    raise exception 'unsupported_load_creation_fields' using errcode='22023';
  end if;
  if jsonb_typeof(_payload->'changes') is distinct from 'object' then
    raise exception 'changes_must_be_object' using errcode='22023';
  end if;
  if _kind='grouped' and _payload->'changes'->'status'='"planned"'::jsonb then
    _payload:=jsonb_set(_payload,'{changes}',(_payload->'changes')-'status');
  end if;
  canonical:=_payload-'request_id';
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':'||actor::text||':'||request::text,0));
  select * into previous from private.load_creation_commands c
    where c.tenant_id=tenant and c.actor_id=actor and c.request_id=request;
  if found then
    if previous.kind<>_kind or previous.payload<>canonical then
      raise exception 'request_payload_mismatch' using errcode='22023';
    end if;
    return previous.response||jsonb_build_object('replayed',true);
  end if;
  -- An old header-only command cannot prove the full original composition.
  if exists(select 1 from private.load_aggregate_commands c
    where c.tenant_id=tenant and c.actor_id=actor and c.request_id=request) then
    raise exception 'legacy_load_creation_requires_review' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(_payload->case when _kind='grouped' then 'document_ids' else 'selected_document_ids' end,'[]'::jsonb))<>'array' then
    raise exception 'invalid_document_selection' using errcode='22023';
  end if;
  select coalesce(array_agg(value::uuid),array[]::uuid[]) into doc_ids
    from jsonb_array_elements_text(coalesce(_payload->case when _kind='grouped' then 'document_ids' else 'selected_document_ids' end,'[]'::jsonb));
  if cardinality(doc_ids)>10000 or cardinality(doc_ids)<>(select count(distinct id) from unnest(doc_ids) ids(id)) then
    raise exception 'invalid_document_selection' using errcode='22023';
  end if;
  perform id from public.fiscal_documents where tenant_id=tenant and id=any(doc_ids) order by id for update;
  if (select count(*) from public.fiscal_documents where tenant_id=tenant and id=any(doc_ids)
    and document_type='inbound' and deleted_at is null and status='confirmed' and load_id is null)<>cardinality(doc_ids) then
    raise exception 'selected_document_not_available' using errcode='23514';
  end if;
  -- Internal implementation runs with explicit tenant checks, including metadata
  -- foreign keys that were previously also guarded by the caller's RLS.
  foreach patch in array array[_payload->'single_document_patch',_payload->'manual_document'] loop
    if nullif(patch->>'client_id','') is not null and not exists(select 1 from public.clients c
      where c.id=(patch->>'client_id')::uuid and c.tenant_id=tenant) then
      raise exception 'invalid_client_for_tenant' using errcode='23514';
    end if;
  end loop;
  if _kind='documents' then
    if exists(select 1 from jsonb_array_elements(coalesce(_payload->'audit_events','[]'::jsonb)) a
      where not(coalesce((a->>'fiscal_document_id')::uuid=any(doc_ids),false))
      or nullif(a->>'previous_load_id','') is not null) then
      raise exception 'invalid_load_note_audit' using errcode='22023';
    end if;
    if cardinality(doc_ids)=1 then
      select * into document from public.fiscal_documents where id=doc_ids[1] and tenant_id=tenant;
      -- Legacy screens always send an autofill patch. Issued fiscal identity
      -- must remain unchanged when creating the operational load.
      if document.cte_emitted_at is not null or document.cte_emitted_outbound_id is not null or document.nfse_emitted_at is not null then
        _payload:=_payload-'single_document_patch';
      end if;
    end if;
    result:=private.create_load_with_documents_v1_impl(_payload);
  else
    result:=private.create_grouped_load_v1_impl(_payload);
  end if;
  result:=result||jsonb_build_object('tenant_id',tenant,'request_id',request,'document_ids',to_jsonb(doc_ids));
  select result||jsonb_build_object('load',to_jsonb(l),'version',l.version) into result
    from public.loads l where l.id=(result->>'load_id')::uuid and l.tenant_id=tenant;
  if result is null then raise exception 'load_creation_confirmation_missing'; end if;
  insert into private.load_creation_commands(tenant_id,actor_id,request_id,kind,payload,response)
    values(tenant,actor,request,_kind,canonical,result);
  return result;
end $function$;
revoke all on function private.create_complete_load(text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.create_complete_load(text,jsonb) to authenticated;

create or replace function public.create_grouped_load_v1(_payload jsonb)
returns jsonb language sql security invoker set search_path='' set row_security='on' as $function$
  select private.create_complete_load('grouped',_payload);
$function$;
create or replace function public.create_load_with_documents_v1(_payload jsonb)
returns jsonb language sql security invoker set search_path='' set row_security='on' as $function$
  select private.create_complete_load('documents',_payload);
$function$;
revoke all on function public.create_grouped_load_v1(jsonb),public.create_load_with_documents_v1(jsonb) from public,anon,service_role;
grant execute on function public.create_grouped_load_v1(jsonb),public.create_load_with_documents_v1(jsonb) to authenticated;
