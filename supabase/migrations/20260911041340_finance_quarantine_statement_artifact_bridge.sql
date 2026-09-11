-- Additive v2 entry points. Existing v1 writers, evidence and captured baselines remain unchanged.
create table secure_upload_private.statement_authorizations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,actor_id uuid not null,import_id uuid not null,artifact_id uuid not null references secure_upload_private.artifacts(id),
 expires_at timestamptz not null,authorization_revision text not null,created_at timestamptz not null default clock_timestamp()
);
alter table secure_upload_private.statement_authorizations enable row level security;
revoke all on secure_upload_private.statement_authorizations from public,anon,authenticated,service_role;
create trigger statement_authorization_immutable before update or delete on secure_upload_private.statement_authorizations for each row execute function secure_upload_private.preserve_event();
create function secure_upload_private.statement_source(t uuid,account uuid,artifact uuid,original_hash text,derived_path text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a secure_upload_private.artifacts%rowtype;obj jsonb;
begin
 perform finance_private.require_access(t);if private.request_tenant_id() is distinct from t then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into a from secure_upload_private.artifacts where tenant_id=t and id=artifact;
 if not found or a.source_type<>'bank_account' or a.source_id is distinct from account or a.state<>'validated_data' or not a.original_received
  or a.format not in('ofx','csv') or a.original_sha256 is distinct from original_hash or a.derivative->>'path' is distinct from derived_path or a.derivative->>'bucket' is distinct from 'upload-validated'
  then raise exception 'finance_statement_artifact_unavailable' using errcode='23514';end if;
 select to_jsonb(o) into obj from storage.objects o where bucket_id='upload-validated' and name=derived_path;
 if obj is null or not coalesce((obj->'user_metadata')@>jsonb_build_object('version',2,'artifact_id',a.id,'sha256',a.derivative->>'sha256','original_sha256',a.original_sha256,'kind','validated_derivative'),false)
  or obj#>>'{metadata,size}' is distinct from a.derivative->>'size_bytes' or obj#>>'{metadata,mimetype}' is distinct from 'application/json'
 then raise exception 'finance_statement_artifact_changed' using errcode='23514';end if;
 return obj||jsonb_build_object('artifact',jsonb_build_object('version',2,'artifact_id',a.id,'tenant_id',a.tenant_id,'source_type',a.source_type,'source_id',a.source_id,
  'original',jsonb_build_object('sha256',a.original_sha256,'size_bytes',a.original_size,'format',a.format),'derivative',a.derivative,'state',a.state,'validated_at',a.validated_at));
end$$;
create function secure_upload_private.authorize_statement_verification(_tenant_id uuid,_import_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.finance_statement_imports%rowtype;evidence jsonb;a secure_upload_private.statement_authorizations%rowtype;
begin
 perform finance_private.require_access(_tenant_id);if private.request_tenant_id() is distinct from _tenant_id then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));perform finance_private.require_access(_tenant_id);
 select * into s from public.finance_statement_imports where tenant_id=_tenant_id and id=_import_id;
 if not found or s.source_snapshot#>>'{artifact,version}' is distinct from '2' then raise exception 'finance_statement_artifact_unavailable' using errcode='23514';end if;
 evidence:=secure_upload_private.statement_source(_tenant_id,s.bank_account_id,(s.source_snapshot#>>'{artifact,artifact_id}')::uuid,s.file_hash,s.source_path);
 if evidence->'artifact' is distinct from s.source_snapshot->'artifact' then raise exception 'finance_statement_artifact_changed' using errcode='23514';end if;
 insert into secure_upload_private.statement_authorizations(tenant_id,actor_id,import_id,artifact_id,expires_at,authorization_revision)
 values(_tenant_id,auth.uid(),_import_id,(evidence#>>'{artifact,artifact_id}')::uuid,clock_timestamp()+interval '120 seconds',secure_upload_private.authorization_revision()) returning * into a;
 insert into secure_upload_private.events(artifact_id,tenant_id,actor_id,action,snapshot) values(a.artifact_id,a.tenant_id,a.actor_id,'statement_verification_authorized',jsonb_build_object('authorization_id',a.id,'import_id',a.import_id,'expires_at',a.expires_at));
 return jsonb_build_object('version',2,'authorization_id',a.id,'expires_at',a.expires_at,'artifact_id',a.artifact_id);
end$$;
-- Copy the current reviewed implementations rather than altering baseline-captured v1 routines.
do $bridge$
declare p record;b text;d text;needle text;
begin
 select * into p from pg_proc where oid='finance_private.intake_statement(jsonb)'::regprocedure;
 if md5(pg_get_functiondef(p.oid))<>'c8756c63d59d2d5a533e344f9ebd50f9' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee not in(p.proowner,(select oid from pg_roles where rolname='authenticated')))
  or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute')
 then raise exception 'finance_artifact_intake_predecessor_changed';end if;
 d:=pg_get_functiondef(p.oid);b:=p.prosrc;
 b:=replace(b,$n$_payload->>'version' is distinct from '1'$n$,$n$_payload->>'version' is distinct from '2'$n$);
 needle:=$n$coalesce(path,'')!~('^'||t::text||'/imports/'||hash||'\.(csv|xlsx|xls|ofx)$')$n$;
 if position(needle in b)=0 then raise exception 'finance_artifact_intake_path_contract_changed';end if;
 b:=replace(b,needle,$n$nullif(_payload->>'artifact_id','') is null$n$);
 b:=replace(b,$n$'reason','file_name'))$n$,$n$'reason','file_name','artifact_id'))$n$);
 needle:=$n$select to_jsonb(o) into source from storage.objects o where o.bucket_id='finance-statements' and o.name=path for share nowait;$n$;
 if position(needle in b)=0 then raise exception 'finance_artifact_intake_source_contract_changed';end if;
 b:=replace(b,needle,$n$source:=secure_upload_private.statement_source(t,account,(_payload->>'artifact_id')::uuid,hash,path);
 if (source#>>'{artifact,original,format}'='ofx' and _payload->>'parser_version'<>'native-ofx-v1') or (source#>>'{artifact,original,format}'='csv' and _payload->>'parser_version'<>'mapped-csv-v1') then raise exception 'finance_artifact_parser_mismatch' using errcode='23514';end if;$n$);
 needle:=$n$perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));$n$;
 b:=replace(b,needle,needle||E'\n perform finance_private.require_access(t);if private.request_tenant_id() is distinct from t then raise exception ''finance_access_denied'' using errcode=''42501'';end if;');
 d:=replace(d,'finance_private.intake_statement(', 'finance_private.intake_statement_artifact(');execute replace(d,p.prosrc,b);
 select * into p from pg_proc where oid='finance_private.record_statement_verification(jsonb)'::regprocedure;
 if md5(pg_get_functiondef(p.oid))<>'073ca108bfb00c0e82b7539864e14b79' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee not in(p.proowner,(select oid from pg_roles where rolname='service_role')))
  or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_artifact_verifier_predecessor_changed';end if;
 d:=pg_get_functiondef(p.oid);b:=replace(p.prosrc,'''statement-source-v1''','''statement-artifact-v2''');
 b:=replace(b,'Conferência no servidor contra arquivo original preservado','Conferência do derivado validado vinculado ao hash original preservado');
 d:=replace(d,'finance_private.record_statement_verification(', 'finance_private.record_statement_artifact_verification_core(');execute replace(d,p.prosrc,b);
