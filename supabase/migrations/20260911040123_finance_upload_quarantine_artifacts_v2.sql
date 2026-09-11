-- Quarantine is not an antivirus verdict. Originals never become browser evidence.
create schema secure_upload_private;
revoke all on schema secure_upload_private from public,anon,authenticated,service_role;
grant usage on schema secure_upload_private to authenticated,service_role;
create table secure_upload_private.artifacts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references auth.users(id),request_id uuid not null,source_type text not null check(source_type in('trip','settlement','bank_account')),source_id uuid not null,
 identity jsonb not null,original_path text not null unique,original_sha256 text not null check(original_sha256~'^[a-f0-9]{64}$'),
 original_size bigint not null check(original_size between 1 and 10485760),declared_mime text not null,format text not null,
 state text not null default 'quarantined' check(state in('quarantined','validated_data','sanitized_derivative','rejected','validation_failed')),
 original_received boolean not null default false,method text,derivative jsonb,issues jsonb not null default '[]' check(jsonb_typeof(issues)='array'),
 authorization_expires_at timestamptz not null,authorization_revision text not null,ticket uuid not null default gen_random_uuid(),
 final_payload jsonb,created_at timestamptz not null default clock_timestamp(),validated_at timestamptz,
 unique(tenant_id,request_id),check(derivative is null or state in('validated_data','sanitized_derivative'))
);
create table secure_upload_private.events(
 id bigint generated always as identity primary key,artifact_id uuid not null references secure_upload_private.artifacts(id),
 tenant_id uuid not null,actor_id uuid not null,action text not null,snapshot jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table secure_upload_private.artifacts enable row level security;
alter table secure_upload_private.events enable row level security;
revoke all on all tables in schema secure_upload_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema secure_upload_private from public,anon,authenticated,service_role;
create function secure_upload_private.preserve_event() returns trigger language plpgsql set search_path='' as $$begin raise exception 'upload_event_immutable' using errcode='55000';end$$;
create trigger upload_event_immutable before update or delete on secure_upload_private.events for each row execute function secure_upload_private.preserve_event();
create function secure_upload_private.authorization_revision() returns text language sql stable security definer set search_path='' as $$
 select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text,'|' order by p.oid)) from pg_proc p where p.oid in(
 'finance_private.can_access(uuid)'::regprocedure,'finance_private.not_driver(uuid)'::regprocedure,
 'private.request_tenant_id()'::regprocedure,'private.is_request_tenant_member(uuid)'::regprocedure);
$$;
create function secure_upload_private.dto(a secure_upload_private.artifacts) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version',2,'tenant_id',a.tenant_id,'actor_id',a.actor_id,'request_id',a.request_id,'artifact_id',a.id,
 'source_type',a.source_type,'source_id',a.source_id,'state',a.state,'original',jsonb_build_object('sha256',a.original_sha256,'size_bytes',a.original_size,'format',a.format,'received',a.original_received),
 'usable',a.state in('validated_data','sanitized_derivative') and a.derivative is not null,'derivative',a.derivative,'issues',a.issues);
