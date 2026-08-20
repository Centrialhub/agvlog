-- Repair user_roles table existence and grants
CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role public.app_role NOT NULL,
    UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Fix search_path and missing grants for existing functions to resolve linter/test issues
ALTER FUNCTION public.audit_data_consistency_v4(uuid) SET search_path = public;
ALTER FUNCTION public.execute_data_repair_v1(uuid, uuid) SET search_path = public;

-- Ensure data_repair_batches has proper grants for authenticated users
GRANT SELECT, INSERT, UPDATE ON public.data_repair_batches TO authenticated;
