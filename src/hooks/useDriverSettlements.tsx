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
  // hardening fields
  total_goods_value?: number;
  total_freight_revenue?: number;
  route_result?: number;
  driver_credits_total?: number;
  driver_debits_total?: number;
  driver_reimbursement_total?: number;
  driver_payable_amount?: number;
  total_paid_amount?: number;
  payment_balance?: number;
  last_recalculated_at?: string | null;
  needs_recalculation?: boolean;
  recalculation_reason?: string | null;
  source_updated_at?: string | null;
  approved_with_exception?: boolean;
  exception_reason?: string | null;
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
  nature?: 'credit' | 'debit' | null;
}

export interface ListSettlementsFilters {
  search?: string;
  driver_id?: string | null;
  vehicle_id?: string | null;
  status?: DriverSettlementStatus | null;
  date_from?: string | null;
  date_to?: string | null;
  only_km_pending?: boolean;
  only_expense_pending?: boolean;
  only_no_freight?: boolean;
  only_needs_recalculation?: boolean;
  page?: number;
  page_size?: number;
}

export function useDriverSettlements(filters: ListSettlementsFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver_settlements', currentTenant?.id, filters],
    enabled: !!currentTenant,
    queryFn: async () => {
      if (!currentTenant) return { items: [], total_count: 0, page: 1, page_size: 50, summary: null as any };
      const { data, error } = await supabase.rpc('list_driver_settlements' as any, {
        _tenant_id: currentTenant.id,
        _search: filters.search?.trim() || null,
        _driver_id: filters.driver_id ?? null,
        _vehicle_id: filters.vehicle_id ?? null,
        _status: filters.status ?? null,
        _date_from: filters.date_from ?? null,
        _date_to: filters.date_to ?? null,
        _only_km_pending: filters.only_km_pending ?? false,
        _only_expense_pending: filters.only_expense_pending ?? false,
        _only_no_freight: filters.only_no_freight ?? false,
        _only_needs_recalculation: filters.only_needs_recalculation ?? false,
        _page: filters.page ?? 1,
        _page_size: filters.page_size ?? 50,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        items: (d.items ?? []) as (DriverSettlement & { driver_name?: string; vehicle_plate?: string })[],
        total_count: Number(d.total_count ?? 0),
        page: Number(d.page ?? 1),
        page_size: Number(d.page_size ?? 50),
        summary: (d.summary ?? null) as null | {
          total_count: number;
          pending_count: number;
          in_review_count: number;
          approved_count: number;
          paid_closed_count: number;
          needs_recalculation_count: number;
          km_pending_count: number;
          expense_pending_count: number;
          total_payable: number;
          total_paid: number;
          payment_balance: number;
          route_result_total: number;
          approved_expenses_total: number;
        },
      };
    },
  });
}

export function useDriverSettlementFilterOptions() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver_settlement_filter_options', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async () => {
      if (!currentTenant) return { drivers: [], vehicles: [] };
      const { data, error } = await supabase.rpc('list_driver_settlement_filter_options' as any, { _tenant_id: currentTenant.id });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        drivers: (d.drivers ?? []) as { id: string; name: string }[],
        vehicles: (d.vehicles ?? []) as { id: string; plate: string }[],
      };
    },
  });
}

