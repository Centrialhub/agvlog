import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export interface Client {
  id: string;
  tenant_id: string;
  company_name: string;
  legal_name: string | null;
  tax_id: string | null;
  contacts: any[];
  addresses: any[];
  service_notes: string | null;
  payment_notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useClients() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['clients', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('company_name');
      if (error) throw error;
      return (data || []) as Client[];
    },
    enabled: !!currentTenant,
  });
}

export function useClient(id: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      if (!id || !currentTenant) return null;
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (error) throw error;
      return data as Client | null;
    },
    enabled: !!id && !!currentTenant,
  });
}

export function useCreateClient() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Client>) => {
      const { data, error } = await supabase.from('clients').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useUpdateClient() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Client> & { id: string }) => {
      const { data, error } = await supabase.from('clients').update({
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}
