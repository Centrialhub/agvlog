import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Database, Json } from '@/integrations/supabase/types';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';
import {
  clearOperatorClientPageAnchors,
  readOperatorClientPageNumber,
} from '@/lib/operator/operatorClientPagination';

export interface Client {
  id: string;
  tenant_id: string;
  company_name: string;
  legal_name: string | null;
  tax_id: string | null;
  contacts: Json | null;
  addresses: Json | null;
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

export type CreateClientInput = Omit<
  Database['public']['Tables']['clients']['Insert'],
  'tenant_id' | 'created_by'
>;
export type UpdateClientInput = Omit<
  Database['public']['Tables']['clients']['Update'],
  'id' | 'tenant_id' | 'updated_by' | 'updated_at'
> & { id: string };

export type ClientKindFilter = 'all' | 'client' | 'supplier' | 'both';

interface ClientPageInput {
  page: number;
  pageSize: number;
  search?: string;
  kind?: ClientKindFilter;
}

export interface ClientPage {
  rows: Client[];
  totalCount: number;
}

function safePostgrestSearch(input: string): string {
  return input.trim().replace(/[,%()"\\]/g, ' ').replace(/\s+/g, ' ');
}

function applyClientKindFilter<T extends {
  or: (filters: string) => T;
  eq: (column: string, value: boolean) => T;
}>(query: T, kind: ClientKindFilter): T {
  if (kind === 'client') {
    return query
      .or('is_client.is.null,is_client.eq.true')
      .or('is_supplier.is.null,is_supplier.eq.false');
  }
  if (kind === 'supplier') {
    return query
      .eq('is_supplier', true)
      .or('is_client.is.null,is_client.eq.false');
  }
  if (kind === 'both') {
    return query.eq('is_client', true).eq('is_supplier', true);
  }
  return query;
}

export function useClientsPage({ page, pageSize, search = '', kind = 'all' }: ClientPageInput) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const normalizedSearch = safePostgrestSearch(search);

  return useQuery({
    queryKey: ['clients', 'page', currentTenant?.id, user?.id, page, pageSize, normalizedSearch, kind],
    queryFn: async (): Promise<ClientPage> => {
      if (!currentTenant || !user) return { rows: [], totalCount: 0 };
      const result = await readOperatorClientPageNumber({
        tenantId: currentTenant.id,
        actorId: user.id,
        page,
        pageSize,
        search: normalizedSearch,
        kind,
      });
      return { rows: result.items as unknown as Client[], totalCount: result.total_count };
    },
    enabled: !!currentTenant && !!user,
    placeholderData: previous => previous,
    retry: false,
  });
}

export function useClientCounts() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['clients', 'counts', currentTenant?.id, user?.id],
    queryFn: async () => {
      if (!currentTenant) return { clients: 0, suppliers: 0, both: 0, total: 0 };

      const countFor = async (kind: ClientKindFilter) => {
        let query = supabase
          .from('clients')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', currentTenant.id);
        query = applyClientKindFilter(query, kind);
        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
      };

      const [clients, suppliers, both, total] = await Promise.all([
        countFor('client'),
        countFor('supplier'),
        countFor('both'),
        countFor('all'),
      ]);
      return { clients, suppliers, both, total };
    },
    enabled: !!currentTenant && !!user,
  });
}

export function useClients() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['clients', currentTenant?.id, user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) return [];
      const rows = await readOperatorReferenceCatalog({
        tenantId: currentTenant.id,
        actorId: user.id,
        resource: 'clients',
        includeInactive: true,
      });
      return (rows as unknown as Client[]).sort((left, right) => (
        left.company_name.localeCompare(right.company_name, 'pt-BR') || left.id.localeCompare(right.id)
      ));
    },
    enabled: !!currentTenant && !!user,
    retry: false,
  });
}

export function useClient(id: string | null) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['client', currentTenant?.id, user?.id, id],
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
    enabled: !!id && !!currentTenant && !!user,
  });
}

export function useCreateClient() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateClientInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('clients').insert({
        ...values,
        tenant_id: currentTenant.id,
        created_by: user?.id ?? null,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      clearOperatorClientPageAnchors(currentTenant?.id);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useUpdateClient() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateClientInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('clients').update({
        ...values,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('tenant_id', currentTenant.id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      clearOperatorClientPageAnchors(currentTenant?.id);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
