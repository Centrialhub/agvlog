-- Browser uploads must pass through secure-upload so tenant authorization,
-- binary signature and malware scanning cannot be bypassed by calling Storage
-- directly. Authenticated reads/deletes retain their existing scoped policies.

drop policy if exists receipts_tenant_insert on storage.objects;
drop policy if exists receipts_tenant_update on storage.objects;
drop policy if exists pallet_proof_insert on storage.objects;
drop policy if exists pallet_proof_update on storage.objects;
drop policy if exists return_proof_insert on storage.objects;
drop policy if exists return_proof_update on storage.objects;

