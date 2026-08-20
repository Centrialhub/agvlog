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
  trade_name?: string | null;
  person_type?: string | null;
  state_registration?: string | null;
  municipal_registration?: string | null;
  ie_indicator?: string | null;
  internal_code?: string | null;
  sigla?: string | null;
  category?: string | null;
  cfop_client_type?: string | null;
  tax_regime?: string | null;
  payer_group?: string | null;
  payer?: string | null;
  freight_calc_type?: string | null;
  cubage_factor?: number | null;
  accounting_code_client?: string | null;
  accounting_code_supplier?: string | null;
  budget_group_client?: string | null;
  budget_group_supplier?: string | null;
  client_type?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  fax?: string | null;
  blocked?: boolean | null;
  billed?: boolean | null;
  taxes_enabled?: boolean | null;
  tax_code?: string | null;
  tax_description?: string | null;
  notes?: string | null;
  is_client?: boolean | null;
  is_supplier?: boolean | null;
  address_city_ibge_code?: string | null;
}

export interface PaginatedClients {
  items: Client[];
  next_cursor: string | null;
  total_count: number;
}

export function useClients(filters: { search?: string } = {}) {
  const { currentTenant } = useTenant();
  return useQuery<PaginatedClients>({
    queryKey: ['clients', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return { items: [], next_cursor: null, total_count: 0 };
      const { data, error } = await supabase.rpc('list_clients_v1', {
        p_tenant_id: currentTenant.id,
        p_search: filters.search || null,
        p_limit: 1000,
      });
      if (error) throw error;
      const result = data as any;
      return {
        items: (result.items || []) as Client[],
        next_cursor: result.next_cursor || null,
        total_count: Number(result.total_count) || 0,
      };
    },
    enabled: !!currentTenant,
  });
}

export function useClientsArray() {
  const q = useClients();
  return { ...q, data: q.data?.items ?? [] };
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
