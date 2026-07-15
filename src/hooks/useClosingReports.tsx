import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import {
  buildPreview,
  computeClosingPaymentStatus,
  type BuilderInput,
  type BuiltItem,
  type BuiltPreview,
  type FreightAllocation,
  type ReportType,
  type ReportModel,
  type SummaryLine,
} from '@/lib/closingReports/closingReportBuilder';

const sb: any = supabase;

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
      let q = sb.from('closing_reports')
        .select('*, client:client_id(id,name)')
        .eq('tenant_id', currentTenant!.id)
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
    queryKey: ['closing-report', id],
    enabled: !!id && !!currentTenant?.id,
    queryFn: async () => {
      const [{ data: header, error: e1 }, { data: items, error: e2 }, { data: summary, error: e3 }, { data: payments, error: e4 }] = await Promise.all([
        sb.from('closing_reports').select('*, client:client_id(id,name), payer:payer_client_id(id,name)').eq('id', id).maybeSingle(),
        sb.from('closing_report_items').select('*').eq('closing_report_id', id).order('sort_order'),
        sb.from('closing_report_summary_lines').select('*').eq('closing_report_id', id).order('sort_order'),
        sb.from('closing_report_payments').select('*').eq('closing_report_id', id).order('payment_date', { ascending: false }),
      ]);
      if (e1 || e2 || e3 || e4) throw (e1 || e2 || e3 || e4);
      return { header: header as ClosingReportRow, items: (items ?? []) as any[], summary: (summary ?? []) as any[], payments: (payments ?? []) as any[] };
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
      let fq = sb.from('fiscal_documents')
        .select('id, invoice_number, access_key, issue_date, origin_city, origin_state, remitter, remitter_cnpj, recipient, recipient_cnpj, recipient_city, recipient_state, value, weight_kg, volume_count, freight_value, freight_cif_value, freight_fob_value, load_id, client_id, imported_note_status, delivery_meta')
        .eq('tenant_id', currentTenant.id)
        .gte('issue_date', inp.periodStart)
        .lte('issue_date', inp.periodEnd);
      if (inp.clientId) fq = fq.eq('client_id', inp.clientId);
      const { data: fiscalDocs, error: fe } = await fq;
      if (fe) throw fe;

      const loadIds = Array.from(new Set((fiscalDocs ?? []).map((d: any) => d.load_id).filter(Boolean)));
      const [{ data: ctes, error: ce }, { data: loads, error: le }] = await Promise.all([
        loadIds.length ? sb.from('cte_documents')
          .select('id, cte_number, access_key, freight_value, weight_kg, fiscal_document_ids, issued_at')
          .eq('tenant_id', currentTenant.id)
          .overlaps('load_ids', loadIds) : Promise.resolve({ data: [], error: null }),
        loadIds.length ? sb.from('loads').select('id, load_number, external_load_number, arrival_date, load_date, gate_departure_at, arrival_at, vehicle_id, driver_id, vehicle:vehicle_id(plate), driver:driver_id(name)').in('id', loadIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (ce || le) throw (ce || le);

      let filtered = (fiscalDocs ?? []) as any[];
      if (inp.onlyWithCte) {
        const linkedIds = new Set<string>();
        for (const c of (ctes ?? []) as any[]) (c.fiscal_document_ids ?? []).forEach((x: string) => linkedIds.add(x));
        filtered = filtered.filter(d => linkedIds.has(d.id));
      }
      if (inp.onlyDelivered) filtered = filtered.filter(d => d.delivery_meta?.delivered_at);

      let filteredLoads = (loads ?? []) as any[];
      if (inp.vehicleId) filteredLoads = filteredLoads.filter(l => l.vehicle_id === inp.vehicleId);
      if (inp.driverId) filteredLoads = filteredLoads.filter(l => l.driver_id === inp.driverId);
      if (inp.vehicleId || inp.driverId) {
        const okLoadIds = new Set(filteredLoads.map(l => l.id));
        filtered = filtered.filter(d => d.load_id && okLoadIds.has(d.load_id));
      }

      const input: BuilderInput = { fiscalDocs: filtered, ctes: (ctes ?? []) as any[], loads: filteredLoads, freightAllocation: inp.freightAllocation };
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
  filtersSnapshot?: any;
  itemsOverride?: BuiltItem[];
  summariesOverride?: SummaryLine[];
}

export function useCreateClosingReport() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CreatePayload) => {
      if (!currentTenant?.id) throw new Error('tenant');
      const { data: numData, error: numErr } = await sb.rpc('next_closing_report_number', { _tenant_id: currentTenant.id, _date: p.periodEnd });
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

      const { data: header, error: hErr } = await sb.from('closing_reports').insert({
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
        totals_snapshot: p.preview.totals,
        status: 'draft',
        payment_status: computeClosingPaymentStatus({ totalAmount, receivedAmount: 0, expectedPaymentDate: p.expectedPaymentDate }),
        vehicle_plates_snapshot: plates,
        driver_names_snapshot: driverNames,
        total_km_driven: totalKm,
        total_liters: totalLiters,
        total_fuel_cost: totalFuelCost,
        avg_consumption_km_l: avgConsumption,
      }).select('*').single();
      if (hErr) throw hErr;

      if (items.length) {
        const rows = items.map(it => ({ ...it, tenant_id: currentTenant.id, closing_report_id: header.id }));
        const { error: iErr } = await sb.from('closing_report_items').insert(rows);
        if (iErr) throw iErr;
      }

      const summaries = p.summariesOverride ?? [...p.preview.summaryByArrival, ...p.preview.summaryByDestination];
      if (summaries.length) {
        const rows = summaries.map((s, idx) => ({ ...s, tenant_id: currentTenant.id, closing_report_id: header.id, sort_order: idx }));
        await sb.from('closing_report_summary_lines').insert(rows);
      }

      await sb.from('closing_report_history').insert({ tenant_id: currentTenant.id, closing_report_id: header.id, action: 'created' });
      return header as ClosingReportRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}

// ------- ACTIONS -------
export function useCloseClosingReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.rpc('close_closing_report', { _closing_report_id: id }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useCancelClosingReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => { const { error } = await sb.rpc('cancel_closing_report', { _closing_report_id: id, _reason: reason }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useReopenClosingReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => { const { error } = await sb.rpc('reopen_closing_report', { _closing_report_id: id, _reason: reason }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useRegisterClosingPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payment }: { id: string; payment: { amount: number; payment_date?: string; payment_method?: string; notes?: string } }) => {
      const { error } = await sb.rpc('register_closing_report_payment', { _closing_report_id: id, _payment: payment });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
export function useMarkClosingSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, sent_to, channel }: { id: string; sent_to?: string; channel?: string }) => {
      const { error } = await sb.from('closing_reports').update({ status: 'sent', sent_at: new Date().toISOString(), sent_to, sent_channel: channel }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}

export function useGenerateInvoiceFromClosing() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (closingReportId: string) => {
      const { data: r, error } = await sb.from('closing_reports').select('*').eq('id', closingReportId).single();
      if (error) throw error;
      if (!r.client_id) throw new Error('Fechamento sem cliente vinculado');
      if (r.client_invoice_id) throw new Error('Fechamento já possui fatura vinculada');
      if (r.status === 'cancelled') throw new Error('Fechamento cancelado não gera fatura');

      const invNumber = `FCH-${r.closing_number}`;
      const { data: inv, error: iErr } = await sb.from('client_invoices').insert({
        tenant_id: currentTenant!.id,
        client_id: r.client_id,
        invoice_number: invNumber,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: r.expected_payment_date,
        gross_amount: r.total_freight_value,
        total_amount: r.total_amount,
        status: 'draft',
        notes: `Gerada a partir do fechamento ${r.closing_number}`,
      }).select('*').single();
      if (iErr) throw iErr;

      await sb.from('closing_reports').update({ client_invoice_id: inv.id, invoice_status: 'invoiced', status: 'invoiced', updated_at: new Date().toISOString() }).eq('id', r.id);
      await sb.from('closing_report_history').insert({ tenant_id: currentTenant!.id, closing_report_id: r.id, action: 'invoice_generated', new_value: invNumber });
      return inv;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['closing-reports'] }),
  });
}
