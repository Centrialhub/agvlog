DROP POLICY IF EXISTS "Members can view load_documents" ON public.load_documents;

CREATE POLICY "Internal roles view load_documents"
ON public.load_documents FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE POLICY "Drivers view own load_documents"
ON public.load_documents FOR SELECT TO authenticated
USING (load_id IN (SELECT public._driver_load_ids()));

CREATE POLICY "Operators can insert load_documents"
ON public.load_documents FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

CREATE POLICY "Operators can update load_documents"
ON public.load_documents FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'operator'::public.app_role))
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

DROP POLICY IF EXISTS lib_select ON public.load_import_batches;
CREATE POLICY "Internal roles view load_import_batches"
ON public.load_import_batches FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

DROP POLICY IF EXISTS luc_select ON public.load_unloading_charges;
CREATE POLICY "Internal roles view load_unloading_charges"
ON public.load_unloading_charges FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

DROP POLICY IF EXISTS lp_select ON public.load_payments;
CREATE POLICY "Internal roles view load_payments"
ON public.load_payments FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

DROP POLICY IF EXISTS lsh_select ON public.load_status_history;
CREATE POLICY "Internal roles view load_status_history"
ON public.load_status_history FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE POLICY "Drivers view own load_status_history"
ON public.load_status_history FOR SELECT TO authenticated
USING (load_id IN (SELECT public._driver_load_ids()));
