import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const EVENT_TYPES = [
  'missing_goods', 'missing_goods_fractional', 'wrong_quantity', 'client_refused', 'no_order',
  'expired_goods', 'near_expiration', 'damaged', 'wrong_address',
  'partial_delivery', 'return', 'wrong_product', 'boleto_extension', 'delivery_delay', 'other',
] as const;

export type OperationalEventType = typeof EVENT_TYPES[number];

export const EVENT_TYPE_LABELS: Record<OperationalEventType, string> = {
  missing_goods: 'Falta de Mercadoria (fechada)',
  missing_goods_fractional: 'Falta de Mercadoria (fracionado)',
  wrong_quantity: 'Quantidade Errada',
  client_refused: 'Cliente Fechado / Recusa',
  no_order: 'Cliente Não Fez o Pedido',
  expired_goods: 'Mercadoria Vencida',
  near_expiration: 'Produto Próximo do Vencimento',
  damaged: 'Avaria',
  wrong_address: 'Endereço Errado',
  partial_delivery: 'Entrega Parcial',
  return: 'Devolução',
  wrong_product: 'Mercadoria Invertida',
  boleto_extension: 'Prorrogação de Boleto',
  delivery_delay: 'Atraso na Entrega',
  other: 'Outro',
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

export type OperationalEvent = Omit<Tables<'operational_events'>, 'event_type'> & {
  event_type: OperationalEventType;
  loads?: { load_number: string } | null;
  drivers?: { id?: string; name: string } | null;
  clients?: { company_name: string } | null;
  vehicles?: { plate: string } | null;
};

export type OperationalEventCreate = Omit<TablesInsert<'operational_events'>, 'tenant_id' | 'created_by'>;
export type OperationalEventUpdate = Omit<TablesUpdate<'operational_events'>, 'id'> & { id: string };

export function useOperationalEvents() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['operational_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('operational_events')
        .select('*, loads(load_number), drivers(id, name), clients(company_name), vehicles(plate)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as OperationalEvent[];
    },
    enabled: !!currentTenant,
  });
}

export interface OperationalEventsFilters {
  status?: 'all' | 'open' | 'resolved';
  type?: string;          // 'all' or one of EVENT_TYPES
  severity?: string;      // 'all' | 'low' | 'medium' | 'high' | 'critical'
  vehicleId?: string;     // 'all' or uuid
  dateFrom?: Date | null;
  dateTo?: Date | null;
  driverId?: string;      // 'all' or uuid
  clientId?: string;      // 'all' or uuid
  loadId?: string;        // 'all' or uuid
  impactMin?: number | null;
  impactMax?: number | null;
  hasImpact?: boolean;    // true => only impact > 0
}

/**
 * Versão server-side: empurra filtros (tipo, status, severidade, veículo, datas)
 * para o Supabase. Otimizado para frotas grandes.
 * Busca textual continua no cliente sobre o resultado já reduzido.
 */
export function useOperationalEventsFiltered(filters: OperationalEventsFilters) {
  const { currentTenant } = useTenant();
  const fromKey = filters.dateFrom ? filters.dateFrom.toISOString().slice(0, 10) : null;
  const toKey = filters.dateTo ? filters.dateTo.toISOString().slice(0, 10) : null;
  return useQuery({
    queryKey: [
      'operational_events_filtered',
      currentTenant?.id,
      filters.status ?? 'open',
      filters.type ?? 'all',
      filters.severity ?? 'all',
      filters.vehicleId ?? 'all',
      filters.driverId ?? 'all',
      filters.clientId ?? 'all',
      filters.loadId ?? 'all',
      filters.impactMin ?? null,
      filters.impactMax ?? null,
      filters.hasImpact ? 1 : 0,
      fromKey,
      toKey,
    ],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('operational_events')
        .select('*, loads(load_number), drivers(id, name), clients(company_name), vehicles(plate)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(2000);

      if (filters.status === 'open') q = q.is('resolved_at', null);
      else if (filters.status === 'resolved') q = q.not('resolved_at', 'is', null);

      if (filters.type && filters.type !== 'all') q = q.eq('event_type', filters.type);
      if (filters.severity && filters.severity !== 'all') q = q.eq('severity', filters.severity);
      if (filters.vehicleId && filters.vehicleId !== 'all') q = q.eq('vehicle_id', filters.vehicleId);
      if (filters.driverId && filters.driverId !== 'all') q = q.eq('driver_id', filters.driverId);
      if (filters.clientId && filters.clientId !== 'all') q = q.eq('client_id', filters.clientId);
      if (filters.loadId && filters.loadId !== 'all') q = q.eq('load_id', filters.loadId);
      if (filters.hasImpact) q = q.gt('financial_impact', 0);
      if (typeof filters.impactMin === 'number' && !isNaN(filters.impactMin)) q = q.gte('financial_impact', filters.impactMin);
      if (typeof filters.impactMax === 'number' && !isNaN(filters.impactMax)) q = q.lte('financial_impact', filters.impactMax);

      if (filters.dateFrom) {
        const d = new Date(filters.dateFrom);
        d.setHours(0, 0, 0, 0);
        q = q.gte('created_at', d.toISOString());
      }
      if (filters.dateTo) {
        const d = new Date(filters.dateTo);
        d.setHours(23, 59, 59, 999);
        q = q.lte('created_at', d.toISOString());
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as OperationalEvent[];
    },
    enabled: !!currentTenant,
    placeholderData: (prev) => prev,
  });
}

export function useCreateOperationalEvent() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: OperationalEventCreate) => {
      const payload: TablesInsert<'operational_events'> = {
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      };
      const { data, error } = await supabase.from('operational_events').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_events'] }),
  });
}

export function useUpdateOperationalEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: OperationalEventUpdate) => {
      const payload: TablesUpdate<'operational_events'> = {
        ...values,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('operational_events').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_events'] }),
  });
}
