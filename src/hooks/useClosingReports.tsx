import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { Json, Tables, TablesInsert } from '@/integrations/supabase/types';
import {
  buildPreview,
  computeClosingPaymentStatus,
  type BuilderInput,
  type BuiltItem,
  type BuiltPreview,
  type FreightAllocation,
  type ReportType,
  type ReportModel,
  type RawCte,
  type RawFiscalDoc,
  type RawLoad,
  type SummaryLine,
} from '@/lib/closingReports/closingReportBuilder';

export interface ClosingReportRow {
  id: string;
  tenant_id: string;
  client_id: string | null;
  payer_client_id: string | null;
  closing_number: string;
  title: string;
  report_type: ReportType;
  report_model: ReportModel;
  period_start: string;
  period_end: string;
  status: string;
  payment_status: string;
  invoice_status: string;
  total_invoice_value: number;
  total_freight_value: number;
  total_weight_kg: number;
  total_volume: number;
  load_count: number;
  fiscal_document_count: number;
  cte_count: number;
  gross_amount: number;
  discount_amount: number;
  interest_amount: number;
  total_amount: number;
  received_amount: number;
  open_amount: number;
  expected_payment_date: string | null;
  payment_date: string | null;
  notes: string | null;
  client_invoice_id: string | null;
  receivable_id: string | null;
  sent_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  client?: { id: string; name: string } | null;
}

export interface ClosingReportDetail {
  header: ClosingReportRow | null;
  items: Tables<'closing_report_items'>[];
  summary: Tables<'closing_report_summary_lines'>[];
  payments: Tables<'closing_report_payments'>[];
}

const deliveryMeta = (value: Json): RawFiscalDoc['delivery_meta'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { delivered_at: typeof value.delivered_at === 'string' ? value.delivered_at : null };
};

export interface ClosingFilters {
  clientId?: string | null;
  payerId?: string | null;
  reportType?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  closingNumber?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  plate?: string | null;
  driverName?: string | null;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', reviewing: 'Em conferência', closed: 'Fechado', sent: 'Enviado',
  invoiced: 'Faturado', paid: 'Pago', partially_paid: 'Pago parcial', overdue: 'Vencido', cancelled: 'Cancelado',
};
export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Não pago', partially_paid: 'Pago parcial', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado',
};
export const REPORT_TYPE_LABELS: Record<string, string> = {
  weekly: 'Semanal', ten_day: 'Decenal', fortnightly: 'Quinzenal', monthly: 'Mensal', custom: 'Período livre',
};

// ------- LIST -------
export function useClosingReportsList(filters: ClosingFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['closing-reports', currentTenant?.id, filters],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      const tenantId = currentTenant?.id;
      if (!tenantId) return [];
      let q = supabase.from('closing_reports')
        .select('*, client:clients!closing_reports_client_id_fkey(id, name:company_name)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (filters.clientId) q = q.eq('client_id', filters.clientId);
      if (filters.payerId) q = q.eq('payer_client_id', filters.payerId);
      if (filters.reportType) q = q.eq('report_type', filters.reportType);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.paymentStatus) q = q.eq('payment_status', filters.paymentStatus);
      if (filters.closingNumber) q = q.ilike('closing_number', `%${filters.closingNumber}%`);
      if (filters.periodFrom) q = q.gte('period_end', filters.periodFrom);
      if (filters.periodTo) q = q.lte('period_start', filters.periodTo);
      if (filters.plate) q = q.contains('vehicle_plates_snapshot', [filters.plate.toUpperCase()]);
      if (filters.driverName) q = q.contains('driver_names_snapshot', [filters.driverName.toUpperCase()]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ClosingReportRow[];
    },
  });
}

export function useClosingReport(id: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['closing-report', currentTenant?.id, id],
    enabled: !!id && !!currentTenant?.id,
    queryFn: async (): Promise<ClosingReportDetail> => {
      const tenantId = currentTenant?.id;
      if (!id || !tenantId) return { header: null, items: [], summary: [], payments: [] };
      const [{ data: header, error: e1 }, { data: items, error: e2 }, { data: summary, error: e3 }, { data: payments, error: e4 }] = await Promise.all([
        supabase.from('closing_reports').select('*, client:clients!closing_reports_client_id_fkey(id, name:company_name), payer:clients!closing_reports_payer_client_id_fkey(id, name:company_name)').eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('closing_report_items').select('*').eq('closing_report_id', id).eq('tenant_id', tenantId).order('sort_order'),
        supabase.from('closing_report_summary_lines').select('*').eq('closing_report_id', id).eq('tenant_id', tenantId).order('sort_order'),
        supabase.from('closing_report_payments').select('*').eq('closing_report_id', id).eq('tenant_id', tenantId).order('payment_date', { ascending: false }),
      ]);
      if (e1 || e2 || e3 || e4) throw (e1 || e2 || e3 || e4);
      return { header: header as ClosingReportRow | null, items: items ?? [], summary: summary ?? [], payments: payments ?? [] };
    },
  });
}

