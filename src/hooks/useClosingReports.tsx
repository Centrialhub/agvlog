import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {useRef} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {closingSourceFilterSchema,parseClosingSources} from '@/lib/closingReports/closingSources';
import {buildClosingAttemptPreview,type ClosingAttemptPreview} from '@/lib/closingReports/closingAttemptPreview';
import {closingDraftError} from '@/lib/closingReports/closingDraft';
import {closingTripFieldsSchema} from '@/lib/closingReports/closingTrip';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { Tables } from '@/integrations/supabase/types';
import type {FreightAllocation,ReportType,ReportModel} from '@/lib/closingReports/closingReportBuilder';

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
  const {user}=useAuth();
  return useQuery({
    queryKey: ['closing-reports', currentTenant?.id, user?.id, filters],
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
  const {user}=useAuth();
  return useQuery({
    queryKey: ['closing-report', currentTenant?.id, user?.id, id],
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
  dateBasis?: 'invoice_issue' | 'delivery_result';
  freightAllocation?: FreightAllocation;
  vehicleId?: string | null;
  driverId?: string | null;
}

export function useBuildPreview() {
 const {currentTenant}=useTenant();const {user}=useAuth();const tenant=currentTenant?.id;const actor=user?.id;
 const latest=useRef({tenant,actor});latest.current={tenant,actor};
 return useMutation({mutationFn:async(inp:PreviewInputs):Promise<ClosingAttemptPreview>=>{
  if(!tenant||!actor)throw new Error('Selecione a empresa e entre com uma sessão válida.');
  const filters=closingSourceFilterSchema.parse({period_start:inp.periodStart,period_end:inp.periodEnd,date_basis:inp.dateBasis??'invoice_issue',
   client_id:inp.clientId??null,vehicle_id:inp.vehicleId??null,driver_id:inp.driverId??null,only_delivered:inp.onlyDelivered??false});
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  let response;try{response=await supabase.rpc('get_closing_report_sources',{_tenant_id:tenant,_filters:filters}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}
  const {data,error}=response;
  if(error)throw new Error(closingDraftError(error));
  if(latest.current.tenant!==tenant||latest.current.actor!==actor)throw new Error('A sessão ou empresa mudou. Gere uma nova prévia.');
  return buildClosingAttemptPreview(parseClosingSources(data,{tenantId:tenant,actorId:actor,filters}),{allocation:inp.freightAllocation,onlyWithCte:inp.onlyWithCte});
 }});
}

// ------- ACTIONS -------

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

export function useUpdateClosingReportItem() {
 const {currentTenant}=useTenant();const {user}=useAuth();const qc=useQueryClient();
 return useMutation({mutationFn:async({itemId,closingReportId,expected,patch}:{itemId:string;closingReportId:string;expected:ItemTripUpdate;patch:ItemTripUpdate})=>{
  const tenant=currentTenant?.id;if(!tenant||!user?.id)throw new Error('Sessão válida e empresa são obrigatórias.');
  const {data,error}=await supabase.rpc('update_closing_report_trip_fields',{_tenant_id:tenant,_report_id:closingReportId,_item_id:itemId,
   _expected:JSON.parse(JSON.stringify(expected)),_patch:JSON.parse(JSON.stringify(patch))});
  if(error)throw new Error(closingDraftError(error));
  if(!data||typeof data!=='object'||Array.isArray(data)||data.tenant_id!==tenant||data.actor_id!==user.id||data.report_id!==closingReportId||data.item_id!==itemId)
   throw new Error('Edição sem confirmação compatível. Atualize o relatório antes de reenviar.');
  return closingTripFieldsSchema.parse(data.fields);
 },onSuccess:()=>{qc.invalidateQueries({queryKey:['closing-reports']});qc.invalidateQueries({queryKey:['closing-report']});}});
}
