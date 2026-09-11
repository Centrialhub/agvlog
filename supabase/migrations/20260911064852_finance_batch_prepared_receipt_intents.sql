-- Prepared receipts: no new expense columns, no fabricated legacy paths.
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('finance_private.record_expense_batch(jsonb)');if p.oid is null or md5(p.prosrc) is distinct from '12ba2bbd2124da80810202c13ea9c160' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) or not has_function_privilege('authenticated',p.oid,'EXECUTE') then raise exception 'prepared_receipt_predecessor_changed:finance_private.record_expense_batch' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('finance_private.record_unloading(jsonb)');if p.oid is null or md5(p.prosrc) is distinct from '910f9ea51cac8a95ef74b9a0a708c942' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) or not has_function_privilege('authenticated',p.oid,'EXECUTE') then raise exception 'prepared_receipt_predecessor_changed:finance_private.record_unloading' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('finance_private.unloading_origin_base(uuid,uuid)');if p.oid is null or md5(p.prosrc) is distinct from '796c6798c4ea1bfb8239f75d31c3fae3' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner)) then raise exception 'prepared_receipt_predecessor_changed:finance_private.unloading_origin_base' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('finance_private.unloading_projection_repair_context(uuid,uuid)');if p.oid is null or md5(p.prosrc) is distinct from '25a40cb98b67e215523994866e2895fa' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner)) then raise exception 'prepared_receipt_predecessor_changed:finance_private.unloading_projection_repair_context' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('secure_upload_private.assert_source(uuid,text,uuid)');if p.oid is null or md5(p.prosrc) is distinct from '9c41a19882408ab13309998ea26ae16a' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner)) then raise exception 'prepared_receipt_predecessor_changed:secure_upload_private.assert_source' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('secure_upload_private.expense_receipt_count(uuid,uuid)');if p.oid is null or md5(p.prosrc) is distinct from '32926a664f753e8171e8e622c8bc4b93' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner)) then raise exception 'prepared_receipt_predecessor_changed:secure_upload_private.expense_receipt_count' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('secure_upload_private.expense_receipt_history(uuid,uuid)');if p.oid is null or md5(p.prosrc) is distinct from '0d53326bd64478412745ed1c283dcf01' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) or not has_function_privilege('authenticated',p.oid,'EXECUTE') then raise exception 'prepared_receipt_predecessor_changed:secure_upload_private.expense_receipt_history' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('secure_upload_private.expense_receipt_source(uuid,uuid,uuid)');if p.oid is null or md5(p.prosrc) is distinct from '5ee1399997a2c1409678559f06aa1603' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner)) then raise exception 'prepared_receipt_predecessor_changed:secure_upload_private.expense_receipt_source' using errcode='55000';end if;end$guard$;
do $guard$declare p record;begin select * into p from pg_proc where oid=to_regprocedure('secure_upload_private.reserve(jsonb)');if p.oid is null or md5(p.prosrc) is distinct from '3e5c879045979aa2baf65087b6f0eb0a' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) or not has_function_privilege('authenticated',p.oid,'EXECUTE') then raise exception 'prepared_receipt_predecessor_changed:secure_upload_private.reserve' using errcode='55000';end if;end$guard$;

do $guard$begin
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.finance_expense_items'::regclass and conname='finance_expense_items_check') is distinct from 'b72a632f12899cf7765a46b46770ed8f'
 or (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='secure_upload_private.artifacts'::regclass and conname='artifacts_source_type_check') is distinct from 'c21b6d36b4d6866b4c50ef121b69a0a2' then raise exception 'prepared_receipt_constraint_changed' using errcode='55000';end if;