// ------- PREVIEW -------
export interface PreviewInputs {
  clientId?: string | null;
  periodStart: string;
  periodEnd: string;
  onlyWithCte?: boolean;
  onlyDelivered?: boolean;
  freightAllocation?: FreightAllocation;
  vehicleId?: string | null;
  driverId?: string | null;
}

export function useBuildPreview() {
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (inp: PreviewInputs): Promise<BuiltPreview> => {
      if (!currentTenant?.id) throw new Error('tenant');
      let fq = supabase.from('fiscal_documents')
        .select('id, invoice_number, access_key, issue_date, origin_city, origin_state, remitter, remitter_cnpj, recipient, recipient_cnpj, recipient_city, recipient_state, value, weight_kg, volume_count, freight_value, freight_cif_value, freight_fob_value, load_id, client_id, imported_note_status, delivery_meta')
        .eq('tenant_id', currentTenant.id)
        .gte('issue_date', inp.periodStart)
        .lte('issue_date', inp.periodEnd);
      if (inp.clientId) fq = fq.eq('client_id', inp.clientId);
      const { data: fiscalDocs, error: fe } = await fq;
      if (fe) throw fe;

      const rawFiscalDocs: RawFiscalDoc[] = (fiscalDocs ?? []).map(document => ({
        ...document,
        delivery_meta: deliveryMeta(document.delivery_meta),
      }));
      const loadIds = Array.from(new Set(
        rawFiscalDocs.map(document => document.load_id).filter((loadId): loadId is string => !!loadId),
      ));
      const [{ data: ctes, error: ce }, { data: loads, error: le }] = await Promise.all([
        loadIds.length ? supabase.from('cte_documents')
          .select('id, cte_number, access_key, freight_value, weight_kg, fiscal_document_ids, issued_at')
          .eq('tenant_id', currentTenant.id)
          .overlaps('load_ids', loadIds) : Promise.resolve({ data: [], error: null }),
        loadIds.length ? supabase.from('loads')
          .select('id, load_number, external_load_number, arrival_date, load_date, gate_departure_at, arrival_at, vehicle_id, driver_id, vehicle:vehicles!loads_vehicle_id_fkey(plate), driver:drivers!loads_driver_id_fkey(name)')
          .eq('tenant_id', currentTenant.id)
          .in('id', loadIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (ce || le) throw (ce || le);

      const rawCtes: RawCte[] = ctes ?? [];
      let filtered = rawFiscalDocs;
      if (inp.onlyWithCte) {
        const linkedIds = new Set<string>();
        for (const cte of rawCtes) {
          for (const documentId of cte.fiscal_document_ids ?? []) linkedIds.add(documentId);
        }
        filtered = filtered.filter(document => linkedIds.has(document.id));
      }
      if (inp.onlyDelivered) filtered = filtered.filter(document => document.delivery_meta?.delivered_at);

      let filteredLoads = (loads ?? []) as unknown as RawLoad[];
      if (inp.vehicleId) filteredLoads = filteredLoads.filter(l => l.vehicle_id === inp.vehicleId);
      if (inp.driverId) filteredLoads = filteredLoads.filter(l => l.driver_id === inp.driverId);
      if (inp.vehicleId || inp.driverId) {
        const okLoadIds = new Set(filteredLoads.map(l => l.id));
        filtered = filtered.filter(d => d.load_id && okLoadIds.has(d.load_id));
      }

      const input: BuilderInput = { fiscalDocs: filtered, ctes: rawCtes, loads: filteredLoads, freightAllocation: inp.freightAllocation };
      return buildPreview(input);
    },
  });
}

// ------- CREATE -------
export interface CreatePayload {
  clientId?: string | null;
  payerClientId?: string | null;
  title: string;
  reportType: ReportType;
  reportModel: ReportModel;
  periodStart: string;
  periodEnd: string;
  issueDateStart?: string | null;
  issueDateEnd?: string | null;
  expectedPaymentDate?: string | null;
  notes?: string | null;
  preview: BuiltPreview;
  filtersSnapshot?: Json;
  itemsOverride?: BuiltItem[];
  summariesOverride?: SummaryLine[];
}

export function useCreateClosingReport() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CreatePayload) => {
      if (!currentTenant?.id) throw new Error('tenant');
      const { data: numData, error: numErr } = await supabase.rpc('next_closing_report_number', { _tenant_id: currentTenant.id, _date: p.periodEnd });
      if (numErr) throw numErr;
      const number = numData as string;
      const items = p.itemsOverride ?? p.preview.items;
      const totals = items.reduce((acc, i) => {
        acc.total_invoice_value += i.invoice_value; acc.total_freight_value += i.freight_value;
        acc.total_weight_kg += i.weight_kg; acc.total_volume += i.volume_count;
        return acc;
      }, { total_invoice_value: 0, total_freight_value: 0, total_weight_kg: 0, total_volume: 0 });
      const totalAmount = totals.total_freight_value;

      const plates = Array.from(new Set(items.map(i => (i.vehicle_plate || '').toUpperCase()).filter(Boolean)));
      const driverNames = Array.from(new Set(items.map(i => (i.driver_name || '').toUpperCase()).filter(Boolean)));
      const totalKm = items.reduce((s, i) => s + Number(i.km_driven || 0), 0);
      const totalLiters = items.reduce((s, i) => s + Number(i.fuel_liters || 0), 0);
      const totalFuelCost = items.reduce((s, i) => s + Number(i.fuel_total || 0), 0);
      const avgConsumption = totalLiters > 0 ? totalKm / totalLiters : 0;

      const headerPayload: TablesInsert<'closing_reports'> = {
        tenant_id: currentTenant.id,
        client_id: p.clientId ?? null,
        payer_client_id: p.payerClientId ?? null,
        closing_number: number,
        title: p.title,
        report_type: p.reportType,
        report_model: p.reportModel,
        period_start: p.periodStart,
        period_end: p.periodEnd,
        issue_date_start: p.issueDateStart ?? null,
        issue_date_end: p.issueDateEnd ?? null,
        expected_payment_date: p.expectedPaymentDate ?? null,
        notes: p.notes ?? null,
        total_invoice_value: totals.total_invoice_value,
        total_freight_value: totals.total_freight_value,
        total_weight_kg: totals.total_weight_kg,
        total_volume: totals.total_volume,
        fiscal_document_count: p.preview.totals.fiscal_document_count,
        cte_count: p.preview.totals.cte_count,
        load_count: p.preview.totals.load_count,
        gross_amount: totals.total_freight_value,
        total_amount: totalAmount,
        open_amount: totalAmount,
        filters_snapshot: p.filtersSnapshot ?? {},
        totals_snapshot: p.preview.totals as unknown as Json,
        status: 'draft',
        payment_status: computeClosingPaymentStatus({ totalAmount, receivedAmount: 0, expectedPaymentDate: p.expectedPaymentDate }),
        vehicle_plates_snapshot: plates,
        driver_names_snapshot: driverNames,
        total_km_driven: totalKm,
        total_liters: totalLiters,
        total_fuel_cost: totalFuelCost,
        avg_consumption_km_l: avgConsumption,
      };
      const { data: header, error: hErr } = await supabase.from('closing_reports').insert(headerPayload).select('*').single();
      if (hErr) throw hErr;

      if (items.length) {
        const rows: TablesInsert<'closing_report_items'>[] = items.map(item => ({
          ...item,
          tenant_id: currentTenant.id,
          closing_report_id: header.id,
        }));
        const { error: iErr } = await supabase.from('closing_report_items').insert(rows);
        if (iErr) throw iErr;
      }

      const summaries = p.summariesOverride ?? [...p.preview.summaryByArrival, ...p.preview.summaryByDestination];
      if (summaries.length) {
        const rows: TablesInsert<'closing_report_summary_lines'>[] = summaries.map((summary, index) => ({
          ...summary,
          tenant_id: currentTenant.id,
          closing_report_id: header.id,
          sort_order: index,
        }));
        const { error: summaryError } = await supabase.from('closing_report_summary_lines').insert(rows);
        if (summaryError) throw summaryError;
      }

      const { error: historyError } = await supabase.from('closing_report_history').insert({ tenant_id: currentTenant.id, closing_report_id: header.id, action: 'created' });
      if (historyError) throw historyError;
      return header as ClosingReportRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}

