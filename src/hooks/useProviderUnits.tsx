import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

export function useProviderUnits(integrationAccountId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['provider_units', currentTenant?.id, integrationAccountId],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages((from, to) => {
        let q = supabase
          .from('provider_units')
          .select('*')
          .eq('tenant_id', currentTenant.id)
          .order('created_at', { ascending: false })
          .order('id');
        if (integrationAccountId) q = q.eq('integration_account_id', integrationAccountId);
        return q.range(from, to);
      });
    },
    enabled: !!currentTenant,
  });
}

export function useProviderUnitMutations() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  const create = useMutation({
    mutationFn: async (unit: { integration_account_id: string; external_code: string; label?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('provider_units').insert({ ...unit, tenant_id: currentTenant.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider_units'] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('provider_units').delete().eq('id', id).eq('tenant_id', currentTenant.id);
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
      return fetchAllPostgrestPages((from, to) => supabase
        .from('vehicle_tracker_links')
        .select('*, vehicles(plate, nickname), provider_units(external_code, label)')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to));
    },
    enabled: !!currentTenant,
  });
}

export function useTrackerLinkMutations() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  const create = useMutation({
    mutationFn: async (link: { vehicle_id: string; provider_unit_id: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('vehicle_tracker_links').insert({ ...link, tenant_id: currentTenant.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracker_links'] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('vehicle_tracker_links').update({ active: false, end_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracker_links'] }),
  });
  return { create, remove };
}
