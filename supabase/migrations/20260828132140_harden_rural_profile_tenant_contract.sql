-- Rural delivery profiles must never link clients across tenants.
ALTER TABLE public.client_rural_delivery_profiles
  DROP CONSTRAINT IF EXISTS client_rural_delivery_profiles_client_id_fkey,
  DROP CONSTRAINT IF EXISTS client_rural_delivery_profiles_related_remitter_id_fkey,
  ADD CONSTRAINT client_rural_delivery_profiles_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT client_rural_delivery_profiles_related_remitter_id_fkey
    FOREIGN KEY (tenant_id, related_remitter_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE SET NULL (related_remitter_id)
    NOT VALID;

ALTER TABLE public.client_rural_delivery_profiles
  VALIDATE CONSTRAINT client_rural_delivery_profiles_client_id_fkey,
  VALIDATE CONSTRAINT client_rural_delivery_profiles_related_remitter_id_fkey;
