import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export function useProviderUnits(integrationAccountId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['provider_units', currentTenant?.id, integrationAccountId],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('provider_units')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (integrationAccountId) q = q.eq('integration_account_id', integrationAccountId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });
}

export function useProviderUnitMutations() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async (unit: { tenant_id: string; integration_account_id: string; external_code: string; label?: string }) => {
      const { error } = await supabase.from('provider_units').insert(unit);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider_units'] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('provider_units').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider_units'] }),
  });
  return { create, remove };
}

export function useTrackerLinks() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['tracker_links', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('vehicle_tracker_links')
        .select('*, vehicles(plate, nickname), provider_units(external_code, label)')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });
}

export function useTrackerLinkMutations() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async (link: { tenant_id: string; vehicle_id: string; provider_unit_id: string }) => {
      const { error } = await supabase.from('vehicle_tracker_links').insert(link);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracker_links'] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicle_tracker_links').update({ active: false, end_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracker_links'] }),
  });
  return { create, remove };
}
