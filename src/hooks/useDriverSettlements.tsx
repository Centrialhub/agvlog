import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';
import type { Database, Json, Tables } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';
import { parseSettlementList, parseSettlementFilterOptions } from '@/lib/financial/settlementListResponse';

type UpdateKmReviewRpcArgs = Database['public']['Functions']['update_driver_settlement_km_review']['Args'];
type NullableUpdateKmReviewRpcArgs = Omit<UpdateKmReviewRpcArgs, '_audited_km' | '_notes'> & {
  _audited_km: number | null;
  _notes: string | null;
};
type CreateManualSettlementRpcArgs = Database['public']['Functions']['create_manual_driver_settlement']['Args'];
type NullableCreateManualSettlementRpcArgs = Omit<CreateManualSettlementRpcArgs, '_vehicle_id' | '_reference_date'> & {
  _vehicle_id: string | null;
  _reference_date: string | null;
};

// PostgREST accepts SQL NULL for these nullable function parameters, but the
// generated Supabase function types currently expose only their scalar type.
const asUpdateKmReviewRpcArgs = (args: NullableUpdateKmReviewRpcArgs): UpdateKmReviewRpcArgs =>
  args as unknown as UpdateKmReviewRpcArgs;
const asCreateManualSettlementRpcArgs = (args: NullableCreateManualSettlementRpcArgs): CreateManualSettlementRpcArgs =>
  args as unknown as CreateManualSettlementRpcArgs;

export type DriverSettlementStatus =
  | 'pending_review' | 'in_review' | 'approved' | 'paid' | 'closed' | 'reopened';

export type DriverSettlement = Omit<Tables<'driver_settlements'>, 'status' | 'km_review_status'> & {
  status: DriverSettlementStatus;
  km_review_status: 'pending' | 'reviewed' | 'disputed' | null;
};

export type DriverSettlementItem = Omit<Tables<'driver_settlement_items'>, 'item_type' | 'nature'> & {
  item_type: 'load' | 'fiscal_document' | 'expense' | 'adjustment' | 'km';
  nature: 'credit' | 'debit' | null;
};

export type DriverSettlementListItem = DriverSettlement & { driver_name?: string | null; vehicle_plate?: string | null };
export type DriverSettlementWithRelations = DriverSettlement & {
  drivers: { name: string; cpf: string | null } | null;
  vehicles: { plate: string; brand: string | null; model: string | null } | null;
};

export interface DriverSettlementSummary {
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
}

function jsonRecord(value: Json): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver_settlements', currentTenant?.id, user?.id, filters],
    enabled: !!currentTenant && !!user,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!currentTenant) return { items: [] as DriverSettlementListItem[], total_count: 0, page: 1, page_size: 50, summary: null as DriverSettlementSummary | null };
      const { data, error } = await supabase.rpc('list_driver_settlements', {
        _tenant_id: currentTenant.id,
        _search: filters.search?.trim() || undefined,
        _driver_id: filters.driver_id ?? undefined,
        _vehicle_id: filters.vehicle_id ?? undefined,
        _status: filters.status ?? undefined,
        _date_from: filters.date_from ?? undefined,
        _date_to: filters.date_to ?? undefined,
        _only_km_pending: filters.only_km_pending ?? false,
        _only_expense_pending: filters.only_expense_pending ?? false,
        _only_no_freight: filters.only_no_freight ?? false,
        _only_needs_recalculation: filters.only_needs_recalculation ?? false,
        _page: filters.page ?? 1,
        _page_size: filters.page_size ?? 50,
      }).abortSignal(signal);
      if (error) throw error;
      return parseSettlementList(data, currentTenant.id);
    },
  });
}

export function useDriverSettlementFilterOptions() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver_settlement_filter_options', currentTenant?.id, user?.id],
    enabled: !!currentTenant && !!user,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!currentTenant) return { drivers: [], vehicles: [] };
      const { data, error } = await supabase.rpc('list_driver_settlement_filter_options', { _tenant_id: currentTenant.id }).abortSignal(signal);
      if (error) throw error;
      return parseSettlementFilterOptions(data);
    },
  });
}

