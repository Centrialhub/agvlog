-- Private executable dependency, distinct from user uploads. Hash pinned in Edge code.
set lock_timeout='3s';set statement_timeout='30s';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('upload-validation-runtime','upload-validation-runtime',false,20971520,array['application/wasm']);
create policy upload_validation_runtime_browser_deny on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'upload-validation-runtime') with check(bucket_id<>'upload-validation-runtime');
