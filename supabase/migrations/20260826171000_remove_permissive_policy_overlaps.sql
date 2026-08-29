-- Remove legacy permissive policies that overlap the role-specific RLS contract.
-- A permissive policy is combined with OR, so leaving a broader tenant-member
-- policy beside an admin/operator policy silently widens access.

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.driver_settlement_loads;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.integration_accounts;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.integration_accounts;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.integration_accounts;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.integration_accounts;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.operational_event_messages;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.operational_event_messages;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.payables_payments;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.payables_payments;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.payables_payments;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.payables_payments;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.receivables_payments;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.receivables_payments;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.receivables_payments;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.receivables_payments;

DROP POLICY IF EXISTS agvlog_select_authenticated ON public.tenant_emitters;
DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.tenant_emitters;
DROP POLICY IF EXISTS agvlog_update_authenticated ON public.tenant_emitters;
DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.tenant_emitters;

-- FOR ALL already covers SELECT, INSERT, UPDATE and DELETE. Keep one policy for
-- each operational table instead of pairing it with an overlapping read policy.
DROP POLICY IF EXISTS "Operational roles read hub fiscal emissions" ON public.hub_fiscal_emissions;
DROP POLICY IF EXISTS "Operational roles write hub fiscal emissions" ON public.hub_fiscal_emissions;
CREATE POLICY "Operational roles manage hub fiscal emissions"
  ON public.hub_fiscal_emissions
  FOR ALL
  TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "Operational roles read payable payments" ON public.payables_payments;
DROP POLICY IF EXISTS "Operational roles write payable payments" ON public.payables_payments;
CREATE POLICY "Operational roles manage payable payments"
  ON public.payables_payments
  FOR ALL
  TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "Operational roles read receivable payments" ON public.receivables_payments;
DROP POLICY IF EXISTS "Operational roles write receivable payments" ON public.receivables_payments;
CREATE POLICY "Operational roles manage receivable payments"
  ON public.receivables_payments
  FOR ALL
  TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

