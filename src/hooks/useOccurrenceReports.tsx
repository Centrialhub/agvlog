import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { ReportType, ResolutionType } from '@/lib/occurrenceReports/occurrenceReportBuilder';
import { validateFinalize } from '@/lib/occurrenceReports/occurrenceReportBuilder';

export interface OccurrenceRow {
  id: string;
  tenant_id: string;
  invoice_number: string | null;
  cte_number: string | null;
  occurrence_number: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  city: string | null;
  state: string | null;
  occurrence_type: string;
  occurrence_reason: string | null;
  occurrence_description: string | null;
  occurrence_date: string | null;
  status: string;
  resolution_type: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  password_or_authorization: string | null;
  client_id: string | null;
  supplier_id: string | null;
  load_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface OccurrenceFilters {
  periodStart?: string | null;
  periodEnd?: string | null;
  customer?: string | null;
  supplier?: string | null;
  city?: string | null;
  invoiceNumber?: string | null;
  cteNumber?: string | null;
  occurrenceNumber?: string | null;
  occurrenceType?: string | null;
  resolutionType?: string | null;
  status?: string | null;
  rural?: 'all' | 'only' | 'exclude';
  onlyFinalized?: boolean;
  onlyPending?: boolean;
}

export function useOccurrences(filters: OccurrenceFilters = {}) {
  const { activeTenantId } = useTenant();
  return useQuery({
    queryKey: ['delivery-occurrences', activeTenantId, filters],
    enabled: !!activeTenantId,
    queryFn: async () => {
      let q = supabase
        .from('delivery_occurrences')
        .select('*')
        .eq('tenant_id', activeTenantId!)
        .order('occurrence_date', { ascending: false, nullsFirst: false })
        .limit(500);
      if (filters.periodStart) q = q.gte('occurrence_date', filters.periodStart);
      if (filters.periodEnd) q = q.lte('occurrence_date', filters.periodEnd);
      if (filters.customer) q = q.ilike('customer_name', `%${filters.customer}%`);
      if (filters.supplier) q = q.ilike('supplier_name', `%${filters.supplier}%`);
      if (filters.city) q = q.ilike('city', `%${filters.city}%`);
      if (filters.invoiceNumber) q = q.ilike('invoice_number', `%${filters.invoiceNumber}%`);
      if (filters.cteNumber) q = q.ilike('cte_number', `%${filters.cteNumber}%`);
      if (filters.occurrenceNumber) q = q.ilike('occurrence_number', `%${filters.occurrenceNumber}%`);
      if (filters.occurrenceType) q = q.eq('occurrence_type', filters.occurrenceType);
      if (filters.resolutionType) q = q.eq('resolution_type', filters.resolutionType);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.onlyFinalized) q = q.in('status', ['resolved', 'closed']);
      if (filters.onlyPending) q = q.in('status', ['open', 'in_review', 'waiting_client', 'waiting_supplier', 'waiting_driver']);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OccurrenceRow[];
    },
  });
}

export interface ExportRow {
  id: string;
  tenant_id: string;
  report_type: ReportType;
  title: string;
  period_start: string | null;
  period_end: string | null;
  client_id: string | null;
  supplier_id: string | null;
  row_count: number;
  occurrence_count: number;
  invoice_count: number;
  total_invoice_value: number;
  status: string;
  sent_channel: string | null;
  sent_to: string | null;
  sent_at: string | null;
  created_at: string;
  filters_snapshot: Record<string, unknown> | null;
}

export function useReportExports() {
  const { activeTenantId } = useTenant();
  return useQuery({
    queryKey: ['occurrence-report-exports', activeTenantId],
    enabled: !!activeTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('occurrence_report_exports')
        .select('*')
        .eq('tenant_id', activeTenantId!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ExportRow[];
    },
  });
}

export function useImportBatches() {
  const { activeTenantId } = useTenant();
  return useQuery({
    queryKey: ['occurrence-import-batches', activeTenantId],
    enabled: !!activeTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('occurrence_report_import_batches')
        .select('*')
        .eq('tenant_id', activeTenantId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateOccurrence() {
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<OccurrenceRow>) => {
      if (!activeTenantId) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase
        .from('delivery_occurrences')
        .insert({
          tenant_id: activeTenantId,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
          occurrence_type: payload.occurrence_type ?? 'other',
          ...payload,
        } as never)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-occurrences', activeTenantId] }),
  });
}

export function useFinalizeOccurrence() {
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      resolution_type: ResolutionType | string;
      resolution_notes?: string | null;
      password_or_authorization?: string | null;
      items?: Array<{ product_description?: string; quantity_text?: string }>;
    }) => {
      const errors = validateFinalize(params);
      if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
      const { error } = await supabase
        .from('delivery_occurrences')
        .update({
          status: 'resolved',
          resolution_type: params.resolution_type,
          resolution_notes: params.resolution_notes ?? null,
          password_or_authorization: params.password_or_authorization ?? null,
          resolved_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        } as never)
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-occurrences', activeTenantId] }),
  });
}

