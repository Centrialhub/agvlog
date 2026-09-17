import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';
import type { Database, Json, Tables } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';
import { parseSettlementList, parseSettlementFilterOptions, type DriverSettlementCursor } from '@/lib/financial/settlementListResponse';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

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

export function formatSettlementGenerationError(value: unknown, index: number): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    const identity = [item.trip_id, item.settlement_id, item.id].find(candidate => typeof candidate === 'string');
    const reason = [item.error, item.message, item.code].find(candidate => typeof candidate === 'string');
    if (identity || reason) return `${identity ? `Viagem/acerto ${identity}` : `Item ${index + 1}`}: ${reason || 'falha não detalhada'}`;
  }
  return `Item ${index + 1}: falha não detalhada`;
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
  snapshot_at?: string;
  cursor?: DriverSettlementCursor;
  enabled?: boolean;
}

export class DriverSettlementSnapshotChangedError extends Error {}

let driverSettlementCollectionEpoch = 0;
const driverSettlementCollectionListeners = new Set<() => void>();
const subscribeDriverSettlementCollection = (listener: () => void) => {
  driverSettlementCollectionListeners.add(listener);
  return () => driverSettlementCollectionListeners.delete(listener);
};
const readDriverSettlementCollectionEpoch = () => driverSettlementCollectionEpoch;
export function useDriverSettlementCollectionEpoch() {
  return useSyncExternalStore(
    subscribeDriverSettlementCollection,
    readDriverSettlementCollectionEpoch,
    readDriverSettlementCollectionEpoch,
  );
}
function invalidateDriverSettlementCollection(qc: QueryClient) {
  driverSettlementCollectionEpoch += 1;
  driverSettlementCollectionListeners.forEach(listener => listener());
  void qc.invalidateQueries({ queryKey: ['driver_settlements'] });
}

export function useDriverSettlements(filters: ListSettlementsFilters = {}) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver_settlements', currentTenant?.id, user?.id, filters],
    enabled: !!currentTenant && !!user && filters.enabled !== false,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const { data, error } = await supabase.rpc('list_driver_settlements_v2', {
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
        _snapshot_at: filters.snapshot_at,
        _cursor: filters.cursor ?? undefined,
        _page_size: filters.page_size ?? 50,
      }).abortSignal(signal);
      if (error) throw error;
      return parseSettlementList(data, currentTenant.id);
    },
  });
}

const settlementFilterRevisions=new Map<string,string>();
export function useDriverSettlementFilterOptions(kind:'drivers'|'vehicles',search='',page=1) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver_settlement_filter_options', currentTenant?.id, user?.id,kind,search,page],
    enabled: !!currentTenant && !!user,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const key=`${currentTenant.id}:${kind}:${search}`,expected=page===1?null:settlementFilterRevisions.get(key);if(page>1&&!expected)throw new Error('Atualize a primeira página das opções.');
      const { data, error } = await supabase.rpc('list_driver_settlement_filter_options', { _tenant_id: currentTenant.id,_kind:kind,_search:search,_page:page,_page_size:50,_expected_revision:expected }).abortSignal(signal);
      if (error) {
        if (error.code === '40001' || error.message.includes('settlement_snapshot_changed')) {
          throw new DriverSettlementSnapshotChangedError('Os acertos mudaram durante a navegação. A lista foi atualizada desde a primeira página.');
        }
        throw error;
      }
      const result=parseSettlementFilterOptions(data,currentTenant.id,kind);if(expected&&result.revision!==expected)throw new Error('As opções mudaram.');if(page===1)settlementFilterRevisions.set(key,result.revision);return result;
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
      const [{ data: settlement, error: e1 }, items, events, payments] = await Promise.all([
        supabase.from('driver_settlements').select('*, drivers(name, cpf), vehicles(plate, brand, model)').eq('tenant_id', tenant).eq('id', id).abortSignal(signal).maybeSingle(),
        fetchAllPostgrestPages((from, to) => supabase.from('driver_settlement_items').select('*').eq('tenant_id', tenant).eq('settlement_id', id).order('item_type').order('id').range(from, to).abortSignal(signal)),
        fetchAllPostgrestPages((from, to) => supabase.from('driver_settlement_events').select('*').eq('tenant_id', tenant).eq('settlement_id', id).order('created_at', { ascending: false }).order('id').range(from, to).abortSignal(signal)),
        fetchAllPostgrestPages((from, to) => supabase.from('driver_settlement_payments').select('*').eq('tenant_id', tenant).eq('settlement_id', id).order('paid_at', { ascending: false }).order('id').range(from, to).abortSignal(signal)),
      ]);
      if (e1) throw e1;
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
        errors: Array.isArray(result.errors) ? result.errors.map(formatSettlementGenerationError) : [],
      };
    },
    onSuccess: (data) => {
      toast({
        title: data.errors.length ? 'Acertos processados com falhas' : 'Acertos processados',
        description: `Criados: ${data.generated} · Recalculados: ${data.recalculated ?? 0} · Ignorados: ${data.skipped}${data.errors.length ? ` · Falhas: ${data.errors.length}` : ''}`,
        variant: data.errors.length ? 'destructive' : 'default',
      });
      invalidateDriverSettlementCollection(qc);
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
      invalidateDriverSettlementCollection(qc);
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
      if (allow_exceptions && !reason?.trim()) throw new Error('Informe uma justificativa para a aprovação com exceção.');
      const { data, error } = await supabase.rpc('update_driver_settlement_status', {
        _settlement_id: id, _new_status: status,
        _reason: reason?.trim() || undefined, _allow_exceptions: allow_exceptions ?? false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Status atualizado' });
      invalidateDriverSettlementCollection(qc);
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
      invalidateDriverSettlementCollection(qc);
      qc.invalidateQueries({ queryKey: ['driver_settlement'] });
    },
    onError: error => toast({ title: 'Falha ao salvar KM', description: getErrorMessage(error), variant: 'destructive' }),
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
      invalidateDriverSettlementCollection(qc);
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
  page?: number;
  page_size?: number;
  enabled?: boolean;
}) {
  const { currentTenant } = useTenant();
  const { driver_id = null, search = null, include_settlement_id = null, page = 1, page_size = 100, enabled = true } = params;
  return useQuery({
    queryKey: ['available_loads_for_settlement', currentTenant?.id, driver_id, search, include_settlement_id, page, page_size],
    enabled: !!currentTenant && enabled,
    queryFn: async () => {
      if (!currentTenant) return { rows: [] as AvailableLoad[], total: 0, page: 1, page_size };
      const { data, error } = await supabase.rpc('list_available_loads_for_settlement_v2' as never, {
        _tenant_id: currentTenant.id, _driver_id: driver_id, _search: (search ?? '').trim() || null,
        _include_settlement_id: include_settlement_id, _page: page, _page_size: page_size,
      } as never);
      if (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '40001') throw new DriverSettlementSnapshotChangedError('Os acertos mudaram. A lista foi atualizada desde a primeira página.');
        throw error;
      }
      const result = data as unknown as { rows?: AvailableLoad[]; total?: number; page?: number; page_size?: number } | null;
      return { rows: Array.isArray(result?.rows) ? result.rows : [], total: Number(result?.total ?? 0),
        page: Number(result?.page ?? page), page_size: Number(result?.page_size ?? page_size) };
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
      invalidateDriverSettlementCollection(qc);
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
      invalidateDriverSettlementCollection(qc);
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
      invalidateDriverSettlementCollection(qc);
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
      invalidateDriverSettlementCollection(qc);
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
