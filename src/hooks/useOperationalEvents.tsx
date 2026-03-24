import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const EVENT_TYPES = [
  'missing_goods', 'wrong_quantity', 'client_refused', 'no_order',
  'expired_goods', 'near_expiration', 'damaged', 'wrong_address',
  'partial_delivery', 'return', 'other',
] as const;

export type OperationalEventType = typeof EVENT_TYPES[number];

export const EVENT_TYPE_LABELS: Record<OperationalEventType, string> = {
  missing_goods: 'Mercadoria Faltante',
  wrong_quantity: 'Quantidade Errada',
  client_refused: 'Recusa do Cliente',
  no_order: 'Sem Pedido',
  expired_goods: 'Mercadoria Vencida',
  near_expiration: 'Próximo ao Vencimento',
  damaged: 'Avaria',
  wrong_address: 'Endereço Errado',
  partial_delivery: 'Entrega Parcial',
  return: 'Devolução',
  other: 'Outro',
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

export interface OperationalEvent {
  id: string;
  tenant_id: string;
  load_id: string | null;
  order_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  client_id: string | null;
  event_type: OperationalEventType;
  severity: string;
  description: string | null;
  financial_impact: number;
  resolution: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  loads?: { load_number: string } | null;
  drivers?: { name: string } | null;
  clients?: { company_name: string } | null;
}

export function useOperationalEvents() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['operational_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any)
        .from('operational_events')
        .select('*, loads(load_number), drivers(name), clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as OperationalEvent[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateOperationalEvent() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<OperationalEvent>) => {
      const { data, error } = await (supabase as any).from('operational_events').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_events'] }),
  });
}

export function useUpdateOperationalEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<OperationalEvent> & { id: string }) => {
      const { data, error } = await (supabase as any).from('operational_events').update({
        ...values,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_events'] }),
  });
}
