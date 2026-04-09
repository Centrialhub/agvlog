import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const ORDER_STATUSES = [
  'received', 'waiting_stock', 'picking', 'ready_for_loading',
  'loading', 'shipped', 'delivered', 'partially_delivered', 'cancelled',
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Recebido',
  waiting_stock: 'Aguardando Estoque',
  picking: 'Separação',
  ready_for_loading: 'Pronto p/ Carga',
  loading: 'Carregando',
  shipped: 'Expedido',
  delivered: 'Entregue',
  partially_delivered: 'Entrega Parcial',
  cancelled: 'Cancelado',
};

export interface Order {
  id: string;
  tenant_id: string;
  order_number: string;
  client_id: string | null;
  promised_date: string | null;
  origin: string | null;
  destination: string | null;
  cargo_type: string | null;
  quantity: number | null;
  pallet_count: number;
  weight_kg: number | null;
  volume_m3: number | null;
  notes: string | null;
  status: OrderStatus;
  remitter: string | null;
  recipient: string | null;
  nf_series: string | null;
  issue_date: string | null;
  value: number | null;
  payment_plan: string | null;
  freight_weight_value: number | null;
  freight_delivery_value: number | null;
  insurance_value: number | null;
  insurance_percent: number | null;
  toll_value: number | null;
  loading_value: number | null;
  tracking_value: number | null;
  gris_value: number | null;
  other_costs: number | null;
  icms_base: number | null;
  icms_rate: number | null;
  icms_value: number | null;
  pis_rate: number | null;
  pis_value: number | null;
  cofins_rate: number | null;
  cofins_value: number | null;
  total_freight: number | null;
  discount_value: number | null;
  subtotal: number | null;
  financial_value: number | null;
  payer_type: string | null;
  created_at: string;
  updated_at: string;
  clients?: { company_name: string } | null;
}

export function useOrders() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['orders', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('*, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Order[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateOrder() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Order>) => {
      const { data, error } = await supabase.from('orders').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useUpdateOrder() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Order> & { id: string }) => {
      const { data, error } = await supabase.from('orders').update({
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}
