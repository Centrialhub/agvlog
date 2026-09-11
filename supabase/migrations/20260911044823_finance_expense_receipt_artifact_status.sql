-- A later attachment resolves a current missing-receipt indicator without rewriting the original justification.
create function secure_upload_private.expense_receipt_count(t uuid,expense uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from secure_upload_private.expense_receipts r join secure_upload_private.artifacts a on a.tenant_id=r.tenant_id and a.id=r.artifact_id
 where r.tenant_id=t and r.expense_id=expense and a.source_type='expense_item' and a.source_id=expense and a.state='sanitized_derivative' and a.original_received
 and a.method='jpeg-png-reencode-v1' and r.source_snapshot=secure_upload_private.dto(a)
 and exists(select 1 from storage.objects o where o.bucket_id='upload-validated' and o.name=a.derivative->>'path'
  and o.user_metadata @> jsonb_build_object('version',2,'artifact_id',a.id,'sha256',a.derivative->>'sha256','size_bytes',a.derivative->'size_bytes','kind','validated_derivative','original_sha256',a.original_sha256)
  and o.metadata->'size'=a.derivative->'size_bytes' and o.metadata->>'mimetype'=a.derivative->>'mime');
$$;
revoke all on function secure_upload_private.expense_receipt_count(uuid,uuid) from public,anon,authenticated,service_role;
do $status$
declare body text;
begin
 select prosrc into body from pg_proc where oid='finance_private.list_expenses(uuid,jsonb)'::regprocedure;
 if md5(body)<>'b25cd595584cab6b6ff8b4441157abd2' or exists(select 1 from pg_proc where oid='finance_private.list_expenses(uuid,jsonb)'::regprocedure and (not prosecdef or proconfig is distinct from array['search_path=""']::text[]))
 or has_function_privilege('anon','finance_private.list_expenses(uuid,jsonb)','EXECUTE') or has_function_privilege('service_role','finance_private.list_expenses(uuid,jsonb)','EXECUTE') or not has_function_privilege('authenticated','finance_private.list_expenses(uuid,jsonb)','EXECUTE')
 or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='finance_private.list_expenses(uuid,jsonb)'::regprocedure and a.grantee not in(p.proowner,'authenticated'::regrole::oid))
 then raise exception 'finance_expense_receipt_reader_contract_changed' using errcode='55000';end if;
 body:=replace(body,'select e.*,x.id','select e.*,secure_upload_private.expense_receipt_count(e.tenant_id,e.id) receipt_artifact_count,x.id');
 body:=replace(body,'or e.receipt_path is null)','or (e.receipt_path is null and secure_upload_private.expense_receipt_count(e.tenant_id,e.id)=0))');
 body:=replace(body,'where not cancelled and receipt_path is null)','where not cancelled and receipt_path is null and receipt_artifact_count=0)');
 execute format('create or replace function finance_private.list_expenses(_tenant uuid,_filters jsonb default ''{}'') returns jsonb language plpgsql stable security definer set search_path='''' as %L',body);
end $status$;
