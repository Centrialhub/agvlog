-- Reviewed hosted codec results: docs/qa/finance-image-hosted-benchmark-2026-09-11.json.
-- Only finite JPEG/PNG decode/reencode evidence. Never an antivirus attestation.
do $enable$
declare body text;needle text:=$needle$   -- Image decoding is not available until a reviewed implementation is enabled.
   raise exception 'upload_image_sanitizer_not_enabled' using errcode='55000';$needle$;replacement text:=$replacement$   if a.format not in('jpeg','png') or method is distinct from 'jpeg-png-reencode-v1' or a.original_size>5242880 then raise exception 'upload_validation_method_invalid' using errcode='23514';end if;
   expected_path:=a.tenant_id::text||'/'||a.request_id::text||'/validated.'||(case when a.format='jpeg' then 'jpg' else 'png' end);
   mime:=case when a.format='jpeg' then 'image/jpeg' else 'image/png' end;$replacement$;
begin
 select prosrc into body from pg_proc where oid='secure_upload_private.finalize(jsonb)'::regprocedure;
 if md5(body)<>'9301b31ff6420953d3e535a79670e065' or position(needle in body)=0
 or exists(select 1 from pg_proc where oid='secure_upload_private.finalize(jsonb)'::regprocedure and (not prosecdef or proconfig is distinct from array['search_path=""']::text[]))
 or has_function_privilege('anon','secure_upload_private.finalize(jsonb)','EXECUTE') or has_function_privilege('authenticated','secure_upload_private.finalize(jsonb)','EXECUTE')
 or not has_function_privilege('service_role','secure_upload_private.finalize(jsonb)','EXECUTE')
 or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='secure_upload_private.finalize(jsonb)'::regprocedure and a.grantee not in(p.proowner,'service_role'::regrole::oid))
 then raise exception 'upload_image_finalizer_contract_changed' using errcode='55000';end if;
 body:=replace(body,needle,replacement);
 body:=replace(body,'  select to_jsonb(o) into obj from storage.objects o where bucket_id=''upload-validated''',
  '  if state=''sanitized_derivative'' and (d->>''size_bytes'')::bigint>5242880 then raise exception ''upload_derivative_invalid'' using errcode=''23514'';end if;
  select to_jsonb(o) into obj from storage.objects o where bucket_id=''upload-validated''');
 execute format('create or replace function secure_upload_private.finalize(_payload jsonb) returns jsonb language plpgsql security definer set search_path='''' as %L',body);
end $enable$;
