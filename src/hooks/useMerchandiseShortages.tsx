import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { ShortageItemInput } from '@/lib/merchandiseShortages/shortageCalculator';
import type { ShortageReportRow } from '@/lib/merchandiseShortages/shortageReportBuilder';

export interface ShortageCaseRow {
  id: string;
  tenant_id: string;
  shortage_number: string | null;
  occurrence_date: string;
  company_name_snapshot: string | null;
  supplier_name_snapshot: string | null;
  driver_name_snapshot: string | null;
  vehicle_plate_snapshot: string | null;
  invoice_number: string | null;
  cte_number: string | null;
  load_number: string | null;
  city: string | null;
  state: string | null;
  customer_name_snapshot: string | null;
  status: string;
  shortage_type: string | null;
  responsible_party_type: string | null;
  responsible_driver_id: string | null;
  responsible_client_id: string | null;
  responsible_supplier_id: string | null;
  total_amount: number;
  amount_to_charge: number;
  amount_reimbursed: number;
  amount_written_off: number;
  observation: string | null;
  investigation_notes: string | null;
  responsibility_notes: string | null;
  driver_id: string | null;
  supplier_id: string | null;
  customer_id: string | null;
  load_id: string | null;
  cte_document_id: string | null;
  fiscal_document_id: string | null;
  occurrence_id: string | null;
  source_type: string;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShortageItemRow {
  id: string;
  tenant_id: string;
  shortage_case_id: string;
  product_code: string | null;
  product_description: string;
  quantity_text: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number;
  total_amount: number;
  item_observation: string | null;
  sort_order: number;
}

export interface ShortageFilters {
  month?: number | null;
  year?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  company?: string | null;
  supplier?: string | null;
  driver?: string | null;
  invoice?: string | null;
  cte?: string | null;
  loadId?: string | null;
  city?: string | null;
  customer?: string | null;
  product?: string | null;
  status?: string | null;
  responsibleParty?: string | null;
  shortageType?: string | null;
  onlyPending?: boolean;
  onlyFinalized?: boolean;
  onlyToCharge?: boolean;
}

export function useShortageCases(filters: ShortageFilters = {}) {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useQuery({
    queryKey: ['merchandise-shortage-cases', tenantId, filters],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase.from('merchandise_shortage_cases')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('occurrence_date', { ascending: false })
        .limit(1000);
      if (filters.periodStart) q = q.gte('occurrence_date', filters.periodStart);
      if (filters.periodEnd) q = q.lte('occurrence_date', filters.periodEnd);
      if (filters.month && filters.year) {
        const start = `${filters.year}-${String(filters.month).padStart(2, '0')}-01`;
        const endD = new Date(filters.year, filters.month, 0);
        const end = `${filters.year}-${String(filters.month).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
        q = q.gte('occurrence_date', start).lte('occurrence_date', end);
      }
      if (filters.company) q = q.ilike('company_name_snapshot', `%${filters.company}%`);
      if (filters.supplier) q = q.ilike('supplier_name_snapshot', `%${filters.supplier}%`);
      if (filters.driver) q = q.ilike('driver_name_snapshot', `%${filters.driver}%`);
      if (filters.invoice) q = q.ilike('invoice_number', `%${filters.invoice}%`);
      if (filters.cte) q = q.ilike('cte_number', `%${filters.cte}%`);
      if (filters.city) q = q.ilike('city', `%${filters.city}%`);
      if (filters.customer) q = q.ilike('customer_name_snapshot', `%${filters.customer}%`);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.responsibleParty) q = q.eq('responsible_party_type', filters.responsibleParty);
      if (filters.shortageType) q = q.eq('shortage_type', filters.shortageType);
      if (filters.loadId) q = q.eq('load_id', filters.loadId);
      if (filters.onlyPending) q = q.in('status', ['draft','pending_review','investigating','waiting_driver','waiting_supplier','waiting_client']);
      if (filters.onlyFinalized) q = q.in('status', ['closed','not_shortage','cancelled','written_off','reimbursed','charged']);
      if (filters.onlyToCharge) q = q.gt('amount_to_charge', 0);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ShortageCaseRow[];
    },
  });
}

export function useShortageItems(caseId: string | null | undefined) {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useQuery({
    queryKey: ['merchandise-shortage-items', tenantId, caseId],
    enabled: !!tenantId && !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase.from('merchandise_shortage_items')
        .select('*').eq('tenant_id', tenantId!).eq('shortage_case_id', caseId!)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ShortageItemRow[];
    },
  });
}

export interface CreateShortageInput {
  occurrence_date: string;
  company_name_snapshot?: string | null;
  supplier_name_snapshot?: string | null;
  driver_name_snapshot?: string | null;
  vehicle_plate_snapshot?: string | null;
  invoice_number?: string | null;
  cte_number?: string | null;
  load_number?: string | null;
  city?: string | null;
  state?: string | null;
  customer_name_snapshot?: string | null;
  observation?: string | null;
  status?: string;
  shortage_type?: string | null;
  driver_id?: string | null;
  supplier_id?: string | null;
  customer_id?: string | null;
  company_client_id?: string | null;
  load_id?: string | null;
  fiscal_document_id?: string | null;
  cte_document_id?: string | null;
  occurrence_id?: string | null;
  source_type?: string;
  import_batch_id?: string | null;
  metadata?: Record<string, unknown>;
  items: ShortageItemInput[];
}

export function useCreateShortageCase() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useMutation({
    mutationFn: async (input: CreateShortageInput) => {
      if (!tenantId) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('create_merchandise_shortage_case', {
        _tenant_id: tenantId,
        _payload: input as never,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchandise-shortage-cases'] });
    },
  });
}

export function useUpdateShortageStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { case_id: string; status: string; payload?: Record<string, unknown> }) => {
      const { error } = await supabase.rpc('update_merchandise_shortage_status', {
        _case_id: args.case_id,
        _status: args.status,
        _payload: (args.payload ?? {}) as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchandise-shortage-cases'] });
    },
  });
}

export function useShortageReportRows(filters: ShortageFilters = {}) {
  const cases = useShortageCases(filters);
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  const caseIds = (cases.data ?? []).map(c => c.id);
  const items = useQuery({
    queryKey: ['merchandise-shortage-items-batch', tenantId, caseIds],
    enabled: !!tenantId && caseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('merchandise_shortage_items')
        .select('*').eq('tenant_id', tenantId!).in('shortage_case_id', caseIds);
      if (error) throw error;
      return (data ?? []) as ShortageItemRow[];
    },
  });

  const rows: ShortageReportRow[] = [];
  const byCase = new Map<string, ShortageItemRow[]>();
  for (const it of items.data ?? []) {
    if (!byCase.has(it.shortage_case_id)) byCase.set(it.shortage_case_id, []);
    byCase.get(it.shortage_case_id)!.push(it);
  }
  for (const c of cases.data ?? []) {
    const its = byCase.get(c.id) ?? [];
    if (its.length === 0) {
      rows.push({
        occurrence_date: c.occurrence_date, company_name: c.company_name_snapshot,
        driver_name: c.driver_name_snapshot, invoice_number: c.invoice_number,
        city: c.city, customer_name: c.customer_name_snapshot,
        product_description: '(sem itens)', quantity_text: null, quantity: null, unit: null,
        unit_cost: 0, total_amount: c.total_amount, observation: c.observation,
        status: c.status, responsible_party_type: c.responsible_party_type,
      });
    } else {
      for (const it of its) {
        rows.push({
          occurrence_date: c.occurrence_date, company_name: c.company_name_snapshot,
          driver_name: c.driver_name_snapshot, invoice_number: c.invoice_number,
          city: c.city, customer_name: c.customer_name_snapshot,
          product_description: it.product_description, quantity_text: it.quantity_text,
          quantity: it.quantity, unit: it.unit, unit_cost: it.unit_cost,
          total_amount: it.total_amount, observation: it.item_observation || c.observation,
          status: c.status, responsible_party_type: c.responsible_party_type,
        });
      }
    }
  }
  return { rows, isLoading: cases.isLoading || items.isLoading, cases: cases.data ?? [] };
}

export function useShortageReports() {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useQuery({
    queryKey: ['merchandise-shortage-reports', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('merchandise_shortage_reports')
        .select('*').eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useImportBatches() {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useQuery({
    queryKey: ['merchandise-shortage-import-batches', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('merchandise_shortage_import_batches')
        .select('*').eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}
