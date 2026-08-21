
CREATE POLICY "pallet_proof_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'pallet-return-proofs'
  AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
);
CREATE POLICY "pallet_proof_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'pallet-return-proofs'
  AND public.is_tenant_operator_or_admin((split_part(name, '/', 1))::uuid)
);
CREATE POLICY "pallet_proof_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'pallet-return-proofs'
  AND public.is_tenant_operator_or_admin((split_part(name, '/', 1))::uuid)
) WITH CHECK (
  bucket_id = 'pallet-return-proofs'
  AND public.is_tenant_operator_or_admin((split_part(name, '/', 1))::uuid)
);
CREATE POLICY "pallet_proof_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'pallet-return-proofs'
  AND public.is_tenant_admin((split_part(name, '/', 1))::uuid)
);
