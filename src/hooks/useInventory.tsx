import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { TablesInsert } from '@/integrations/supabase/types';

export const MOVEMENT_TYPES = ['inbound', 'outbound', 'transfer', 'adjustment'] as const;
export type MovementType = typeof MOVEMENT_TYPES[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  inbound: 'Entrada',
  outbound: 'Saída',
  transfer: 'Transferência',
  adjustment: 'Ajuste',
};

export interface InventoryLocation {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  description: string | null;
  active: boolean;
}

export interface InventoryMovement {
  id: string;
  tenant_id: string;
  location_id: string | null;
  movement_type: MovementType;
  client_id: string | null;
  item_description: string;
  quantity: number;
  pallet_count: number;
  weight_kg: number | null;
  volume_m3: number | null;
  fiscal_document_id: string | null;
  notes: string | null;
  moved_at: string;
  created_at: string;
  clients?: { company_name: string } | null;
  inventory_locations?: { name: string } | null;
}

export interface InventoryBalance {
  id: string;
  tenant_id: string;
  location_id: string | null;
  client_id: string | null;
  item_description: string;
  quantity: number;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  first_inbound_at: string | null;
  last_movement_at: string | null;
  updated_at: string;
  clients?: { company_name: string } | null;
  inventory_locations?: { name: string } | null;
}

export function useInventoryLocations() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['inventory_locations', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('name');
      if (error) throw error;
      return (data || []) as InventoryLocation[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateLocation() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<InventoryLocation>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload = {
        ...values,
        tenant_id: currentTenant.id,
      } as TablesInsert<'inventory_locations'>;
      const { data, error } = await supabase.from('inventory_locations').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory_locations'] }),
  });
}

export function useInventoryMovements() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['inventory_movements', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('*, clients(company_name), inventory_locations(name)')
        .eq('tenant_id', currentTenant.id)
        .order('moved_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as InventoryMovement[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateMovement() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<InventoryMovement>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { clients: _clients, inventory_locations: _locations, ...recordValues } = values;
      const payload = {
        ...recordValues,
        tenant_id: currentTenant.id,
        created_by: user?.id,
      } as TablesInsert<'inventory_movements'>;
      const { data, error } = await supabase.from('inventory_movements').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory_movements'] });
      qc.invalidateQueries({ queryKey: ['inventory_balances'] });
    },
  });
}

export function useInventoryBalances() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['inventory_balances', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('inventory_balances')
        .select('*, clients(company_name), inventory_locations(name)')
        .eq('tenant_id', currentTenant.id)
        .order('item_description');
      if (error) throw error;
      return (data || []) as InventoryBalance[];
    },
    enabled: !!currentTenant,
  });
}