end;$bridge$;
revoke all on function finance_private.intake_statement_artifact(jsonb),finance_private.record_statement_artifact_verification_core(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.intake_statement_artifact(jsonb) to authenticated;
create function secure_upload_private.record_statement_verification(_payload jsonb,_authorization_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u secure_upload_private.statement_authorizations%rowtype;a secure_upload_private.artifacts%rowtype;s public.finance_statement_imports%rowtype;result jsonb;
begin
 select * into u from secure_upload_private.statement_authorizations where id=_authorization_id;
 if not found or u.tenant_id is distinct from (_payload->>'tenant_id')::uuid or u.actor_id is distinct from (_payload->>'actor_id')::uuid or u.import_id is distinct from (_payload->>'import_id')::uuid then raise exception 'upload_identity_mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(u.tenant_id::text||':finance',0));
 select * into a from secure_upload_private.artifacts where id=u.artifact_id and tenant_id=u.tenant_id;
 if not found then raise exception 'finance_statement_artifact_unavailable' using errcode='23514';end if;
 -- A different current operator may verify; the original upload actor remains unchanged.
 a.actor_id:=u.actor_id;a.authorization_expires_at:=u.expires_at;a.authorization_revision:=u.authorization_revision;
 perform secure_upload_private.assert_service_authorization(a);
 select * into s from public.finance_statement_imports where tenant_id=u.tenant_id and id=u.import_id;
 if not found or a.state<>'validated_data' or not a.original_received or s.source_snapshot#>>'{artifact,artifact_id}' is distinct from a.id::text or s.file_hash is distinct from a.original_sha256 or s.source_path is distinct from a.derivative->>'path'
  or _payload->>'reader_version' is distinct from 'statement-artifact-v2'
  or _payload#>>'{report,artifact_id}' is distinct from a.id::text or _payload#>>'{report,original_sha256}' is distinct from a.original_sha256
  or _payload#>>'{report,derivative_sha256}' is distinct from a.derivative->>'sha256'
  or (_payload->>'outcome' in('rows_match','rows_mismatch') and _payload#>'{report,derivative_hash_verified}' is distinct from 'true'::jsonb) or _payload#>'{report,original_reopened}' is distinct from 'false'::jsonb
  or _payload#>>'{report,validation_method}' is distinct from a.method
 then raise exception 'finance_artifact_verification_identity_changed' using errcode='23514';end if;
 result:=finance_private.record_statement_artifact_verification_core(_payload);
 perform secure_upload_private.assert_service_authorization(a);
 return result;
end$$;
revoke all on function secure_upload_private.statement_source(uuid,uuid,uuid,text,text),secure_upload_private.authorize_statement_verification(uuid,uuid),secure_upload_private.record_statement_verification(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function secure_upload_private.authorize_statement_verification(uuid,uuid) to authenticated;
grant execute on function secure_upload_private.record_statement_verification(jsonb,uuid) to service_role;
create function public.intake_finance_statement_artifact(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.intake_statement_artifact(_payload)$$;
create function public.authorize_finance_statement_artifact_verification(_tenant_id uuid,_import_id uuid) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.authorize_statement_verification(_tenant_id,_import_id)$$;
create function public.record_finance_statement_artifact_verification(_payload jsonb,_authorization_id uuid) returns jsonb language sql security invoker set search_path='' as $$select secure_upload_private.record_statement_verification(_payload,_authorization_id)$$;
revoke all on function public.intake_finance_statement_artifact(jsonb),public.authorize_finance_statement_artifact_verification(uuid,uuid),public.record_finance_statement_artifact_verification(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.intake_finance_statement_artifact(jsonb),public.authorize_finance_statement_artifact_verification(uuid,uuid) to authenticated;
grant execute on function public.record_finance_statement_artifact_verification(jsonb,uuid) to service_role;