// ------- ACTIONS -------
export function useCloseClosingReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('close_closing_report', { _closing_report_id: id }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useCancelClosingReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => { const { error } = await supabase.rpc('cancel_closing_report', { _closing_report_id: id, _reason: reason }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useReopenClosingReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => { const { error } = await supabase.rpc('reopen_closing_report', { _closing_report_id: id, _reason: reason }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useRegisterClosingPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payment }: { id: string; payment: { amount: number; bank_account_id: string; payment_date?: string; payment_method?: string; notes?: string } }) => {
      const { error } = await supabase.rpc('register_closing_report_payment', { _closing_report_id: id, _payment: payment as unknown as Json });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useMarkClosingSent() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, sent_to, channel }: { id: string; sent_to?: string; channel?: string }) => {
      const tenantId = currentTenant?.id;
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('closing_reports').update({ status: 'sent', sent_at: new Date().toISOString(), sent_to, sent_channel: channel }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}

export function useGenerateInvoiceFromClosing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (closingReportId: string) => {
      const { data: invoiceId, error } = await supabase.rpc('generate_client_invoice_from_closing', {
        _closing_report_id: closingReportId,
      });
      if (error) throw error;
      return invoiceId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}

// ------- UPDATE TRIP FIELDS ON ITEM (KMs, litros, preço) -------
export interface ItemTripUpdate {
  km_initial?: number | null;
  km_final?: number | null;
  fuel_liters?: number | null;
  fuel_unit_price?: number | null;
  vehicle_plate?: string | null;
  driver_name?: string | null;
  departure_at?: string | null;
  arrival_at_ts?: string | null;
  route_label?: string | null;
  route_complement?: string | null;
}

function computeTripDerived(u: ItemTripUpdate) {
  const kmi = u.km_initial != null ? Number(u.km_initial) : null;
  const kmf = u.km_final != null ? Number(u.km_final) : null;
  const km_driven = kmi != null && kmf != null && kmf >= kmi ? kmf - kmi : null;
  const liters = u.fuel_liters != null ? Number(u.fuel_liters) : null;
  const price = u.fuel_unit_price != null ? Number(u.fuel_unit_price) : null;
  const fuel_total = liters != null && price != null ? liters * price : null;
  const consumption_km_l = km_driven != null && liters != null && liters > 0 ? km_driven / liters : null;
  let days_count: number | null = null;
  if (u.departure_at && u.arrival_at_ts) {
    const dep = new Date(u.departure_at).getTime();
    const arr = new Date(u.arrival_at_ts).getTime();
    if (Number.isFinite(dep) && Number.isFinite(arr) && arr >= dep) {
      days_count = Math.max(0, Math.ceil((arr - dep) / 86400000));
    }
  }
  return { km_driven, fuel_total, consumption_km_l, days_count };
}

export function useUpdateClosingReportItem() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, closingReportId, patch }: { itemId: string; closingReportId: string; patch: ItemTripUpdate }) => {
      const tenantId = currentTenant?.id;
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const derived = computeTripDerived(patch);
      const { error } = await supabase.from('closing_report_items').update({ ...patch, ...derived }).eq('id', itemId).eq('tenant_id', tenantId).eq('closing_report_id', closingReportId);
      if (error) throw error;

      // Recalc header aggregates from items
      const { data: items, error: e2 } = await supabase.from('closing_report_items')
        .select('vehicle_plate, driver_name, km_driven, fuel_liters, fuel_total')
        .eq('closing_report_id', closingReportId)
        .eq('tenant_id', tenantId);
      if (e2) throw e2;
      const plates = Array.from(new Set((items ?? []).map(item => (item.vehicle_plate || '').toUpperCase()).filter(Boolean)));
      const driverNames = Array.from(new Set((items ?? []).map(item => (item.driver_name || '').toUpperCase()).filter(Boolean)));
      const totalKm = (items ?? []).reduce((sum, item) => sum + Number(item.km_driven || 0), 0);
      const totalLiters = (items ?? []).reduce((sum, item) => sum + Number(item.fuel_liters || 0), 0);
      const totalFuelCost = (items ?? []).reduce((sum, item) => sum + Number(item.fuel_total || 0), 0);
      const avg = totalLiters > 0 ? totalKm / totalLiters : 0;
      const { error: reportError } = await supabase.from('closing_reports').update({
        vehicle_plates_snapshot: plates,
        driver_names_snapshot: driverNames,
        total_km_driven: totalKm,
        total_liters: totalLiters,
        total_fuel_cost: totalFuelCost,
        avg_consumption_km_l: avg,
        updated_at: new Date().toISOString(),
      }).eq('id', closingReportId).eq('tenant_id', tenantId);
      if (reportError) throw reportError;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['closing-reports'] });
      qc.invalidateQueries({ queryKey: ['closing-report', v.closingReportId] });
    },
  });
}