export function useDriverSettlement(id: string | null) {
  return useQuery({
    queryKey: ['driver_settlement', id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const [{ data: settlement, error: e1 }, { data: items, error: e2 }, { data: events, error: e3 }, { data: payments, error: e4 }] = await Promise.all([
        supabase.from('driver_settlements' as any).select('*, drivers(name, cpf), vehicles(plate, brand, model)').eq('id', id).maybeSingle(),
        supabase.from('driver_settlement_items' as any).select('*').eq('settlement_id', id).order('item_type'),
        supabase.from('driver_settlement_events' as any).select('*').eq('settlement_id', id).order('created_at', { ascending: false }),
        supabase.from('driver_settlement_payments' as any).select('*').eq('settlement_id', id).order('paid_at', { ascending: false }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      return {
        settlement: settlement as any,
        items: (items as any[]) ?? [],
        events: (events as any[]) ?? [],
        payments: (payments as any[]) ?? [],
      };
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
      return data as { generated: number; recalculated: number; skipped: number; errors: any[] };
    },
    onSuccess: (data) => {
      toast({
        title: 'Acertos processados',
        description: `Criados: ${data.generated} · Recalculados: ${data.recalculated ?? 0} · Ignorados: ${data.skipped}`,
      });
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
    mutationFn: async ({ id, status, reason, allow_exceptions }: { id: string; status: DriverSettlementStatus; reason?: string | null; allow_exceptions?: boolean }) => {
      const { data, error } = await supabase.rpc('update_driver_settlement_status' as any, {
        _settlement_id: id, _new_status: status,
        _reason: reason ?? null, _allow_exceptions: allow_exceptions ?? false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Status atualizado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Não foi possível alterar status', description: e.message, variant: 'destructive' }),
  });
}

export function useUpdateSettlementKmReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; audited_km: number | null; km_status: 'pending' | 'reviewed' | 'disputed'; notes: string | null }) => {
      const { data, error } = await supabase.rpc('update_driver_settlement_km_review' as any, {
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

export function useAddSettlementAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; nature: 'credit' | 'debit'; amount: number; description: string; reason: string }) => {
      const { data, error } = await supabase.rpc('add_driver_settlement_adjustment' as any, {
        _settlement_id: p.id, _nature: p.nature, _amount: p.amount, _description: p.description, _reason: p.reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Ajuste registrado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao registrar ajuste', description: e.message, variant: 'destructive' }),
  });
}

export function useRemoveSettlementAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { settlement_id: string; item_id: string; reason: string }) => {
      const { error } = await supabase.rpc('remove_driver_settlement_adjustment' as any, {
        _settlement_id: p.settlement_id, _item_id: p.item_id, _reason: p.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Ajuste removido' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao remover ajuste', description: e.message, variant: 'destructive' }),
  });
}

export function useRegisterSettlementPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id: string; amount: number;
      method?: string | null; account?: string | null; reference?: string | null;
      receipt_url?: string | null; notes?: string | null;
      allow_overpayment?: boolean; overpayment_reason?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('register_driver_settlement_payment' as any, {
        _settlement_id: p.id, _amount: p.amount,
        _payment_method: p.method ?? null, _payment_account: p.account ?? null,
        _payment_reference: p.reference ?? null, _receipt_url: p.receipt_url ?? null,
        _notes: p.notes ?? null,
        _allow_overpayment: p.allow_overpayment ?? false,
        _overpayment_reason: p.overpayment_reason ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Pagamento registrado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao registrar pagamento', description: e.message, variant: 'destructive' }),
  });
}

export function useSettleZeroDriverSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('settle_zero_driver_settlement' as any, {
        _settlement_id: p.id, _reason: p.reason,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      toast({ title: 'Acerto quitado sem pagamento' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao quitar acerto', description: e.message, variant: 'destructive' }),
  });
}

export interface AvailableLoad {
  id: string;
  load_number: string | null;
  origin: string | null;
  destination: string | null;
  status: string | null;
  total_weight_kg: number | null;
  total_pallet_count: number | null;
  gross_cargo_value: number | null;
  freight_amount: number | null;
  invoice_count: number | null;
  load_date: string | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
}

export function useAvailableLoadsForSettlement(params: {
  driver_id?: string | null;
  search?: string | null;
  include_settlement_id?: string | null;
  enabled?: boolean;
}) {
  const { currentTenant } = useTenant();
  const { driver_id = null, search = null, include_settlement_id = null, enabled = true } = params;
  return useQuery({
    queryKey: ['available_loads_for_settlement', currentTenant?.id, driver_id, search, include_settlement_id],
    enabled: !!currentTenant && enabled,
    queryFn: async () => {
      if (!currentTenant) return [] as AvailableLoad[];
      const { data, error } = await supabase.rpc('list_available_loads_for_settlement' as any, {
        _tenant_id: currentTenant.id,
        _driver_id: driver_id,
        _search: (search ?? '').trim() || null,
        _include_settlement_id: include_settlement_id,
        _limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as AvailableLoad[];
    },
  });
}

export function useCreateManualDriverSettlement() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (p: { driver_id: string; vehicle_id?: string | null; reference_date?: string | null; load_ids: string[] }) => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data, error } = await supabase.rpc('create_manual_driver_settlement' as any, {
        _tenant_id: currentTenant.id,
        _driver_id: p.driver_id,
        _vehicle_id: p.vehicle_id ?? null,
        _reference_date: p.reference_date ?? null,
        _load_ids: p.load_ids,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Acerto manual criado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['available_loads_for_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao criar acerto', description: e.message, variant: 'destructive' }),
  });
}

export function useAttachLoadsToSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { settlement_id: string; load_ids: string[] }) => {
      const { error } = await supabase.rpc('attach_loads_to_driver_settlement' as any, {
        _settlement_id: p.settlement_id, _load_ids: p.load_ids,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Romaneios vinculados' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
      qc.invalidateQueries({ queryKey: ['available_loads_for_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao vincular', description: e.message, variant: 'destructive' }),
  });
}

export function useDetachLoadFromSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { settlement_id: string; load_id: string }) => {
      const { error } = await supabase.rpc('detach_load_from_driver_settlement' as any, {
        _settlement_id: p.settlement_id, _load_id: p.load_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Romaneio removido do acerto' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
      qc.invalidateQueries({ queryKey: ['available_loads_for_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao remover romaneio', description: e.message, variant: 'destructive' }),
  });
}

export function useAddSettlementManualExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      settlement_id: string;
      category: string;
      amount: number;
      expense_at: string;
      cost_center: string;
      payment_source?: string;
      reimbursable?: boolean;
      receipt_url?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc('add_driver_settlement_manual_expense' as any, {
        _settlement_id: p.settlement_id,
        _category: p.category,
        _amount: p.amount,
        _expense_at: p.expense_at,
        _cost_center: p.cost_center,
        _payment_source: p.payment_source ?? 'driver',
        _reimbursable: p.reimbursable ?? true,
        _receipt_url: p.receipt_url ?? null,
        _notes: p.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Despesa manual adicionada' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: (e: any) => toast({ title: 'Falha ao adicionar despesa', description: e.message, variant: 'destructive' }),
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