export interface CreateExportPayload {
  report_type: ReportType;
  title: string;
  client_id?: string | null;
  supplier_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  filters_snapshot?: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

export function useCreateExport() {
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateExportPayload) => {
      if (!activeTenantId) throw new Error('Tenant não selecionado');
      if (!payload.items.length) throw new Error('Relatório não pode ser gerado sem linhas');
      const totalInvoiceValue = payload.items.reduce(
        (s, i) => s + Number((i as { invoice_value?: number }).invoice_value ?? 0),
        0,
      );
      const invoiceSet = new Set(
        payload.items.map((i) => (i as { invoice_number?: string }).invoice_number).filter(Boolean),
      );
      const occSet = new Set(
        payload.items.map((i) => (i as { occurrence_id?: string }).occurrence_id).filter(Boolean),
      );
      const { data: exportRow, error } = await supabase
        .from('occurrence_report_exports')
        .insert({
          tenant_id: activeTenantId,
          report_type: payload.report_type,
          title: payload.title,
          client_id: payload.client_id ?? null,
          supplier_id: payload.supplier_id ?? null,
          period_start: payload.period_start ?? null,
          period_end: payload.period_end ?? null,
          filters_snapshot: payload.filters_snapshot ?? {},
          row_count: payload.items.length,
          invoice_count: invoiceSet.size,
          occurrence_count: occSet.size,
          total_invoice_value: totalInvoiceValue,
          generated_by: user?.id ?? null,
          generated_snapshot: { generated_at: new Date().toISOString(), rows: payload.items.length },
        } as never)
        .select('*')
        .single();
      if (error) throw error;
      const items = payload.items.map((raw, idx) => ({
        tenant_id: activeTenantId,
        export_id: (exportRow as { id: string }).id,
        sort_order: idx,
        ...raw,
      }));
      const { error: itemsError } = await supabase
        .from('occurrence_report_export_items')
        .insert(items as never);
      if (itemsError) throw itemsError;
      return exportRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['occurrence-report-exports', activeTenantId] }),
  });
}

export function useMarkExportSent() {
  const { activeTenantId } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; sent_channel: string; sent_to: string; sent_notes?: string }) => {
      if (!params.sent_channel || !params.sent_to) {
        throw new Error('Canal e destinatário são obrigatórios para marcar envio');
      }
      const { error } = await supabase
        .from('occurrence_report_exports')
        .update({
          status: 'sent',
          sent_channel: params.sent_channel,
          sent_to: params.sent_to,
          sent_notes: params.sent_notes ?? null,
          sent_at: new Date().toISOString(),
        } as never)
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['occurrence-report-exports', activeTenantId] }),
  });
}

export function useImportLegacyBatch() {
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      file_name: string;
      detected_model: string;
      row_count: number;
      imported_count: number;
      unmatched_count: number;
      error_count: number;
      errors: unknown[];
      metadata?: Record<string, unknown>;
      occurrences?: Array<Partial<OccurrenceRow>>;
    }) => {
      if (!activeTenantId) throw new Error('Tenant não selecionado');
      const { data: batch, error } = await supabase
        .from('occurrence_report_import_batches')
        .insert({
          tenant_id: activeTenantId,
          file_name: params.file_name,
          detected_model: params.detected_model,
          row_count: params.row_count,
          imported_count: params.imported_count,
          unmatched_count: params.unmatched_count,
          error_count: params.error_count,
          errors: params.errors,
          metadata: params.metadata ?? {},
          status: params.error_count ? 'completed_with_errors' : 'completed',
          created_by: user?.id ?? null,
        } as never)
        .select('*')
        .single();
      if (error) throw error;
      if (params.occurrences?.length) {
        const insertPayload = params.occurrences.map((o) => ({
          tenant_id: activeTenantId,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
          occurrence_type: o.occurrence_type ?? 'legacy',
          status: o.status ?? 'resolved',
          resolved_at: o.resolved_at ?? new Date().toISOString(),
          metadata: { ...(o.metadata ?? {}), import_batch_id: (batch as { id: string }).id },
          ...o,
        }));
        await supabase.from('delivery_occurrences').insert(insertPayload as never);
      }
      return batch;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrence-import-batches', activeTenantId] });
      qc.invalidateQueries({ queryKey: ['delivery-occurrences', activeTenantId] });
    },
  });
}
