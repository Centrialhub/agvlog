-- Require AAL2 for owner/admin sessions at the database boundary.
-- Operators, drivers and portal clients retain their existing access model.

CREATE OR REPLACE FUNCTION public.session_has_privileged_mfa_v1(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      WHERE membership.user_id = auth.uid()
        AND membership.tenant_id = p_tenant_id
        AND membership.active
        AND membership.role::text IN ('owner', 'admin')
    )
    OR COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2';
$function$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT membership.tenant_id
  FROM public.tenant_memberships membership
  WHERE membership.user_id = auth.uid()
    AND membership.active
    AND (
      membership.role::text NOT IN ('owner', 'admin')
      OR COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
    );
$function$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships membership
    WHERE membership.user_id = auth.uid()
      AND membership.tenant_id = _tenant_id
      AND membership.role = _role
      AND membership.active
      AND (
        membership.role::text NOT IN ('owner', 'admin')
        OR COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships membership
    WHERE membership.user_id = auth.uid()
      AND membership.tenant_id = _tenant_id
      AND membership.active
      AND (
        membership.role::text NOT IN ('owner', 'admin')
        OR COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships membership
    WHERE membership.user_id = auth.uid()
      AND membership.tenant_id = _tenant_id
      AND membership.role::text IN ('owner', 'admin')
      AND membership.active
      AND COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_operator_or_admin(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships membership
    WHERE membership.user_id = auth.uid()
      AND membership.tenant_id = _tenant_id
      AND membership.active
      AND (
        membership.role::text = 'operator'
        OR (
          membership.role::text IN ('owner', 'admin')
          AND COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_user_internal_role(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.is_tenant_operator_or_admin(_tenant_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_user_portal_tenants()
RETURNS TABLE(id uuid, name text, plan_key text, timezone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT tenant.id, tenant.name, tenant.plan_key, tenant.timezone
  FROM public.tenants tenant
  WHERE public.session_has_privileged_mfa_v1(tenant.id)
    AND tenant.id IN (
      SELECT membership.tenant_id
      FROM public.tenant_memberships membership
      WHERE membership.user_id = auth.uid() AND membership.active
      UNION
      SELECT access.tenant_id
      FROM public.client_portal_access access
      WHERE access.user_id = auth.uid() AND access.active
    );
$function$;

-- Let the frontend discover only the signed-in user's active memberships so it
-- can present the MFA bootstrap gate. A SECURITY DEFINER RPC avoids opening a
-- tenant_memberships SELECT policy that could be reused by legacy RLS
-- subqueries to bypass the AAL2 read boundary.
CREATE OR REPLACE FUNCTION public.get_current_memberships_v1()
RETURNS TABLE (
  tenant_id uuid,
  role public.app_role,
  tenant_name text,
  plan_key text,
  timezone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    membership.tenant_id,
    membership.role,
    tenant.name,
    tenant.plan_key,
    tenant.timezone
  FROM public.tenant_memberships membership
  JOIN public.tenants tenant ON tenant.id = membership.tenant_id
  WHERE membership.user_id = auth.uid()
    AND membership.active;
$function$;

DROP POLICY IF EXISTS "Users can view own membership for MFA bootstrap" ON public.tenant_memberships;

-- Remove permissive legacy policies that query tenant_memberships directly and
-- would otherwise bypass the AAL2-aware helpers below. The deny-only legacy
-- policies on client_occurrence_messages are intentionally harmless.
DROP POLICY IF EXISTS agvlog_select_authenticated ON public.hub_fiscal_credentials;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.hub_fiscal_credentials;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.hub_fiscal_credentials;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.hub_fiscal_credentials;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.hub_fiscal_emissions;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.hub_fiscal_emissions;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.hub_fiscal_emissions;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.hub_fiscal_emissions;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.load_manifests;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.load_manifests;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.load_manifests;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.load_manifests;

DROP POLICY IF EXISTS dsl_tenant_select ON public.driver_settlement_loads;
CREATE POLICY dsl_tenant_select ON public.driver_settlement_loads
  FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "Tenant members read hub_fiscal_emissions" ON public.hub_fiscal_emissions;
DROP POLICY IF EXISTS "Tenant members write hub_fiscal_emissions" ON public.hub_fiscal_emissions;
CREATE POLICY "Operational roles read hub fiscal emissions" ON public.hub_fiscal_emissions
  FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "Operational roles write hub fiscal emissions" ON public.hub_fiscal_emissions
  FOR ALL TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "tenant members can delete manifests" ON public.load_manifests;
DROP POLICY IF EXISTS "tenant members can insert manifests" ON public.load_manifests;
DROP POLICY IF EXISTS "tenant members can update manifests" ON public.load_manifests;
DROP POLICY IF EXISTS "tenant members can view manifests" ON public.load_manifests;
CREATE POLICY "Tenant members view manifests" ON public.load_manifests
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members insert manifests" ON public.load_manifests
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members update manifests" ON public.load_manifests
  FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members delete manifests" ON public.load_manifests
  FOR DELETE TO authenticated USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "tenant members insert event messages" ON public.operational_event_messages;
DROP POLICY IF EXISTS "tenant members read event messages" ON public.operational_event_messages;
CREATE POLICY "Tenant members insert event messages" ON public.operational_event_messages
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members read event messages" ON public.operational_event_messages
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "payables_payments tenant read" ON public.payables_payments;
DROP POLICY IF EXISTS "payables_payments tenant write" ON public.payables_payments;
CREATE POLICY "Operational roles read payable payments" ON public.payables_payments
  FOR SELECT TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "Operational roles write payable payments" ON public.payables_payments
  FOR ALL TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "receivables_payments tenant read" ON public.receivables_payments;
DROP POLICY IF EXISTS "receivables_payments tenant write" ON public.receivables_payments;
CREATE POLICY "Operational roles read receivable payments" ON public.receivables_payments
  FOR SELECT TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "Operational roles write receivable payments" ON public.receivables_payments
  FOR ALL TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "Admins manage emitters" ON public.tenant_emitters;
DROP POLICY IF EXISTS "Members read emitters" ON public.tenant_emitters;
DROP POLICY IF EXISTS "Tenant isolation" ON public.tenant_emitters;
CREATE POLICY "Operational roles read emitters" ON public.tenant_emitters
  FOR SELECT TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "Admins insert emitters" ON public.tenant_emitters
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "Admins update emitters" ON public.tenant_emitters
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "Admins delete emitters" ON public.tenant_emitters
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS receipts_tenant_select ON storage.objects;
CREATE POLICY receipts_tenant_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

REVOKE ALL ON FUNCTION public.session_has_privileged_mfa_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_current_memberships_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_has_privileged_mfa_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_current_memberships_v1() TO authenticated;

COMMENT ON FUNCTION public.session_has_privileged_mfa_v1(uuid)
  IS 'Central AAL2 predicate used by tenant RLS helpers; owner/admin sessions below AAL2 are denied while service jobs and non-privileged roles keep their existing flows.';
COMMENT ON FUNCTION public.get_current_memberships_v1()
  IS 'Returns only the current user active memberships for role discovery before the privileged MFA gate.';