$$;
create function secure_upload_private.assert_source(t uuid,kind text,source uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if kind='trip' then
  if not exists(select 1 from public.dispatch_trips where tenant_id=t and id=source) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 elsif kind='settlement' then
  if not exists(select 1 from public.driver_settlements where tenant_id=t and id=source) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 elsif kind='bank_account' then
  if not exists(select 1 from public.bank_accounts where tenant_id=t and id=source and active) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 else raise exception 'upload_source_unavailable' using errcode='42501';end if;
end$$;
create function secure_upload_private.reserve(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();request uuid;source uuid;a secure_upload_private.artifacts%rowtype;identity jsonb;
begin
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;source:=(_payload->>'source_id')::uuid;
 perform finance_private.require_access(t);
 if actor is null or private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '2'::jsonb or request is null or source is null
  or coalesce(_payload->>'original_sha256','')!~'^[a-f0-9]{64}$' or coalesce(_payload->>'size_bytes','')!~'^[1-9][0-9]{0,7}$'
  or (_payload->>'size_bytes')::bigint>10485760 or length(coalesce(_payload->>'declared_mime','')) not between 1 and 150
  or coalesce(_payload->>'format','') not in('ofx','csv','jpeg','png','pdf','xls','xlsx','unknown')
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','source_type','source_id','original_sha256','size_bytes','declared_mime','format']))
 then raise exception 'upload_invalid_identity' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));perform finance_private.require_access(t);
 perform secure_upload_private.assert_source(t,_payload->>'source_type',source);
 identity:=_payload||jsonb_build_object('actor_id',actor);
 select * into a from secure_upload_private.artifacts where tenant_id=t and request_id=request for update;
 if found then
  if a.identity<>identity then raise exception 'upload_request_conflict' using errcode='23505';end if;
  update secure_upload_private.artifacts set ticket=case when state in('quarantined','validation_failed') and final_payload is not null then gen_random_uuid() else ticket end,final_payload=case when state in('quarantined','validation_failed') then null else final_payload end,authorization_expires_at=clock_timestamp()+interval '120 seconds',authorization_revision=secure_upload_private.authorization_revision() where id=a.id returning * into a;
 else
  insert into secure_upload_private.artifacts(tenant_id,actor_id,request_id,source_type,source_id,identity,original_path,original_sha256,original_size,declared_mime,format,authorization_expires_at,authorization_revision)
  values(t,actor,request,_payload->>'source_type',source,identity,t::text||'/'||request::text||'/original',_payload->>'original_sha256',(_payload->>'size_bytes')::bigint,_payload->>'declared_mime',_payload->>'format',clock_timestamp()+interval '120 seconds',secure_upload_private.authorization_revision()) returning * into a;
 end if;
 insert into secure_upload_private.events(artifact_id,tenant_id,actor_id,action,snapshot) values(a.id,t,actor,'authorization_reserved',jsonb_build_object('identity',identity,'expires_at',a.authorization_expires_at,'authorization_revision',a.authorization_revision));
 return secure_upload_private.dto(a);
end$$;
create function secure_upload_private.assert_service_authorization(a secure_upload_private.artifacts) returns void language plpgsql security definer set search_path='' as $$
begin
 if a.authorization_expires_at<=clock_timestamp() or a.authorization_revision is distinct from secure_upload_private.authorization_revision() then raise exception 'upload_authorization_expired' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=a.tenant_id and user_id=a.actor_id order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=a.tenant_id and user_id=a.actor_id order by id for share nowait;
 if not exists(select 1 from public.tenant_memberships where tenant_id=a.tenant_id and user_id=a.actor_id and active and role::text in('owner','admin','operator'))
  or exists(select 1 from public.tenant_memberships where tenant_id=a.tenant_id and user_id=a.actor_id and active and role::text='driver')
  or exists(select 1 from public.drivers where tenant_id=a.tenant_id and user_id=a.actor_id and active)
  or not exists(select 1 from auth.users where id=a.actor_id)
 then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform secure_upload_private.assert_source(a.tenant_id,a.source_type,a.source_id);