export function useDriverSettlement(id: string | null) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const tenant = currentTenant?.id, actor = user?.id;
  return useQuery({
    queryKey: ['driver_settlement', tenant, actor, id],
    enabled: !!id && !!tenant && !!actor,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!id || !tenant || !actor) return null;
      const [{ data: settlement, error: e1 }, { data: items, error: e2 }, { data: events, error: e3 }, { data: payments, error: e4 }] = await Promise.all([
        supabase.from('driver_settlements').select('*, drivers(name, cpf), vehicles(plate, brand, model)').eq('tenant_id', tenant).eq('id', id).abortSignal(signal).maybeSingle(),
        supabase.from('driver_settlement_items').select('*').eq('tenant_id', tenant).eq('settlement_id', id).order('item_type').abortSignal(signal),
        supabase.from('driver_settlement_events').select('*').eq('tenant_id', tenant).eq('settlement_id', id).order('created_at', { ascending: false }).abortSignal(signal),
        supabase.from('driver_settlement_payments').select('*').eq('tenant_id', tenant).eq('settlement_id', id).order('paid_at', { ascending: false }).abortSignal(signal),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      return {
        settlement: settlement as unknown as DriverSettlementWithRelations | null,
        items: (items ?? []) as DriverSettlementItem[],
        events: events ?? [],
        payments: payments ?? [],
      };
    },
  });
}

