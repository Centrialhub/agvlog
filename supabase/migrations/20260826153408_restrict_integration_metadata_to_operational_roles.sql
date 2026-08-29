-- Integration metadata is operational configuration. Drivers and portal users
-- do not need provider usernames, status details or credential hints.

DROP POLICY IF EXISTS "Admins can delete integration accounts" ON public.integration_accounts;
DROP POLICY IF EXISTS "Admins can insert integration accounts" ON public.integration_accounts;
DROP POLICY IF EXISTS "Admins can update integration accounts" ON public.integration_accounts;
DROP POLICY IF EXISTS "Members can view integration accounts" ON public.integration_accounts;

CREATE POLICY integration_accounts_select_operational
  ON public.integration_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

CREATE POLICY integration_accounts_insert_admin
  ON public.integration_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY integration_accounts_update_admin
  ON public.integration_accounts
  FOR UPDATE
  TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY integration_accounts_delete_admin
  ON public.integration_accounts
  FOR DELETE
  TO authenticated
  USING (public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins manage hub creds" ON public.hub_fiscal_credentials;
DROP POLICY IF EXISTS "Members read hub creds" ON public.hub_fiscal_credentials;

CREATE POLICY hub_fiscal_credentials_select_operational
  ON public.hub_fiscal_credentials
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

CREATE POLICY hub_fiscal_credentials_insert_admin
  ON public.hub_fiscal_credentials
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY hub_fiscal_credentials_update_admin
  ON public.hub_fiscal_credentials
  FOR UPDATE
  TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY hub_fiscal_credentials_delete_admin
  ON public.hub_fiscal_credentials
  FOR DELETE
  TO authenticated
  USING (public.is_tenant_admin(tenant_id));