end$guard$;
create table secure_upload_private.expense_receipt_intents(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid not null,request_id uuid not null,batch_request_id uuid not null,expense_id uuid not null,
 context text not null check(context in('trip','office','personnel','maintenance','other')),trip_id uuid,stop_id uuid,payload jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id),unique(tenant_id,id),check((context='trip')=(trip_id is not null)),check(context='trip' or stop_id is null)
);
create index expense_receipt_intent_batch on secure_upload_private.expense_receipt_intents(tenant_id,batch_request_id,expense_id);
alter table secure_upload_private.expense_receipt_intents enable row level security;
revoke all on secure_upload_private.expense_receipt_intents from public,anon,authenticated,service_role;
create trigger expense_receipt_intent_immutable before update or delete on secure_upload_private.expense_receipt_intents for each row execute function secure_upload_private.preserve_event();
create table secure_upload_private.expense_receipt_consumptions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,intent_id uuid not null,artifact_id uuid not null references secure_upload_private.artifacts(id),
 expense_id uuid not null references public.finance_expense_items(id),batch_id uuid not null references public.finance_expense_batches(id),batch_request_id uuid not null,actor_id uuid not null,
 receipt_link_id uuid not null references secure_upload_private.expense_receipts(id),source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,intent_id) references secure_upload_private.expense_receipt_intents(tenant_id,id),
 unique(tenant_id,intent_id),unique(tenant_id,artifact_id),unique(tenant_id,expense_id),unique(receipt_link_id)
);
alter table secure_upload_private.expense_receipt_consumptions enable row level security;
revoke all on secure_upload_private.expense_receipt_consumptions from public,anon,authenticated,service_role;
create trigger expense_receipt_consumption_immutable before update or delete on secure_upload_private.expense_receipt_consumptions for each row execute function secure_upload_private.preserve_event();
create table secure_upload_private.expense_receipt_batch_tickets(
 transaction_id bigint not null,tenant_id uuid not null,actor_id uuid not null,batch_request_id uuid not null,batch_id uuid not null,expense_id uuid not null,intent_id uuid not null,artifact_id uuid not null,
 source_snapshot jsonb not null,primary key(transaction_id,tenant_id,expense_id),unique(transaction_id,tenant_id,intent_id)
);
alter table secure_upload_private.expense_receipt_batch_tickets enable row level security;
revoke all on secure_upload_private.expense_receipt_batch_tickets from public,anon,authenticated,service_role;
create function secure_upload_private.prepare_expense_receipt_intent(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=(_payload->>'tenant_id')::uuid;actor uuid:=auth.uid();request uuid:=(_payload->>'request_id')::uuid;batch_request uuid:=(_payload->>'batch_request_id')::uuid;expense uuid:=(_payload->>'expense_id')::uuid;trip uuid:=(_payload->>'trip_id')::uuid;stop uuid:=(_payload->>'stop_id')::uuid;v secure_upload_private.expense_receipt_intents%rowtype;
begin
 perform finance_private.require_access(t);
 if actor is null or private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or request is null or batch_request is null or expense is null
 or not(_payload ?& array['version','tenant_id','request_id','batch_request_id','expense_id','context','trip_id','stop_id'])
 or coalesce(_payload->>'context','') not in('trip','office','personnel','maintenance','other') or ((_payload->>'context'='trip')<>(trip is not null)) or (_payload->>'context'<>'trip' and stop is not null)
 or exists(select 1 from jsonb_object_keys(_payload)k where k<>all(array['version','tenant_id','request_id','batch_request_id','expense_id','context','trip_id','stop_id'])) then raise exception 'upload_invalid_intent' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into v from secure_upload_private.expense_receipt_intents where tenant_id=t and request_id=request;
 if found then
  if v.actor_id<>actor or v.payload<>_payload then raise exception 'upload_request_conflict' using errcode='23505';end if;
 else
  if exists(select 1 from public.finance_expense_items where id=expense) or exists(select 1 from public.finance_commands where tenant_id=t and request_id=batch_request) then raise exception 'upload_expense_request_already_recorded' using errcode='23505';end if;
  if trip is not null then perform 1 from public.dispatch_trips where tenant_id=t and id=trip for share nowait;if not found then raise exception 'upload_source_unavailable' using errcode='42501';end if;end if;
  if stop is not null then perform 1 from public.dispatch_stops where tenant_id=t and id=stop and dispatch_trip_id=trip for share nowait;if not found then raise exception 'upload_source_unavailable' using errcode='42501';end if;end if;
  insert into secure_upload_private.expense_receipt_intents(tenant_id,actor_id,request_id,batch_request_id,expense_id,context,trip_id,stop_id,payload)
  values(t,actor,request,batch_request,expense,_payload->>'context',trip,stop,_payload) returning * into v;
 end if;
 return v.payload||jsonb_build_object('actor_id',v.actor_id,'intent_id',v.id);
exception when lock_not_available then raise exception 'upload_receipt_busy' using errcode='40001';
end$fn$;
revoke all on function secure_upload_private.prepare_expense_receipt_intent(jsonb) from public,anon,authenticated,service_role;
grant execute on function secure_upload_private.prepare_expense_receipt_intent(jsonb) to authenticated;
create function public.prepare_finance_expense_receipt_intent(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.prepare_expense_receipt_intent(_payload)$$;
revoke all on function public.prepare_finance_expense_receipt_intent(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_finance_expense_receipt_intent(jsonb) to authenticated;
alter table secure_upload_private.artifacts drop constraint artifacts_source_type_check;
alter table secure_upload_private.artifacts add constraint artifacts_source_type_check check(source_type in('trip','settlement','bank_account','expense_item','expense_draft'));

create function secure_upload_private.prepared_receipt_binding(t uuid,expense uuid,artifact uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from secure_upload_private.expense_receipt_consumptions c
 join secure_upload_private.expense_receipt_intents i on i.tenant_id=c.tenant_id and i.id=c.intent_id
 join secure_upload_private.artifacts a on a.tenant_id=c.tenant_id and a.id=c.artifact_id
 join secure_upload_private.expense_receipts r on r.tenant_id=c.tenant_id and r.id=c.receipt_link_id and r.expense_id=c.expense_id and r.artifact_id=c.artifact_id
 join public.finance_expense_items e on e.tenant_id=c.tenant_id and e.id=c.expense_id and e.batch_id=c.batch_id and e.created_by=c.actor_id
 where c.tenant_id=t and c.expense_id=expense and c.artifact_id=artifact and i.actor_id=c.actor_id and i.expense_id=expense and i.batch_request_id=c.batch_request_id
 and a.actor_id=c.actor_id and a.source_type='expense_draft' and a.source_id=i.id and c.source_snapshot=secure_upload_private.dto(a) and r.source_snapshot=c.source_snapshot and r.actor_id=c.actor_id)
$fn$;
revoke all on function secure_upload_private.prepared_receipt_binding(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function secure_upload_private.prepare_batch_receipt(t uuid,batch_request uuid,batch uuid,expense uuid,kind text,trip uuid,stop uuid,intent uuid,artifact uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare i secure_upload_private.expense_receipt_intents%rowtype;a secure_upload_private.artifacts%rowtype;proof jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into i from secure_upload_private.expense_receipt_intents where tenant_id=t and id=intent for update nowait;
 if not found or i.actor_id is distinct from auth.uid() or i.batch_request_id is distinct from batch_request or i.expense_id is distinct from expense or i.context is distinct from kind or i.trip_id is distinct from trip or i.stop_id is distinct from stop then raise exception 'upload_receipt_intent_mismatch' using errcode='42501';end if;
 if exists(select 1 from secure_upload_private.expense_receipt_consumptions where tenant_id=t and intent_id=intent) then raise exception 'upload_receipt_already_consumed' using errcode='23505';end if;
 select * into a from secure_upload_private.artifacts where tenant_id=t and id=artifact for share nowait;
 if not found or a.actor_id is distinct from auth.uid() or a.source_type is distinct from 'expense_draft' or a.source_id is distinct from intent then raise exception 'upload_receipt_source_mismatch' using errcode='42501';end if;
 proof:=secure_upload_private.validated_receipt_artifact(t,artifact);
 insert into secure_upload_private.expense_receipt_batch_tickets values(txid_current(),t,auth.uid(),batch_request,batch,expense,intent,artifact,proof);
end$fn$;
revoke all on function secure_upload_private.prepare_batch_receipt(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function secure_upload_private.unloading_receipt_ticket(t uuid,expense uuid,stop uuid,intent uuid,artifact uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare k secure_upload_private.expense_receipt_batch_tickets%rowtype;
begin
 select k0.* into k from secure_upload_private.expense_receipt_batch_tickets k0 join secure_upload_private.expense_receipt_intents i on i.tenant_id=k0.tenant_id and i.id=k0.intent_id
 where k0.transaction_id=txid_current() and k0.tenant_id=t and k0.expense_id=expense and k0.actor_id=auth.uid() and k0.intent_id=intent and k0.artifact_id=artifact and i.stop_id=stop and i.context='trip';
 if not found then raise exception 'upload_receipt_ticket_required' using errcode='55000';end if;
 return jsonb_build_object('version',2,'intent_id',intent,'artifact_id',artifact,'batch_request_id',k.batch_request_id,'expense_id',expense,'evidence',k.source_snapshot);
end$fn$;
revoke all on function secure_upload_private.unloading_receipt_ticket(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function secure_upload_private.consume_batch_receipt(t uuid,expense uuid,reason text) returns void language plpgsql security definer set search_path='' as $fn$
declare k secure_upload_private.expense_receipt_batch_tickets%rowtype;e public.finance_expense_items%rowtype;link uuid;
begin
 delete from secure_upload_private.expense_receipt_batch_tickets where transaction_id=txid_current() and tenant_id=t and expense_id=expense and actor_id=auth.uid() returning * into k;
 if not found then raise exception 'upload_receipt_ticket_required' using errcode='55000';end if;
 select * into e from public.finance_expense_items where tenant_id=t and id=expense;
 if not found or e.batch_id is distinct from k.batch_id or e.created_by is distinct from k.actor_id or e.receipt_path is not null or e.no_receipt_reason is not null then raise exception 'upload_receipt_expense_mismatch' using errcode='23514';end if;
 perform finance_private.require_access(t);
 insert into secure_upload_private.expense_receipts(tenant_id,expense_id,artifact_id,request_id,actor_id,reason,source_snapshot) values(t,expense,k.artifact_id,k.intent_id,k.actor_id,reason,k.source_snapshot) returning id into link;
 insert into secure_upload_private.expense_receipt_consumptions(tenant_id,intent_id,artifact_id,expense_id,batch_id,batch_request_id,actor_id,receipt_link_id,source_snapshot) values(t,k.intent_id,k.artifact_id,expense,k.batch_id,k.batch_request_id,k.actor_id,link,k.source_snapshot);
 insert into secure_upload_private.events(artifact_id,tenant_id,actor_id,action,snapshot) values(k.artifact_id,t,k.actor_id,'expense_receipt_attached',jsonb_build_object('link_id',link,'expense_id',expense,'request_id',k.intent_id,'batch_request_id',k.batch_request_id,'receipt_intent_id',k.intent_id,'reason',reason,'evidence',k.source_snapshot));
end$fn$;
revoke all on function secure_upload_private.consume_batch_receipt(uuid,uuid,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION secure_upload_private.validated_receipt_artifact(t uuid, artifact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a secure_upload_private.artifacts%rowtype;d jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into a from secure_upload_private.artifacts where id=artifact and tenant_id=t;
 if not found then raise exception 'upload_receipt_source_mismatch' using errcode='42501';end if;
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
end$function$;

revoke all on function secure_upload_private.validated_receipt_artifact(uuid,uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION secure_upload_private.assert_source(t uuid, kind text, source uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if kind='trip' then
  if not exists(select 1 from public.dispatch_trips where tenant_id=t and id=source) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 elsif kind='settlement' then
  if not exists(select 1 from public.driver_settlements where tenant_id=t and id=source) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 elsif kind='bank_account' then
  if not exists(select 1 from public.bank_accounts where tenant_id=t and id=source and active) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 elsif kind='expense_item' then
  if not exists(select 1 from public.finance_expense_items where tenant_id=t and id=source) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 elsif kind='expense_draft' then
  if not exists(select 1 from secure_upload_private.expense_receipt_intents where tenant_id=t and id=source) then raise exception 'upload_source_unavailable' using errcode='42501';end if;
 else raise exception 'upload_source_unavailable' using errcode='42501';end if;
end$function$;

CREATE OR REPLACE FUNCTION secure_upload_private.reserve(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if _payload->>'source_type'='expense_draft' then
  perform 1 from secure_upload_private.expense_receipt_intents where tenant_id=t and id=source and actor_id=actor for share nowait;
  if not found then raise exception 'upload_receipt_intent_mismatch' using errcode='42501';end if;
  if exists(select 1 from secure_upload_private.expense_receipt_consumptions where tenant_id=t and intent_id=source) then raise exception 'upload_receipt_already_consumed' using errcode='23505';end if;
 end if;
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
end$function$;

CREATE OR REPLACE FUNCTION secure_upload_private.expense_receipt_source(t uuid, expense uuid, artifact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a secure_upload_private.artifacts%rowtype;d jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform secure_upload_private.assert_source(t,'expense_item',expense);
 select * into a from secure_upload_private.artifacts where id=artifact and tenant_id=t;
 if not found or not((a.source_type='expense_item' and a.source_id=expense) or (a.source_type='expense_draft' and secure_upload_private.prepared_receipt_binding(t,expense,artifact))) then raise exception 'upload_receipt_source_mismatch' using errcode='42501';end if;
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
end$function$;

CREATE OR REPLACE FUNCTION secure_upload_private.expense_receipt_count(t uuid, expense uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select count(*) from secure_upload_private.expense_receipts r join secure_upload_private.artifacts a on a.tenant_id=r.tenant_id and a.id=r.artifact_id
 where r.tenant_id=t and r.expense_id=expense and ((a.source_type='expense_item' and a.source_id=expense) or (a.source_type='expense_draft' and secure_upload_private.prepared_receipt_binding(t,expense,a.id))) and a.state='sanitized_derivative' and a.original_received
 and a.method='jpeg-png-reencode-v1' and r.source_snapshot=secure_upload_private.dto(a)
 and exists(select 1 from storage.objects o where o.bucket_id='upload-validated' and o.name=a.derivative->>'path'
  and o.user_metadata @> jsonb_build_object('version',2,'artifact_id',a.id,'sha256',a.derivative->>'sha256','size_bytes',a.derivative->'size_bytes','kind','validated_derivative','original_sha256',a.original_sha256)
  and o.metadata->'size'=a.derivative->'size_bytes' and o.metadata->>'mimetype'=a.derivative->>'mime');
$function$;

CREATE OR REPLACE FUNCTION secure_upload_private.expense_receipt_history(t uuid, expense uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rows jsonb;
begin
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform secure_upload_private.assert_source(t,'expense_item',expense);
 select coalesce(jsonb_agg(jsonb_build_object('link_id',r.id,'artifact_id',r.artifact_id,'actor_id',r.actor_id,'request_id',r.request_id,'reason',r.reason,'created_at',r.created_at,'receipt_intent_id',case when r.source_snapshot->>'source_type'='expense_draft' then r.source_snapshot->'source_id' else null end,'evidence',secure_upload_private.expense_receipt_source(t,expense,r.artifact_id)) order by r.created_at,r.id),'[]') into rows from secure_upload_private.expense_receipts r where r.tenant_id=t and r.expense_id=expense;
 return jsonb_build_object('version',2,'tenant_id',t,'expense_id',expense,'receipts',rows);
end$function$;

CREATE OR REPLACE FUNCTION finance_private.record_expense_batch(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid; actor uuid:=auth.uid(); request uuid; trip uuid; driver uuid; batch uuid;
 existing public.finance_commands%rowtype; item jsonb; allocation jsonb; movement public.finance_movements%rowtype;
 cents bigint; allocated bigint; used bigint; linked bigint; expense uuid; payable uuid; unloading uuid;
 supplier uuid; cost_center uuid; supplier_name text; payee_name text; center_name text; actor_name text; result jsonb;
 rows jsonb:='[]'; discharge_result jsonb; context jsonb; receipt_intent uuid;receipt_artifact uuid;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;trip:=nullif(_payload->>'trip_id','')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1'
 or coalesce(_payload->>'context','') not in('trip','office','personnel','maintenance','other')
 or ((_payload->>'context'='trip')<>(trip is not null))
 or jsonb_typeof(_payload->'items') is distinct from 'array' or jsonb_array_length(_payload->'items') not between 1 and 200
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or length(btrim(coalesce(_payload->>'description',''))) not between 1 and 1000
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','context','trip_id','description','reason','items')) then
  raise exception 'finance_invalid_batch' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'record_expense_batch' or existing.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;
 end if;
 if trip is not null then
  select driver_id into driver from public.dispatch_trips where id=trip and tenant_id=t and status='completed' for share;
  if not found then raise exception 'finance_trip_not_completed' using errcode='22023';end if;
 end if;
 insert into public.finance_expense_batches(tenant_id,context,trip_id,driver_id,description,created_by)
 values(t,_payload->>'context',trip,driver,btrim(_payload->>'description'),actor) returning id into batch;
 for item in select value from jsonb_array_elements(_payload->'items') loop
  expense:=(item->>'id')::uuid; supplier:=nullif(item->>'supplier_id','')::uuid;
  cost_center:=nullif(item->>'cost_center_id','')::uuid;payable:=null;unloading:=null;
  if expense is null or jsonb_typeof(item) is distinct from 'object'
  or coalesce(item->>'amount_cents','') !~ '^[0-9]{1,14}$'
  or coalesce(item->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$'
  or length(btrim(coalesce(item->>'description',''))) not between 1 and 1000
  or jsonb_typeof(item->'allocations') is distinct from 'array' or jsonb_array_length(item->'allocations')>100
  or exists(select 1 from jsonb_object_keys(item) k where k not in('id','category','description','amount_cents','occurred_on',
   'supplier_id','supplier_name','cost_center_id','document_number','receipt_path','no_receipt_reason','due_date','allocations','stop_id','delivery_revision','payee_type','receipt_intent_id','receipt_artifact_id')) then
   raise exception 'finance_invalid_expense_item' using errcode='22023';end if;
  cents:=(item->>'amount_cents')::bigint;
  if cents<=0 or (item->>'occurred_on')::date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
   raise exception 'finance_invalid_expense_amount_or_date' using errcode='22023';end if;
  receipt_intent:=nullif(item->>'receipt_intent_id','')::uuid;receipt_artifact:=nullif(item->>'receipt_artifact_id','')::uuid;
  if (receipt_intent is null)<>(receipt_artifact is null) then raise exception 'upload_invalid_intent' using errcode='22023';end if;
  if receipt_intent is not null then
   if item->>'receipt_path' is not null or item->>'no_receipt_reason' is not null then raise exception 'upload_receipt_ambiguous_evidence' using errcode='22023';end if;
   perform secure_upload_private.prepare_batch_receipt(t,request,batch,expense,_payload->>'context',trip,nullif(item->>'stop_id','')::uuid,receipt_intent,receipt_artifact);
  elsif nullif(item->>'receipt_path','') is null then
   if length(btrim(coalesce(item->>'no_receipt_reason','')))<5 then raise exception 'finance_receipt_required' using errcode='22023';end if;
  elsif (item->>'receipt_path') not like t::text||'/%' or (item->>'receipt_path') like '%..%' then
   raise exception 'finance_invalid_receipt_scope' using errcode='22023';end if;
  supplier_name:=btrim(coalesce(item->>'supplier_name',''));
  if supplier is not null then
   select company_name into supplier_name from public.clients where id=supplier and tenant_id=t and active for share;
   if not found then raise exception 'finance_invalid_supplier' using errcode='22023';end if;
  end if;
  if supplier_name='' or supplier_name is null then raise exception 'finance_supplier_name_required' using errcode='22023';end if;
  center_name:=null;
  if cost_center is not null then
   select name into center_name from public.cost_centers where id=cost_center and tenant_id=t and active for share;
   if not found then raise exception 'finance_invalid_cost_center' using errcode='22023';end if;
  end if;
  allocated:=0;
  for allocation in select value from jsonb_array_elements(item->'allocations') loop
   if coalesce(allocation->>'amount_cents','') !~ '^[0-9]{1,14}$' then raise exception 'finance_invalid_allocation' using errcode='22023';end if;
   linked:=(allocation->>'amount_cents')::bigint;
   select * into movement from public.finance_movements where tenant_id=t and id=(allocation->>'movement_id')::uuid for share;
   if not found or movement.direction<>'out' or movement.nature='transfer'
    or (movement.driver_id is not null and movement.driver_id is distinct from driver) then
    raise exception 'finance_invalid_expense_movement' using errcode='22023';end if;
   select coalesce(sum(amount_cents),0) into used from public.finance_expense_allocations where tenant_id=t and movement_id=movement.id;
   if linked<=0 or used+linked>movement.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
   allocated:=allocated+linked;
  end loop;
  if allocated>cents then raise exception 'finance_expense_overallocated' using errcode='23514';end if;
  if item->>'category'='unloading' then
   if trip is null or nullif(item->>'stop_id','') is null then raise exception 'finance_unloading_delivery_required' using errcode='22023';end if;
   context:=finance_private.delivery_context(t,(item->>'stop_id')::uuid);
   if context->>'trip_id' is distinct from trip::text then raise exception 'finance_unloading_trip_mismatch' using errcode='22023';end if;
   discharge_result:=finance_private.record_unloading(jsonb_build_object('version',1,'tenant_id',t,'request_id',expense,
    'stop_id',item->>'stop_id','expected_revision',item->>'delivery_revision','amount_cents',cents,'occurred_on',item->>'occurred_on',
    'due_date',item->>'due_date','receipt_path',item->>'receipt_path','reason',_payload->>'reason')||case when receipt_intent is not null then jsonb_build_object('receipt_intent_id',receipt_intent,'receipt_artifact_id',receipt_artifact) else '{}'::jsonb end);
   unloading:=(discharge_result->>'charge_id')::uuid;
  end if;
  if allocated<cents then
   if coalesce(item->>'payee_type','') not in('driver','supplier') then
    raise exception 'finance_payee_required' using errcode='22023';end if;
   payee_name:=supplier_name;
   if item->>'payee_type'='driver' then
    select name into payee_name from public.drivers where id=driver and tenant_id=t;
    if not found then raise exception 'finance_invalid_payee' using errcode='22023';end if;
   end if;
   insert into public.payables(tenant_id,supplier_name,supplier_id,category,description,amount,due_date,competence_date,
    status,driver_id,dispatch_trip_id,document_number,receipt_url,created_by,source_table,source_id,cost_center)
   values(t,payee_name,case when item->>'payee_type'='supplier' then supplier end,
    case when item->>'category' in('fuel','toll','maintenance','payroll','tax','rent','service') then item->>'category' else 'other' end,
    item->>'description',(cents-allocated)::numeric/100,
    nullif(item->>'due_date','')::date,(item->>'occurred_on')::date,'pending',driver,trip,
    nullif(item->>'document_number',''),nullif(item->>'receipt_path',''),actor,'finance_expense_items',expense,center_name)
   returning id into payable;
  end if;
  insert into public.finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_id,supplier_name,
   cost_center_id,document_number,receipt_path,no_receipt_reason,payable_id,unloading_id,created_by)
  values(expense,t,batch,item->>'category',btrim(item->>'description'),cents,(item->>'occurred_on')::date,supplier,supplier_name,
   cost_center,nullif(item->>'document_number',''),nullif(item->>'receipt_path',''),nullif(item->>'no_receipt_reason',''),payable,unloading,actor);
  if receipt_intent is not null then perform secure_upload_private.consume_batch_receipt(t,expense,_payload->>'reason');end if;
  for allocation in select value from jsonb_array_elements(item->'allocations') loop
   insert into public.finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by)
   values(t,expense,(allocation->>'movement_id')::uuid,(allocation->>'amount_cents')::bigint,actor);
  end loop;
  rows:=rows||jsonb_build_array(jsonb_build_object('expense_id',expense,'payable_id',payable,'unloading_id',unloading));
 end loop;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'expense_batch',batch,'recorded',actor,coalesce(actor_name,actor::text),_payload->>'reason',_payload);
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'batch_id',batch,'rows',rows,'confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 values(t,request,actor,'record_expense_batch',_payload,result);
 return result;
end;
$function$;

CREATE OR REPLACE FUNCTION finance_private.record_unloading(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid; request uuid; actor uuid:=auth.uid(); stop uuid; context jsonb;
 existing public.finance_commands%rowtype; charge uuid; receivable uuid; cents bigint; result jsonb; receipt_intent uuid;receipt_artifact uuid;receipt_proof jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid; request:=(_payload->>'request_id')::uuid; stop:=(_payload->>'stop_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or stop is null or _payload->>'version' is distinct from '1'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in
 ('version','tenant_id','request_id','stop_id','expected_revision','amount_cents','occurred_on','due_date','receipt_path','reason','receipt_intent_id','receipt_artifact_id'))
 or coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or coalesce(_payload->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$'
 or ((_payload->>'receipt_artifact_id') is null and (coalesce(_payload->>'receipt_path','') not like t::text||'/%' or (_payload->>'receipt_path') like '%..%')) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 receipt_intent:=nullif(_payload->>'receipt_intent_id','')::uuid;receipt_artifact:=nullif(_payload->>'receipt_artifact_id','')::uuid;
 if (receipt_intent is null)<>(receipt_artifact is null) or (receipt_artifact is not null and _payload->>'receipt_path' is not null) then raise exception 'upload_invalid_intent' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);
 if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501'; end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'record_unloading' or existing.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;
 end if;
 perform 1 from public.dispatch_stops where id=stop and tenant_id=t for update;
 perform 1 from public.dispatch_stop_documents where dispatch_stop_id=stop and tenant_id=t for share;
 perform 1 from public.fiscal_documents f where f.tenant_id=t and exists(
  select 1 from public.dispatch_stop_documents d where d.dispatch_stop_id=stop and d.tenant_id=t and d.fiscal_document_id=f.id) for share;
 context:=finance_private.delivery_context(t,stop);
 if context->>'issue' is not null then raise exception 'finance_delivery_invalid: %',context->>'issue' using errcode='23514';end if;
 if context->>'revision' is distinct from _payload->>'expected_revision' then
  raise exception 'finance_delivery_changed' using errcode='40001';end if;
 if exists(select 1 from public.finance_unloading_charges where tenant_id=t and delivery_stop_id=(context->>'delivery_stop_id')::uuid) then
  raise exception 'finance_delivery_already_charged' using errcode='23505';end if;
 cents:=(_payload->>'amount_cents')::bigint;
 if cents<=0 or (_payload->>'occurred_on')::date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
  raise exception 'finance_invalid_unloading_amount_or_date' using errcode='22023';end if;
 if receipt_artifact is not null then
  receipt_proof:=secure_upload_private.unloading_receipt_ticket(t,request,stop,receipt_intent,receipt_artifact);
  context:=context||jsonb_build_object('receipt_evidence',receipt_proof);
 end if;
 perform finance_private.require_access(t);
 insert into public.receivables(tenant_id,client_id,description,amount,status,due_date,created_by)
 values(t,(context->>'supplier_id')::uuid,'Descarga — '||coalesce(context->>'destination','Entrega'),
  cents::numeric/100,'pending',nullif(_payload->>'due_date','')::date,actor) returning id into receivable;
 insert into public.finance_unloading_charges(tenant_id,delivery_stop_id,recorded_stop_id,supplier_id,
  amount_cents,occurred_on,receipt_path,receivable_id,source_snapshot,created_by)
 values(t,(context->>'delivery_stop_id')::uuid,stop,(context->>'supplier_id')::uuid,cents,
  (_payload->>'occurred_on')::date,_payload->>'receipt_path',receivable,context,actor) returning id into charge;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 select t,'unloading',charge,'recorded',actor,coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text),
  btrim(_payload->>'reason'),jsonb_build_object('context',context,'amount_cents',cents,'receivable_id',receivable)
 from auth.users u where u.id=actor;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'charge_id',charge,
  'receivable_id',receivable,'supplier_id',context->'supplier_id','confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 values(t,request,actor,'record_unloading',_payload,result);
 return result;
end;
$function$;

CREATE OR REPLACE FUNCTION finance_private.unloading_origin_base(_tenant uuid, _charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.finance_unloading_charges%rowtype;cmd public.finance_commands%rowtype;commands jsonb;events jsonb;proof boolean;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and id=_charge;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;

 select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') into commands from public.finance_commands x where tenant_id=_tenant and action='record_unloading' and x.result->>'charge_id'=c.id::text;
 select x.* into cmd from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c.id::text order by x.request_id limit 1;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into events from public.finance_events x where tenant_id=_tenant and entity_type='unloading' and entity_id=c.id and action='recorded';
 proof:=jsonb_array_length(commands)=1 and jsonb_array_length(events)=1
  and cmd.payload->>'tenant_id'=c.tenant_id::text and cmd.result->>'tenant_id'=c.tenant_id::text
  and cmd.actor_id=c.created_by and cmd.result->>'receivable_id'=c.receivable_id::text and cmd.result->>'supplier_id'=c.supplier_id::text
  and cmd.payload->>'amount_cents'=c.amount_cents::text and cmd.payload->>'occurred_on'=c.occurred_on::text
  and ((c.receipt_path is not null and cmd.payload->>'receipt_path'=c.receipt_path) or (c.receipt_path is null and secure_upload_private.unloading_prepared_receipt_proven(c.tenant_id,c.id,cmd.payload))) and cmd.payload->>'stop_id'=c.recorded_stop_id::text
  and cmd.payload->>'expected_revision'=c.source_snapshot->>'revision'
  and c.source_snapshot->>'supplier_id'=c.supplier_id::text and c.source_snapshot->>'delivery_stop_id'=c.delivery_stop_id::text
  and events#>'{0,after_data,context}'=c.source_snapshot
  and events#>>'{0,actor_id}'=c.created_by::text and events#>>'{0,after_data,receivable_id}'=c.receivable_id::text
  and events#>>'{0,after_data,amount_cents}'=c.amount_cents::text
  and exists(select 1 from public.clients where tenant_id=_tenant and id=c.supplier_id);

 return jsonb_build_object('origin_verified',coalesce(proof,false),'receivable_id',c.receivable_id,
 'original',jsonb_build_object('supplier_id',c.supplier_id,'supplier_name',c.source_snapshot->>'supplier_name','amount_cents',c.amount_cents::text),
 '_evidence',jsonb_build_object('charge',to_jsonb(c),'commands',commands,'events',events));
end$function$;

CREATE OR REPLACE FUNCTION finance_private.unloading_projection_repair_context(_tenant uuid, _charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.finance_unloading_charges%rowtype;r public.receivables%rowtype;cmd public.finance_commands%rowtype;
 commands jsonb;events jsonb;history jsonb;deps jsonb:='[]';blockers jsonb:='[]';evidence jsonb;result jsonb;proof boolean;rows jsonb;row_data jsonb;tab text;blocked boolean;reason text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and id=_charge;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;
 select * into r from public.receivables where tenant_id=_tenant and id=c.receivable_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') into commands from public.finance_commands x where tenant_id=_tenant and action='record_unloading' and x.result->>'charge_id'=c.id::text;
 select x.* into cmd from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c.id::text order by x.request_id limit 1;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into events from public.finance_events x where tenant_id=_tenant and entity_type='unloading' and entity_id=c.id and action='recorded';
 proof:=jsonb_array_length(commands)=1 and jsonb_array_length(events)=1
  and cmd.payload->>'tenant_id'=c.tenant_id::text and cmd.result->>'tenant_id'=c.tenant_id::text
  and cmd.actor_id=c.created_by and cmd.result->>'receivable_id'=c.receivable_id::text and cmd.result->>'supplier_id'=c.supplier_id::text
  and cmd.payload->>'amount_cents'=c.amount_cents::text and cmd.payload->>'occurred_on'=c.occurred_on::text
  and ((c.receipt_path is not null and cmd.payload->>'receipt_path'=c.receipt_path) or (c.receipt_path is null and secure_upload_private.unloading_prepared_receipt_proven(c.tenant_id,c.id,cmd.payload))) and cmd.payload->>'stop_id'=c.recorded_stop_id::text
  and cmd.payload->>'expected_revision'=c.source_snapshot->>'revision'
  and c.source_snapshot->>'supplier_id'=c.supplier_id::text and c.source_snapshot->>'delivery_stop_id'=c.delivery_stop_id::text
  and events#>'{0,after_data,context}'=c.source_snapshot
  and events#>>'{0,actor_id}'=c.created_by::text and events#>>'{0,after_data,receivable_id}'=c.receivable_id::text
  and events#>>'{0,after_data,amount_cents}'=c.amount_cents::text
  and exists(select 1 from public.clients where tenant_id=_tenant and id=c.supplier_id);
 if proof is distinct from true then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_origin_unverified','source_table','finance_unloading_charges','source_ids',jsonb_build_array(c.id)));end if;
 if r.id is null or r.status is distinct from 'pending' or coalesce(r.received_amount,0)<>0 or r.client_invoice_id is not null or r.closing_report_id is not null or to_jsonb(r)->>'fiscal_document_id' is not null or to_jsonb(r)->>'cte_document_id' is not null then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_state_requires_resolution','source_table','receivables','source_ids',jsonb_build_array(c.receivable_id)));
 end if;
 if r.client_id is not distinct from c.supplier_id and r.amount*100 is not distinct from c.amount_cents::numeric then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_already_matches','source_table','receivables','source_ids',jsonb_build_array(c.receivable_id)));end if;
 evidence:=jsonb_build_object('charge',to_jsonb(c),'receivable',to_jsonb(r),'commands',commands,'events',events);
 foreach tab in array array['receivables_payments','receivable_financial_commands','finance_customer_credits','finance_receivable_movement_links','finance_legacy_receipt_movement_links','finance_fiscal_receivable_origins','finance_expense_items','financial_obligations','payables','driver_settlement_items','payroll_entry_items','finance_account_period_dependencies','client_invoices','closing_reports'] loop
  if to_regclass('public.'||tab) is null then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_dependency_reader_missing','source_table',tab,'source_ids','[]'::jsonb));continue;
  end if;
  execute format($q$select coalesce(jsonb_agg(j order by j::text),'[]') from (select to_jsonb(x) j from public.%I x where tenant_id=$1) d
   where j->>'receivable_id'=$2 or j->>'unloading_id'=$3 or (j->>'source_table'='receivables' and j->>'source_id'=$2)
    or (j->>'source_kind'='receivables' and j->>'source_id'=$2)
    or j#>>'{metadata,receivable_id}'=$2
    or ($4 in('payables','financial_obligations','driver_settlement_items','payroll_entry_items') and exists(select 1 from public.finance_expense_items e where e.tenant_id=$1 and e.unloading_id=$3::uuid and (
     ($4='payables' and j->>'id'=e.payable_id::text) or (j->>'source_table'='finance_expense_items' and j->>'source_id'=e.id::text) or (j->>'source_table'='payables' and j->>'source_id'=e.payable_id::text))))$q$,tab) into rows using _tenant,c.receivable_id::text,c.id::text,tab;
  evidence:=evidence||jsonb_build_object(tab,rows);
  for row_data in select value from jsonb_array_elements(rows) loop
   blocked:=tab<>'finance_expense_items';
   if tab in('payables','financial_obligations','driver_settlement_items','payroll_entry_items') and row_data->>'receivable_id' is distinct from c.receivable_id::text and row_data#>>'{metadata,receivable_id}' is distinct from c.receivable_id::text and not(coalesce(row_data->>'source_table','')='receivables' and row_data->>'source_id'=c.receivable_id::text) then blocked:=false;end if;
   reason:=case when blocked then 'unloading_financial_history_requires_resolution' else 'unchanged_canonical_cost' end;
   if tab='finance_account_period_dependencies' and exists(select 1 from public.finance_account_period_reopenings where tenant_id=_tenant and closure_id=(row_data->>'closure_id')::uuid) then blocked:=false;reason:='reopened_period_history';end if;
   if tab='finance_expense_items' and row_data->>'amount_cents' is distinct from c.amount_cents::text then blocked:=true;reason:='unloading_cost_origin_mismatch';end if;
   deps:=deps||jsonb_build_array(jsonb_build_object('source_table',tab,'source_id',coalesce(row_data->>'id',row_data->>'command_id',row_data->>'closure_id'),'blocking',blocked,'reason',reason));
   if blocked then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',reason,'source_table',tab,'source_ids',jsonb_build_array(coalesce(row_data->>'id',row_data->>'command_id',row_data->>'closure_id'))));end if;
  end loop;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,
 'before',jsonb_build_object('client_id',x.before_data->'client_id','amount_cents',finance_private.unloading_repair_cents(x.before_data->'amount')),
 'after',jsonb_build_object('client_id',x.after_data->'client_id','amount_cents',finance_private.unloading_repair_cents(x.after_data->'amount'))) order by created_at,id),'[]') into history from public.finance_unloading_projection_repairs x where tenant_id=_tenant and charge_id=_charge;
 evidence:=evidence||jsonb_build_object('history',history);
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'charge_id',_charge,'receivable_id',c.receivable_id,'origin_verified',coalesce(proof,false),
  'original',jsonb_build_object('supplier_id',c.supplier_id,'supplier_name',c.source_snapshot->>'supplier_name','amount_cents',c.amount_cents::text,'delivery_stop_id',c.delivery_stop_id),
  'current',jsonb_build_object('receivable_id',c.receivable_id,'client_id',r.client_id,'amount_cents',finance_private.unloading_repair_cents(to_jsonb(r)->'amount'),'status',r.status),
  'target',jsonb_build_object('client_id',c.supplier_id,'amount_cents',c.amount_cents::text),'dependencies',deps,'blockers',blockers,
  'eligible',jsonb_array_length(blockers)=0,'can_repair',finance_private.can_repair_unloading(_tenant),'can_execute',false,'history',history,
  'effects',jsonb_build_object('cash_changed',false,'charge_changed',false,'cost_changed',false),'_evidence',evidence);

 if exists(select 1 from finance_private.unloading_origin_amendments where tenant_id=_tenant and charge_id=_charge) then
  result:=result||jsonb_build_object('eligible',false,'blockers',(result->'blockers')||jsonb_build_array(jsonb_build_object('code','unloading_origin_has_amendments','source_table','finance_unloading_charges','source_ids',jsonb_build_array(_charge))));
 end if;
 return result||jsonb_build_object('revision',md5(result::text));
end $function$;

create function secure_upload_private.unloading_prepared_receipt_proven(t uuid,charge uuid,command_payload jsonb) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.finance_unloading_charges c join public.finance_expense_items e on e.tenant_id=c.tenant_id and e.unloading_id=c.id
 join secure_upload_private.expense_receipt_consumptions x on x.tenant_id=e.tenant_id and x.expense_id=e.id
 join secure_upload_private.expense_receipt_intents i on i.tenant_id=x.tenant_id and i.id=x.intent_id
 where c.tenant_id=t and c.id=charge and c.receipt_path is null and command_payload->>'receipt_path' is null
 and command_payload->>'request_id'=e.id::text and command_payload->>'receipt_intent_id'=i.id::text and command_payload->>'receipt_artifact_id'=x.artifact_id::text
 and i.stop_id=c.recorded_stop_id and c.created_by=x.actor_id
 and c.source_snapshot->'receipt_evidence'=jsonb_build_object('version',2,'intent_id',i.id,'artifact_id',x.artifact_id,'batch_request_id',x.batch_request_id,'expense_id',e.id,'evidence',x.source_snapshot)
 and secure_upload_private.prepared_receipt_binding(t,e.id,x.artifact_id))
$fn$;
revoke all on function secure_upload_private.unloading_prepared_receipt_proven(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function secure_upload_private.guard_prepared_receipt_insert() returns trigger language plpgsql security definer set search_path='' as $fn$
declare k secure_upload_private.expense_receipt_batch_tickets%rowtype;
begin
 if tg_table_name='finance_expense_items' then
  if new.receipt_path is not null or coalesce(length(btrim(new.no_receipt_reason)),0)>=5 then return new;end if;
  select * into k from secure_upload_private.expense_receipt_batch_tickets where transaction_id=txid_current() and tenant_id=new.tenant_id and expense_id=new.id and batch_id=new.batch_id and actor_id=auth.uid();
  if not found or new.created_by is distinct from k.actor_id then raise exception 'upload_receipt_ticket_required' using errcode='55000';end if;
 else
  if new.receipt_path is not null then return new;end if;
  select * into k from secure_upload_private.expense_receipt_batch_tickets where transaction_id=txid_current() and tenant_id=new.tenant_id and actor_id=auth.uid()
   and intent_id::text=new.source_snapshot#>>'{receipt_evidence,intent_id}' and artifact_id::text=new.source_snapshot#>>'{receipt_evidence,artifact_id}';
  if not found or new.created_by is distinct from k.actor_id or new.source_snapshot->'receipt_evidence' is distinct from secure_upload_private.unloading_receipt_ticket(new.tenant_id,k.expense_id,new.recorded_stop_id,k.intent_id,k.artifact_id) then raise exception 'upload_receipt_ticket_required' using errcode='55000';end if;
 end if;
 return new;
end$fn$;
revoke all on function secure_upload_private.guard_prepared_receipt_insert() from public,anon,authenticated,service_role;
alter table public.finance_expense_items drop constraint finance_expense_items_check;
alter table public.finance_unloading_charges alter column receipt_path drop not null;
create trigger prepared_receipt_expense_insert before insert or update on public.finance_expense_items for each row execute function secure_upload_private.guard_prepared_receipt_insert();
create trigger prepared_receipt_unloading_insert before insert or update on public.finance_unloading_charges for each row execute function secure_upload_private.guard_prepared_receipt_insert();

create function secure_upload_private.check_prepared_receipt_commit() returns trigger language plpgsql security definer set search_path='' as $fn$
declare x secure_upload_private.expense_receipt_consumptions%rowtype;expense uuid;t uuid;c public.finance_commands%rowtype;proof jsonb;
begin
 if tg_table_name='expense_receipt_batch_tickets' then
  if exists(select 1 from secure_upload_private.expense_receipt_batch_tickets where transaction_id=new.transaction_id and tenant_id=new.tenant_id and expense_id=new.expense_id) then raise exception 'upload_receipt_ticket_unconsumed' using errcode='23514';end if;return null;
 elsif tg_table_name='finance_expense_items' then
  if new.receipt_path is not null or coalesce(length(btrim(new.no_receipt_reason)),0)>=5 then return null;end if;
  t:=new.tenant_id;expense:=new.id;
 else
  if new.receipt_path is not null then return null;end if;
  t:=new.tenant_id;select id into expense from public.finance_expense_items where tenant_id=t and unloading_id=new.id;
 end if;
 select * into x from secure_upload_private.expense_receipt_consumptions where tenant_id=t and expense_id=expense;
 if not found or not secure_upload_private.prepared_receipt_binding(t,expense,x.artifact_id) then raise exception 'upload_receipt_consumption_missing' using errcode='23514';end if;
 proof:=secure_upload_private.validated_receipt_artifact(t,x.artifact_id);
 if proof is distinct from x.source_snapshot then raise exception 'upload_receipt_consumption_changed' using errcode='23514';end if;
 select * into c from public.finance_commands where tenant_id=t and request_id=x.batch_request_id;
 if not found or c.action<>'record_expense_batch' or c.actor_id<>x.actor_id or c.result->>'batch_id' is distinct from x.batch_id::text
 or not exists(select 1 from jsonb_array_elements(c.payload->'items') item where item->>'id'=expense::text and item->>'receipt_artifact_id'=x.artifact_id::text and item->>'receipt_intent_id'=x.intent_id::text)
 then raise exception 'upload_receipt_batch_proof_missing' using errcode='23514';end if;
 return null;
end$fn$;
revoke all on function secure_upload_private.check_prepared_receipt_commit() from public,anon,authenticated,service_role;
create constraint trigger prepared_receipt_expense_complete after insert or update on public.finance_expense_items deferrable initially deferred for each row execute function secure_upload_private.check_prepared_receipt_commit();
create constraint trigger prepared_receipt_unloading_complete after insert or update on public.finance_unloading_charges deferrable initially deferred for each row execute function secure_upload_private.check_prepared_receipt_commit();
create constraint trigger prepared_receipt_ticket_complete after insert on secure_upload_private.expense_receipt_batch_tickets deferrable initially deferred for each row execute function secure_upload_private.check_prepared_receipt_commit();

