DROP POLICY IF EXISTS "Internal roles view fiscal_documents" ON public.fiscal_documents;
CREATE POLICY "Internal roles view fiscal_documents" ON public.fiscal_documents
FOR SELECT TO authenticated
USING (public.is_user_internal_role(tenant_id));

CREATE OR REPLACE FUNCTION public.is_user_internal_role(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id 
      AND user_id = auth.uid() 
      AND active = true
      AND role IN ('owner','admin','operator')
  );
$$;