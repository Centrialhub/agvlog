import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { toast } from '@/hooks/use-toast';

export type DriverSettlementStatus =
  | 'pending_review' | 'in_review' | 'approved' | 'paid' | 'closed' | 'reopened';

export interface DriverSettlement {
  id: string;
  tenant_id: string;
  dispatch_trip_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: DriverSettlementStatus;
  trip_started_at: string | null;
  trip_completed_at: string | null;
  route_name: string | null;
  route_origin: string | null;
  route_destination: string | null;
  loads_count: number;
  stops_count: number;
  documents_count: number;
  total_invoice_value: number;
  total_freight_value: number;
  total_weight_kg: number;
  estimated_km: number | null;
  audited_km: number | null;
  km_review_status: 'pending' | 'reviewed' | 'disputed';
  km_review_notes: string | null;
  approved_expenses_total: number;
  pending_expenses_total: number;
  rejected_expenses_total: number;
  expenses_total: number;
  invoice_balance: number;
  operational_balance: number;
  manual_adjustments_total: number;
  final_amount: number;
  created_at: string;
  updated_at: string;
}

export interface DriverSettlementItem {
  id: string;
  settlement_id: string;
  item_type: 'load' | 'fiscal_document' | 'expense' | 'adjustment' | 'km';
  source_table: string | null;
  source_id: string | null;
  description: string | null;
  amount: number;
  quantity: number | null;
  metadata: Record<string, any>;
  created_at: string;
}

export function useDriverSettlements() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver_settlements', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async (): Promise<(DriverSettlement & { driver_name?: string; vehicle_plate?: string })[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('driver_settlements' as any)
        .select('*, drivers(name), vehicles(license_plate)')
        .eq('tenant_id', currentTenant.id)
        .order('trip_completed_at', { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]).map((s) => ({
        ...s,
        driver_name: s.drivers?.name ?? null,
        vehicle_plate: s.vehicles?.license_plate ?? null,
      })) as any;
    },
  });
}

export function useDriverSettlement(id: string | null) {
  return useQuery({
    queryKey: ['driver_settlement', id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const [{ data: settlement, error: e1 }, { data: items, error: e2 }] = await Promise.all([
        supabase.from('driver_settlements' as any).select('*, drivers(name, cpf), vehicles(license_plate, brand, model)').eq('id', id).maybeSingle(),
        supabase.from('driver_settlement_items' as any).select('*').eq('settlement_id', id).order('item_type'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { settlement: settlement as any, items: (items as any[]) ?? [] };
    },
  });
}

export function useGeneratePendingDriverSettlements() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async () => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data, error } = await supabase.rpc('generate_pending_driver_settlements' as any, { _tenant_id: currentTenant.id });
      if (error) throw error;
      return data as { generated: number; skipped: number; errors: any[] };
    },
    onSuccess: (data) => {
      toast({ title: 'Acertos gerados', description: `Novos: ${data.generated} · Ignorados: ${data.skipped}` });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao gerar', description: e.message, variant: 'destructive' }),
  });
}

export function useRegenerateDriverSettlement() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (dispatchTripId: string) => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data, error } = await supabase.rpc('generate_driver_settlement' as any, {
        _tenant_id: currentTenant.id, _dispatch_trip_id: dispatchTripId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Acerto recalculado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao recalcular', description: e.message, variant: 'destructive' }),
  });
}

export function useUpdateDriverSettlementStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DriverSettlementStatus }) => {
      const { data, error } = await supabase.rpc('update_driver_settlement_status' as any, { _settlement_id: id, _new_status: status });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Status atualizado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Transição inválida', description: e.message, variant: 'destructive' }),
  });
}

export function useUpdateSettlementKmReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; audited_km: number | null; km_status: 'pending' | 'reviewed' | 'disputed'; notes: string | null }) => {
      const { data, error } = await supabase.rpc('update_settlement_km_review' as any, {
        _settlement_id: p.id, _audited_km: p.audited_km, _km_status: p.km_status, _notes: p.notes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'KM atualizado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao salvar KM', description: e.message, variant: 'destructive' }),
  });
}

export const SETTLEMENT_STATUS_LABEL: Record<DriverSettlementStatus, string> = {
  pending_review: 'Pendente',
  in_review: 'Em conferência',
  approved: 'Aprovado',
  paid: 'Pago',
  closed: 'Fechado',
  reopened: 'Reaberto',
};

export const SETTLEMENT_STATUS_VARIANT: Record<DriverSettlementStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending_review: 'secondary',
  in_review: 'default',
  approved: 'default',
  paid: 'default',
  closed: 'outline',
  reopened: 'destructive',
};

export function isLocked(s: DriverSettlementStatus) {
  return s === 'approved' || s === 'paid' || s === 'closed';
}