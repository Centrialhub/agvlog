create table public.finance_statement_verifications(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,import_id uuid not null,
 actor_id uuid not null,reader_version text not null,source_revision text not null,
 outcome text not null check(outcome in('rows_match','rows_mismatch','unreadable')),report jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,import_id) references public.finance_statement_imports(tenant_id,id)
);
create index finance_statement_verification_history on public.finance_statement_verifications(tenant_id,import_id,created_at,id);
alter table public.finance_statement_verifications enable row level security;
revoke all on public.finance_statement_verifications from public,anon,authenticated,service_role;
grant select on public.finance_statement_verifications to authenticated,service_role;
create policy finance_statement_verifications_read on public.finance_statement_verifications for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_verifications_immutable before update or delete on public.finance_statement_verifications for each row execute function finance_private.preserve_event();

create function finance_private.statement_snapshot(_tenant uuid,_import uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('import_data',to_jsonb(i),'rows',coalesce((select jsonb_agg(r.raw order by r.source_row)
   from public.finance_statement_rows r where r.tenant_id=_tenant and r.import_id=i.id),'[]'))
 from public.finance_statement_imports i where i.tenant_id=_tenant and i.id=_import;
$$;
revoke all on function finance_private.statement_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.inspect_statement_source(_tenant uuid,_import uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare snapshot jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 snapshot:=finance_private.statement_snapshot(_tenant,_import);
 if snapshot is null then raise exception 'finance_statement_not_found' using errcode='22023';end if;
 return snapshot||jsonb_build_object('revision',md5(snapshot::text));
end;$$;
revoke all on function finance_private.inspect_statement_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.inspect_statement_source(uuid,uuid) to authenticated;
create function public.inspect_finance_statement_source(_tenant_id uuid,_import_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.inspect_statement_source(_tenant_id,_import_id);$$;
revoke all on function public.inspect_finance_statement_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_finance_statement_source(uuid,uuid) to authenticated;

-- Only the verified server worker can publish this result. Browser callers
-- cannot promote a row mapping to a verified reading of the original file.
create function finance_private.record_statement_verification(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid;request uuid;v_import uuid;snapshot jsonb;existing public.finance_commands%rowtype;
 verification uuid;result jsonb;actor_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;actor:=(_payload->>'actor_id')::uuid;request:=(_payload->>'request_id')::uuid;v_import:=(_payload->>'import_id')::uuid;
 if actor is null or not exists(select 1 from public.tenant_memberships m where m.tenant_id=t and m.user_id=actor and m.active and m.role::text in('owner','admin','operator'))
   or exists(select 1 from public.tenant_memberships m where m.tenant_id=t and m.user_id=actor and m.active and m.role::text='driver')
   or exists(select 1 from public.drivers d where d.tenant_id=t and d.user_id=actor and d.active) then
   raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or v_import is null or _payload->>'reader_version' is distinct from 'statement-source-v1'
   or coalesce(_payload->>'outcome','') not in('rows_match','rows_mismatch','unreadable') or jsonb_typeof(_payload->'report') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(_payload) k where k not in('tenant_id','actor_id','request_id','import_id','reader_version','source_revision','file_hash','outcome','report')) then
   raise exception 'finance_invalid_verification' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
   if existing.actor_id<>actor or existing.action<>'verify_statement_source' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
   return existing.result;
 end if;
 snapshot:=finance_private.statement_snapshot(t,v_import);
 if snapshot is null or md5(snapshot::text) is distinct from _payload->>'source_revision'
   or snapshot#>>'{import_data,file_hash}' is distinct from _payload->>'file_hash' then
   raise exception 'finance_statement_verification_changed' using errcode='40001';end if;
 if _payload->>'outcome'='rows_match' and (coalesce((_payload#>>'{report,matched_rows}')::integer,-1)<>jsonb_array_length(snapshot->'rows')
   or _payload#>>'{report,hash_verified}' is distinct from 'true') then
   raise exception 'finance_invalid_verification_report' using errcode='22023';end if;
 insert into public.finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report)
 values(t,v_import,actor,_payload->>'reader_version',_payload->>'source_revision',_payload->>'outcome',_payload->'report') returning id into verification;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'import_id',v_import,'verification_id',verification,
   'source_verification',_payload->>'outcome','account_coverage_verification','pending','confirmed',true);
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'statement_import',v_import,'source_checked',actor,coalesce(actor_name,actor::text),'Conferência no servidor contra arquivo original preservado',_payload);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'verify_statement_source',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.record_statement_verification(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_statement_verification(jsonb) to service_role;
create function public.record_finance_statement_verification(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.record_statement_verification(_payload);$$;
revoke all on function public.record_finance_statement_verification(jsonb) from public,anon,authenticated,service_role;
grant usage on schema finance_private to service_role;
grant execute on function public.record_finance_statement_verification(jsonb) to service_role;

create function finance_private.statement_original_ready(_tenant uuid,_hash text,_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if coalesce(_hash,'')!~'^[a-f0-9]{64}$' or coalesce(_path,'')!~('^'||_tenant::text||'/imports/'||_hash||'\.(csv|xlsx|xls)$') then
   raise exception 'finance_statement_scope_invalid' using errcode='22023';end if;
 return exists(select 1 from storage.objects where bucket_id='finance-statements' and name=_path);
end;$$;
revoke all on function finance_private.statement_original_ready(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_original_ready(uuid,text,text) to authenticated;
create function public.finance_statement_original_ready(_tenant_id uuid,_file_hash text,_source_path text) returns boolean
language sql security invoker set search_path='' as $$select finance_private.statement_original_ready(_tenant_id,_file_hash,_source_path);$$;
revoke all on function public.finance_statement_original_ready(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_statement_original_ready(uuid,text,text) to authenticated;
