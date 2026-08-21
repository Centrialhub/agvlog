-- Fixing missing RLS policies for tables with RLS enabled

-- 1. data_recovery_batches: Service role only (for now)
CREATE POLICY "Admins can manage data recovery batches"
ON public.data_recovery_batches
FOR ALL
TO authenticated
USING (public.is_tenant_admin(tenant_id));

-- 2. data_recovery_items: Service role only (for now)
CREATE POLICY "Admins can manage data recovery items"
ON public.data_recovery_items
FOR ALL
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.data_recovery_batches b
    WHERE b.id = batch_id AND public.is_tenant_admin(b.tenant_id)
));

-- 3. fiscal_webhook_inbox: Service role only
-- (No policy means all access is denied by default for non-service-role)
-- We add an explicit block just to be clear, but default RLS already blocks if no policy matches.
-- Actually, we might want service_role to be able to read/write, which it can by bypassing RLS.

-- 4. user_roles: Users can read their own roles, admins can read all
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_tenant_admin(NULL)); -- is_tenant_admin helper needs to be able to check roles

-- Note: is_tenant_admin(NULL) might be tricky if it checks user_roles itself.
-- Let's check is_tenant_admin definition.