end$$;
create function secure_upload_private.prepare(_artifact_id uuid,_tenant_id uuid,_actor_id uuid,_sha256 text,_size_bytes bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare a secure_upload_private.artifacts%rowtype;
begin
 select * into a from secure_upload_private.artifacts where id=_artifact_id and tenant_id=_tenant_id and actor_id=_actor_id;
 if not found or a.original_sha256 is distinct from _sha256 or a.original_size is distinct from _size_bytes then raise exception 'upload_identity_mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text||':finance',0));
 select * into a from secure_upload_private.artifacts where id=_artifact_id for update;
 perform secure_upload_private.assert_service_authorization(a);
 return jsonb_build_object('version',2,'artifact_id',a.id,'ticket',a.ticket,'original_bucket','upload-quarantine','original_path',a.original_path,
  'derived_bucket','upload-validated','derived_prefix',a.tenant_id::text||'/'||a.request_id::text||'/validated','expires_at',a.authorization_expires_at,'result',secure_upload_private.dto(a));
end$$;
create function secure_upload_private.finalize(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<validation>>
declare a secure_upload_private.artifacts%rowtype;d jsonb;state text:=_payload->>'state';method text:=_payload->>'method';obj jsonb;expected_path text;mime text;
begin
 select * into a from secure_upload_private.artifacts where id=(_payload->>'artifact_id')::uuid;
 if not found then raise exception 'upload_identity_mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text||':finance',0));select * into a from secure_upload_private.artifacts where id=a.id for update;
 perform secure_upload_private.assert_service_authorization(a);
 if (_payload->>'ticket')::uuid is distinct from a.ticket then raise exception 'upload_identity_mismatch' using errcode='42501';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '2'::jsonb or state is null or state not in('quarantined','validated_data','sanitized_derivative','rejected','validation_failed')
  or jsonb_typeof(_payload->'issues') is distinct from 'array' or jsonb_array_length(_payload->'issues')>30
  or exists(select 1 from jsonb_array_elements(_payload->'issues') x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>200)
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','artifact_id','ticket','state','method','derivative','issues']))
 then raise exception 'upload_invalid_validation' using errcode='22023';end if;
 if a.final_payload is not null then
  if a.final_payload<>_payload then raise exception 'upload_validation_conflict' using errcode='23505';end if;return secure_upload_private.dto(a);
 end if;
 select to_jsonb(o) into obj from storage.objects o where bucket_id='upload-quarantine' and name=a.original_path for share;
 if obj is null or not coalesce((obj->'user_metadata')@>jsonb_build_object('version',2,'artifact_id',a.id,'sha256',a.original_sha256,'size_bytes',a.original_size,'kind','quarantine_original'),false)
  or obj#>>'{metadata,size}' is distinct from a.original_size::text then raise exception 'upload_original_unconfirmed' using errcode='23514';end if;
 d:=nullif(_payload->'derivative','null'::jsonb);
 if state in('validated_data','sanitized_derivative') then
  if state='validated_data' then
   if not((a.format='ofx' and method='native-ofx-v1') or (a.format='csv' and method='strict-csv-matrix-v1')) then raise exception 'upload_validation_method_invalid' using errcode='23514';end if;
   expected_path:=a.tenant_id::text||'/'||a.request_id::text||'/validated.json';mime:='application/json';
  else
   -- Image decoding is not available until a reviewed implementation is enabled.
   raise exception 'upload_image_sanitizer_not_enabled' using errcode='55000';
  end if;
  if d is null or jsonb_typeof(d)<>'object' or d->>'bucket' is distinct from 'upload-validated' or d->>'path' is distinct from expected_path or d->>'mime' is distinct from mime
   or coalesce(d->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce(d->>'size_bytes','')!~'^[1-9][0-9]{0,7}$' or (d->>'size_bytes')::bigint>20971520
   or d->>'method' is distinct from method or d->'financial_mapping_required' is distinct from to_jsonb(a.format='csv')
   or exists(select 1 from jsonb_object_keys(d) k where k<>all(array['bucket','path','sha256','size_bytes','mime','method','financial_mapping_required'])) then raise exception 'upload_derivative_invalid' using errcode='23514';end if;
  select to_jsonb(o) into obj from storage.objects o where bucket_id='upload-validated' and name=expected_path for share;
  if obj is null or not coalesce((obj->'user_metadata')@>jsonb_build_object('version',2,'artifact_id',a.id,'sha256',d->>'sha256','size_bytes',(d->>'size_bytes')::bigint,'kind','validated_derivative','original_sha256',a.original_sha256),false)
   or obj#>>'{metadata,size}' is distinct from d->>'size_bytes' or obj#>>'{metadata,mimetype}' is distinct from mime then raise exception 'upload_derivative_unconfirmed' using errcode='23514';end if;
 elsif d is not null then raise exception 'upload_derivative_invalid' using errcode='23514';end if;
 perform secure_upload_private.assert_service_authorization(a);
 update secure_upload_private.artifacts set state=validation.state,method=validation.method,derivative=d,issues=_payload->'issues',original_received=true,validated_at=clock_timestamp(),final_payload=_payload where id=a.id returning * into a;
 insert into secure_upload_private.events(artifact_id,tenant_id,actor_id,action,snapshot) values(a.id,a.tenant_id,a.actor_id,'validation_recorded',jsonb_build_object('result',secure_upload_private.dto(a),'method',method,'antivirus_attested',false));
 return secure_upload_private.dto(a);
end$$;
create function secure_upload_private.read_artifact(_tenant_id uuid,_artifact_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a secure_upload_private.artifacts%rowtype;begin
 perform finance_private.require_access(_tenant_id);if private.request_tenant_id() is distinct from _tenant_id then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into a from secure_upload_private.artifacts where tenant_id=_tenant_id and id=_artifact_id;
 if not found then raise exception 'upload_not_found' using errcode='42501';end if;return secure_upload_private.dto(a);
end$$;
create function secure_upload_private.can_read_derivative(_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from secure_upload_private.artifacts a where a.derivative->>'path'=_path and a.state in('validated_data','sanitized_derivative') and a.original_received and private.request_tenant_id()=a.tenant_id and finance_private.can_access(a.tenant_id));
$$;
create function secure_upload_private.preserve_object() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.bucket_id in('upload-quarantine','upload-validated') or (tg_op='UPDATE' and new.bucket_id in('upload-quarantine','upload-validated')) then raise exception 'upload_artifact_object_immutable' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger secure_upload_artifact_object_immutable before update or delete on storage.objects for each row execute function secure_upload_private.preserve_object();
insert into storage.buckets(id,name,public,file_size_limit) values('upload-quarantine','upload-quarantine',false,10485760),('upload-validated','upload-validated',false,20971520);
create policy quarantine_browser_deny on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'upload-quarantine') with check(bucket_id<>'upload-quarantine');
create policy derivative_browser_read on storage.objects for select to authenticated using(bucket_id='upload-validated' and secure_upload_private.can_read_derivative(name));
create policy derivative_read_boundary on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'upload-validated' or secure_upload_private.can_read_derivative(name));
create policy derivative_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'upload-validated');
create policy derivative_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'upload-validated') with check(bucket_id<>'upload-validated');
create policy derivative_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'upload-validated');
revoke all on all functions in schema secure_upload_private from public,anon,authenticated,service_role;
grant execute on function secure_upload_private.reserve(jsonb),secure_upload_private.read_artifact(uuid,uuid),secure_upload_private.can_read_derivative(text) to authenticated;
grant execute on function secure_upload_private.can_read_derivative(text) to anon;
grant usage on schema secure_upload_private to anon;
grant execute on function secure_upload_private.prepare(uuid,uuid,uuid,text,bigint),secure_upload_private.finalize(jsonb) to service_role;
create function public.reserve_finance_upload_artifact(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.reserve(_payload)$$;
create function public.prepare_finance_upload_artifact(_artifact_id uuid,_tenant_id uuid,_actor_id uuid,_sha256 text,_size_bytes bigint) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.prepare(_artifact_id,_tenant_id,_actor_id,_sha256,_size_bytes)$$;
create function public.finalize_finance_upload_artifact(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.finalize(_payload)$$;
create function public.get_finance_upload_artifact(_tenant_id uuid,_artifact_id uuid) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.read_artifact(_tenant_id,_artifact_id)$$;
revoke all on function public.reserve_finance_upload_artifact(jsonb),public.prepare_finance_upload_artifact(uuid,uuid,uuid,text,bigint),public.finalize_finance_upload_artifact(jsonb),public.get_finance_upload_artifact(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reserve_finance_upload_artifact(jsonb),public.get_finance_upload_artifact(uuid,uuid) to authenticated;
grant execute on function public.prepare_finance_upload_artifact(uuid,uuid,uuid,text,bigint),public.finalize_finance_upload_artifact(jsonb) to service_role;
