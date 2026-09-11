-- Additive evidence attachment. Existing receipt_path and financial amounts are unchanged.
alter table secure_upload_private.artifacts drop constraint artifacts_source_type_check;
alter table secure_upload_private.artifacts add constraint artifacts_source_type_check check(source_type in('trip','settlement','bank_account','expense_item'));
do $patch$
declare body text;needle text:=' else raise exception ''upload_source_unavailable'' using errcode=''42501'';end if;';
begin
 select prosrc into body from pg_proc where oid='secure_upload_private.assert_source(uuid,text,uuid)'::regprocedure;
 if exists(select 1 from pg_proc where oid='secure_upload_private.assert_source(uuid,text,uuid)'::regprocedure and (not prosecdef or proconfig is distinct from array['search_path=""']::text[])) or has_function_privilege('anon','secure_upload_private.assert_source(uuid,text,uuid)','EXECUTE') or has_function_privilege('authenticated','secure_upload_private.assert_source(uuid,text,uuid)','EXECUTE') or has_function_privilege('service_role','secure_upload_private.assert_source(uuid,text,uuid)','EXECUTE') or md5(body)<>'57ae7ff3d54eddb18f68e5435c265a79' or position(needle in body)=0 or position('expense_item' in body)>0 or exists(select 1 from aclexplode((select proacl from pg_proc where oid='secure_upload_private.assert_source(uuid,text,uuid)'::regprocedure)) where grantee<>(select proowner from pg_proc where oid='secure_upload_private.assert_source(uuid,text,uuid)'::regprocedure)) then raise exception 'upload_source_contract_changed';end if;
 body:=replace(body,needle,' elsif kind=''expense_item'' then
  if not exists(select 1 from public.finance_expense_items where tenant_id=t and id=source) then raise exception ''upload_source_unavailable'' using errcode=''42501'';end if;
'||needle);
 execute format('create or replace function secure_upload_private.assert_source(t uuid,kind text,source uuid) returns void language plpgsql security definer set search_path='''' as %L',body);
end $patch$;
create table secure_upload_private.expense_receipts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),expense_id uuid not null references public.finance_expense_items(id),artifact_id uuid not null references secure_upload_private.artifacts(id),
 request_id uuid not null,actor_id uuid not null,reason text not null,source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,request_id),unique(tenant_id,expense_id,artifact_id)
);
alter table secure_upload_private.expense_receipts enable row level security;
revoke all on secure_upload_private.expense_receipts from public,anon,authenticated,service_role;
create trigger expense_receipt_immutable before update or delete on secure_upload_private.expense_receipts for each row execute function secure_upload_private.preserve_event();
create function secure_upload_private.expense_receipt_source(t uuid,expense uuid,artifact uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a secure_upload_private.artifacts%rowtype;d jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform secure_upload_private.assert_source(t,'expense_item',expense);
 select * into a from secure_upload_private.artifacts where id=artifact and tenant_id=t;
 if not found or a.source_type<>'expense_item' or a.source_id<>expense then raise exception 'upload_receipt_source_mismatch' using errcode='42501';end if;
 d:=a.derivative;
 if a.state<>'sanitized_derivative' or not a.original_received or a.format not in('jpeg','png') or d is null
  or d->>'bucket' is distinct from 'upload-validated' or (d->>'mime') is null or d->>'mime' not in('image/jpeg','image/png')
  or d->>'method' is distinct from a.method or a.method is distinct from 'jpeg-png-reencode-v1'
  or d->>'path' is distinct from (a.tenant_id::text||'/'||a.request_id::text||'/validated.'||(case when a.format='jpeg' then 'jpg' else 'png' end)) or coalesce(d->>'sha256','')!~'^[a-f0-9]{64}$'
  or not exists(select 1 from secure_upload_private.events e where e.artifact_id=a.id and e.tenant_id=t and e.action='validation_recorded' and e.snapshot->'result'->>'state'='sanitized_derivative')
 then raise exception 'upload_receipt_not_usable' using errcode='55000';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='upload-validated' and o.name=d->>'path'
  and o.user_metadata @> jsonb_build_object('version',2,'artifact_id',a.id,'sha256',d->>'sha256','size_bytes',d->'size_bytes','kind','validated_derivative','original_sha256',a.original_sha256)
  and o.metadata->'size'=d->'size_bytes' and o.metadata->>'mimetype'=d->>'mime')
 then raise exception 'upload_receipt_object_changed' using errcode='55000';end if;
 return secure_upload_private.dto(a);
end$$;
create function secure_upload_private.attach_expense_receipt(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid:=(_payload->>'tenant_id')::uuid;actor uuid:=auth.uid();expense uuid:=(_payload->>'expense_id')::uuid;artifact uuid:=(_payload->>'artifact_id')::uuid;request uuid:=(_payload->>'request_id')::uuid;reason text:=btrim(_payload->>'reason');r secure_upload_private.expense_receipts%rowtype;s jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t or actor is null then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '2'::jsonb or expense is null or artifact is null or request is null or length(coalesce(reason,'')) not between 5 and 2000 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','expense_id','artifact_id','request_id','reason'])) then raise exception 'upload_invalid_identity' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into r from secure_upload_private.expense_receipts where tenant_id=t and request_id=request;
 if found then
  if r.actor_id<>actor or r.expense_id<>expense or r.artifact_id<>artifact or r.reason<>reason then raise exception 'upload_request_conflict' using errcode='23505';end if;
 else
  perform 1 from public.finance_expense_items where tenant_id=t and id=expense for share nowait;
  perform 1 from secure_upload_private.artifacts where tenant_id=t and id=artifact for share nowait;
  s:=secure_upload_private.expense_receipt_source(t,expense,artifact);perform finance_private.require_access(t);
  insert into secure_upload_private.expense_receipts(tenant_id,expense_id,artifact_id,request_id,actor_id,reason,source_snapshot) values(t,expense,artifact,request,actor,reason,s) returning * into r;
  insert into secure_upload_private.events(artifact_id,tenant_id,actor_id,action,snapshot) values(artifact,t,actor,'expense_receipt_attached',jsonb_build_object('link_id',r.id,'expense_id',expense,'request_id',request,'reason',reason,'evidence',s));
 end if;
 return jsonb_build_object('version',2,'tenant_id',t,'expense_id',expense,'link_id',r.id,'artifact_id',artifact,'request_id',request,'confirmed',true);
exception when lock_not_available then raise exception 'upload_receipt_busy' using errcode='40001';
end$$;
create function secure_upload_private.expense_receipt_history(t uuid,expense uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform secure_upload_private.assert_source(t,'expense_item',expense);
 select coalesce(jsonb_agg(jsonb_build_object('link_id',r.id,'artifact_id',r.artifact_id,'actor_id',r.actor_id,'request_id',r.request_id,'reason',r.reason,'created_at',r.created_at,'evidence',r.source_snapshot) order by r.created_at,r.id),'[]') into rows from secure_upload_private.expense_receipts r where r.tenant_id=t and r.expense_id=expense;
 return jsonb_build_object('version',2,'tenant_id',t,'expense_id',expense,'receipts',rows);
end$$;
revoke all on function secure_upload_private.expense_receipt_source(uuid,uuid,uuid),secure_upload_private.attach_expense_receipt(jsonb),secure_upload_private.expense_receipt_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function secure_upload_private.attach_expense_receipt(jsonb),secure_upload_private.expense_receipt_history(uuid,uuid) to authenticated;
create function public.attach_finance_expense_receipt_artifact(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.attach_expense_receipt(_payload)$$;
create function public.get_finance_expense_receipt_artifacts(_tenant_id uuid,_expense_id uuid) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.expense_receipt_history(_tenant_id,_expense_id)$$;
revoke all on function public.attach_finance_expense_receipt_artifact(jsonb),public.get_finance_expense_receipt_artifacts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.attach_finance_expense_receipt_artifact(jsonb),public.get_finance_expense_receipt_artifacts(uuid,uuid) to authenticated;
