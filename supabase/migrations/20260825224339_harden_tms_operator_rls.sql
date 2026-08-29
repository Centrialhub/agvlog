-- Align TMS writes with the operator-facing UI while retaining destructive
-- deletes as administrator-only operations.
CREATE POLICY "Operators can insert loads"
ON public.loads FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

CREATE POLICY "Operators can update loads"
ON public.loads FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'operator'::public.app_role))
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

DROP POLICY IF EXISTS "Members can view load_items" ON public.load_items;

CREATE POLICY "Internal roles view load_items"
ON public.load_items FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE POLICY "Drivers view own trip load_items"
ON public.load_items FOR SELECT TO authenticated
USING (load_id IN (SELECT public._driver_load_ids()));

CREATE POLICY "Operators can insert load_items"
ON public.load_items FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

CREATE POLICY "Operators can update load_items"
ON public.load_items FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'operator'::public.app_role))
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

DROP POLICY IF EXISTS "Members can view route_planning_drafts" ON public.route_planning_drafts;

CREATE POLICY "Internal roles view route_planning_drafts"
ON public.route_planning_drafts FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE POLICY "Operators can insert route_planning_drafts"
ON public.route_planning_drafts FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

CREATE POLICY "Operators can update route_planning_drafts"
ON public.route_planning_drafts FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'operator'::public.app_role))
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

DROP POLICY IF EXISTS "Members can view operational_routes" ON public.operational_routes;

CREATE POLICY "Internal roles view operational_routes"
ON public.operational_routes FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE POLICY "Operators can insert operational_routes"
ON public.operational_routes FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

CREATE POLICY "Operators can update operational_routes"
ON public.operational_routes FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'operator'::public.app_role))
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

DROP POLICY IF EXISTS "Members can view route_templates" ON public.route_templates;

CREATE POLICY "Internal roles view route_templates"
ON public.route_templates FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

DROP POLICY IF EXISTS "Members can create load note audit events" ON public.load_note_audit_events;
DROP POLICY IF EXISTS "Members can view load note audit events" ON public.load_note_audit_events;

CREATE POLICY "Internal roles create load note audit events"
ON public.load_note_audit_events FOR INSERT TO authenticated
WITH CHECK (public.is_user_internal_role(tenant_id));

CREATE POLICY "Internal roles view load note audit events"
ON public.load_note_audit_events FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE POLICY "Operators can insert fiscal_documents"
ON public.fiscal_documents FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));

CREATE POLICY "Operators can update fiscal_documents"
ON public.fiscal_documents FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'operator'::public.app_role))
WITH CHECK (public.has_tenant_role(tenant_id, 'operator'::public.app_role));
