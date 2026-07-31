import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface InsuranceProfile {
  /** Razão social da seguradora. */
  name?: string;
  /** CNPJ (somente dígitos). */
  cnpj?: string;
  /** Nº da apólice — fixo por transportadora. */
  policy?: string;
}

/**
 * Seguradora padrão da transportadora. Guardada em `tenants.settings.insurance`
 * (mesmo padrão do perfil da empresa) para reaproveitar RLS e evitar migração.
 * O nº da averbação (CGC) NÃO fica aqui: muda a cada CT-e.
 */
export function useInsuranceProfile() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['insurance_profile', currentTenant?.id],
    enabled: !!currentTenant?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<InsuranceProfile> => {
      if (!currentTenant?.id) return {};
      const { data, error } = await supabase
        .from('tenants').select('settings').eq('id', currentTenant.id).maybeSingle();
      if (error) throw error;
      const s = (data?.settings as any) || {};
      return (s.insurance as InsuranceProfile) || {};
    },
  });
}

export function useUpdateInsuranceProfile() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (patch: InsuranceProfile) => {
      if (!currentTenant?.id) throw new Error('Sem tenant');
      const { data: cur, error: e1 } = await supabase
        .from('tenants').select('settings').eq('id', currentTenant.id).maybeSingle();
      if (e1) throw e1;
      const settings = { ...((cur?.settings as any) || {}) };
      settings.insurance = { ...(settings.insurance || {}), ...patch };
      const { data: updated, error } = await supabase
        .from('tenants')
        .update({ settings })
        .eq('id', currentTenant.id)
        .select('settings')
        .maybeSingle();
      if (error) throw error;
      if (!updated) {
        throw new Error('Sem permissão para salvar a seguradora padrão (apenas admin/owner).');
      }
      return (((updated.settings as any) || {}).insurance || {}) as InsuranceProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insurance_profile'] });
    },
  });
}
