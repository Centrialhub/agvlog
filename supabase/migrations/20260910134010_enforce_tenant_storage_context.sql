drop policy if exists agvlog_active_tenant_storage_context on storage.objects;
create policy agvlog_active_tenant_storage_context
on storage.objects
as restrictive
for all
to authenticated
using(
  bucket_id not in('receipts','occurrence-return-proofs','pallet-return-proofs','finance-statements')
  or (
    split_part(name,'/',1)~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and split_part(name,'/',1)::uuid=private.request_tenant_id()
  )
)
with check(
  bucket_id not in('receipts','occurrence-return-proofs','pallet-return-proofs','finance-statements')
  or (
    split_part(name,'/',1)~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and split_part(name,'/',1)::uuid=private.request_tenant_id()
  )
);

drop policy if exists agvlog_tenant_storage_anon_deny on storage.objects;
create policy agvlog_tenant_storage_anon_deny
on storage.objects
as restrictive
for all
to anon
using(bucket_id not in('receipts','occurrence-return-proofs','pallet-return-proofs','finance-statements'))
with check(bucket_id not in('receipts','occurrence-return-proofs','pallet-return-proofs','finance-statements'));

comment on policy agvlog_active_tenant_storage_context on storage.objects is
  'Prevents fiscal, financial and proof files from crossing the active legal tenant boundary.';