export function useGeneratePendingDriverSettlements() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async () => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data, error } = await supabase.rpc('generate_pending_driver_settlements', { _tenant_id: currentTenant.id });
      if (error) throw error;
      const result = jsonRecord(data);
      return {
        generated: Number(result.generated ?? 0),
        recalculated: Number(result.recalculated ?? 0),
        skipped: Number(result.skipped ?? 0),
        errors: Array.isArray(result.errors) ? result.errors : [],
      };
    },
    onSuccess: (data) => {
      toast({
        title: 'Acertos processados',
        description: `Criados: ${data.generated} · Recalculados: ${data.recalculated ?? 0} · Ignorados: ${data.skipped}`,
      });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
    },
    onError: error => toast({ title: 'Falha ao gerar', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useRegenerateDriverSettlement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (dispatchTripId: string | { manualSettlementId: string }) => {
      if (!currentTenant) throw new Error('no_tenant');
      if (typeof dispatchTripId !== 'string') {
        const { data, error } = await supabase.rpc('recalculate_manual_expense_settlement', {
          _tenant_id: currentTenant.id, _settlement_id: dispatchTripId.manualSettlementId,
        });
        if (error) throw error;
        if (data !== dispatchTripId.manualSettlementId) throw new Error('Recálculo sem confirmação compatível.');
        return data;
      }
      const { data, error } = await supabase.rpc('generate_driver_settlement', {
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
    onError: error => toast({ title: 'Falha ao recalcular', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useUpdateDriverSettlementStatus() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reason, allow_exceptions }: { id: string; status: DriverSettlementStatus; reason?: string | null; allow_exceptions?: boolean }) => {
      const { data, error } = await supabase.rpc('update_driver_settlement_status', {
        _settlement_id: id, _new_status: status,
        _reason: reason ?? undefined, _allow_exceptions: allow_exceptions ?? false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Status atualizado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: error => toast({ title: 'Não foi possível alterar status', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useUpdateSettlementKmReview() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { 
      id: string; 
      audited_km: number | null; 
      km_status: 'pending' | 'reviewed' | 'disputed'; 
      notes: string | null;
      km_start?: number | null;
      km_end?: number | null;
      audited_start_location?: string | null;
      audited_end_location?: string | null;
    }) => {
      const rpcArgs = asUpdateKmReviewRpcArgs({
        _settlement_id: p.id, 
        _audited_km: p.audited_km, 
        _km_status: p.km_status, 
        _notes: p.notes,
        _km_start: p.km_start ?? undefined,
        _km_end: p.km_end ?? undefined,
        _audited_start_location: p.audited_start_location ?? undefined,
        _audited_end_location: p.audited_end_location ?? undefined,
      });
      const { data, error } = await supabase.rpc('update_driver_settlement_km_review', rpcArgs);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'KM atualizado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: error => toast({ title: 'Falha ao salvar KM', description: getErrorMessage(error), variant: 'destructive' }),
  });
}





export function useRegisterSettlementPayment() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id: string; amount: number;
      method?: string | null; account?: string | null; reference?: string | null;
      receipt_url?: string | null; notes?: string | null;
      allow_overpayment?: boolean; overpayment_reason?: string | null;
      bank_account_id?: string | null;
      cost_center?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('register_driver_settlement_payment_v2', {
        _settlement_id: p.id, _amount: p.amount,
        _payment_method: p.method ?? 'pix', _payment_account: p.account ?? undefined,
        _payment_reference: p.reference ?? undefined, _receipt_url: p.receipt_url ?? undefined,
        _notes: p.notes ?? undefined,
        _allow_overpayment: p.allow_overpayment ?? false,
        _overpayment_reason: p.overpayment_reason ?? undefined,
        _bank_account_id: p.bank_account_id ?? undefined,
        _cost_center: p.cost_center ?? 'Operacional',
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Pagamento registrado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: error => toast({ title: 'Falha ao registrar pagamento', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useSettleZeroDriverSettlement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('settle_zero_driver_settlement', {
        _settlement_id: p.id, _reason: p.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Acerto quitado sem pagamento' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: error => toast({ title: 'Falha ao quitar acerto', description: getErrorMessage(error), variant: 'destructive' }),
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
      const { data, error } = await supabase.rpc('list_available_loads_for_settlement', {
        _tenant_id: currentTenant.id,
        _driver_id: driver_id ?? undefined,
        _search: (search ?? '').trim() || undefined,
        _include_settlement_id: include_settlement_id ?? undefined,
        _limit: 200,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as AvailableLoad[];
    },
  });
}

export function useCreateManualDriverSettlement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (p: { driver_id: string; vehicle_id?: string | null; reference_date?: string | null; load_ids: string[] }) => {
      if (!currentTenant) throw new Error('no_tenant');
      const rpcArgs = asCreateManualSettlementRpcArgs({
        _tenant_id: currentTenant.id,
        _driver_id: p.driver_id,
        _vehicle_id: p.vehicle_id ?? null,
        _reference_date: p.reference_date ?? null,
        _load_ids: p.load_ids,
      });
      const { data, error } = await supabase.rpc('create_manual_driver_settlement', rpcArgs);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: 'Acerto manual criado' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['available_loads_for_settlement'] });
    },
    onError: error => toast({ title: 'Falha ao criar acerto', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useAttachLoadsToSettlement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { settlement_id: string; load_ids: string[] }) => {
      const { error } = await supabase.rpc('attach_loads_to_driver_settlement', {
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
    onError: error => toast({ title: 'Falha ao vincular', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useDetachLoadFromSettlement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { settlement_id: string; load_id: string }) => {
      const { error } = await supabase.rpc('detach_load_from_driver_settlement', {
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
    onError: error => toast({ title: 'Falha ao remover romaneio', description: getErrorMessage(error), variant: 'destructive' }),
  });
}

export function useDeleteDriverSettlement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('delete_driver_settlement', {
        _settlement_id: p.id,
        _reason: p.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Acerto excluído com sucesso' });
      qc.invalidateQueries({ queryKey: ['driver_settlements'] });
      qc.invalidateQueries({ queryKey: ['available_loads_for_settlement'] });
    },
    onError: error => toast({ title: 'Falha ao excluir acerto', description: getErrorMessage(error), variant: 'destructive' }),
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
  // Manual additions of expenses and adjustments are now allowed even when approved/paid
  // Only 'closed' should strictly lock everything.
  return s === 'closed';
}
