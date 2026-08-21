CREATE OR REPLACE FUNCTION public.is_user_internal_role(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    from public.tenant_memberships
    where user_id = auth.uid()
      and tenant_id = _tenant_id
      and role IN ('owner', 'admin', 'operator')
      and active = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_user_internal_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_internal_role(uuid) TO service_role;

-- Ensure authenticated can select from core operational tables
GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT ON public.tenant_memberships TO authenticated;
GRANT SELECT ON public.vehicles TO authenticated;
GRANT SELECT ON public.positions_last TO authenticated;
GRANT SELECT ON public.fiscal_documents TO authenticated;
GRANT SELECT ON public.loads TO authenticated;
GRANT SELECT ON public.load_items TO authenticated;
GRANT SELECT ON public.metrics_daily TO authenticated;
GRANT SELECT ON public.alert_instances TO authenticated;
GRANT SELECT ON public.alert_rules TO authenticated;

-- Service role full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
