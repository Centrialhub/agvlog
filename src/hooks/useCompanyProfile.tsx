import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface CompanyProfile {
  legal_name?: string;
  trade_name?: string;
  tax_id?: string;
  state_registration?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_data_url?: string;
}

/**
 * Perfil da empresa que usa o sistema. Armazenado em `tenants.settings.company`
 * para evitar migração de schema e reaproveitar as políticas de RLS existentes
 * (só admins/owners atualizam; membros leem).
 */
export function useCompanyProfile() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['company_profile', currentTenant?.id],
    enabled: !!currentTenant?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<CompanyProfile> => {
      if (!currentTenant?.id) return {};
      const { data, error } = await supabase
        .from('tenants')
        .select('settings')
        .eq('id', currentTenant.id)
        .maybeSingle();
      if (error) throw error;
      const s = (data?.settings as any) || {};
      return (s.company as CompanyProfile) || {};
    },
  });
}

export function useUpdateCompanyProfile() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (patch: CompanyProfile) => {
      if (!currentTenant?.id) throw new Error('Sem tenant');
      const { data: cur, error: e1 } = await supabase
        .from('tenants').select('settings').eq('id', currentTenant.id).maybeSingle();
      if (e1) throw e1;
      const settings = { ...((cur?.settings as any) || {}) };
      settings.company = { ...(settings.company || {}), ...patch };
      const { error } = await supabase
        .from('tenants').update({ settings }).eq('id', currentTenant.id);
      if (error) throw error;
      return settings.company as CompanyProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company_profile'] });
    },
  });
}