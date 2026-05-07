import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export const SEFAZ_STATUSES = [
  'pending',      // Enviar
  'sending',      // Enviando
  'sent',         // Enviado
  'sent_error',   // Enviado (Erro)
  'processing',   // Processando
  'processed',    // Processado
  'processed_error', // Processado (Erro)
  'cancel_pending',  // À Cancelar
  'cancelling',      // Cancelando
  'cancelled',       // Cancelado
  'cancel_error',    // Cancelado (Erro)
  'closed',          // Encerrado
  'invalidated',     // Inutilizado
] as const;
export type SefazStatus = typeof SEFAZ_STATUSES[number];

export const SEFAZ_STATUS_LABELS: Record<SefazStatus, string> = {
  pending: 'Enviar',
  sending: 'Enviando',
  sent: 'Enviado',
  sent_error: 'Enviado (Erro)',
  processing: 'Processando',
  processed: 'Processado',
  processed_error: 'Processado (Erro)',
  cancel_pending: 'À Cancelar',
  cancelling: 'Cancelando',
  cancelled: 'Cancelado',
  cancel_error: 'Cancelado (Erro)',
  closed: 'Encerrado',
  invalidated: 'Inutilizado',
};

export const SEFAZ_STATUS_TONE: Record<SefazStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  pending: 'muted',
  sending: 'default',
  sent: 'success',
  sent_error: 'danger',
  processing: 'default',
  processed: 'success',
  processed_error: 'danger',
  cancel_pending: 'warning',
  cancelling: 'warning',
  cancelled: 'muted',
  cancel_error: 'danger',
  closed: 'muted',
  invalidated: 'muted',
};

export interface CteMonitorRow {
  id: string;
  tenant_id: string;
  cte_number: string | null;
  cte_series: string | null;
  access_key: string | null;
  protocol_number: string | null;
  sefaz_status: SefazStatus;
  sefaz_status_reason: string | null;
  sefaz_status_code: string | null;
  sefaz_status_at: string | null;
  sefaz_environment: string | null;
  sent_at: string | null;
  processed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  correction_letter: boolean;
  pdf_url: string | null;
  xml_url: string | null;
  reference_number: string | null;
  internal_number: string | null;
  payer_name: string | null;
  payer_cnpj: string | null;
  company_branch: string | null;
  company_group: string | null;
  payer_group: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  remitter: string | null;
  freight_value: number;
  cargo_value: number;
  issued_at: string | null;
  created_at: string;
  batch_id: string;
}

export interface CteMonitorFilters {
  docNumber?: string;
  payer?: string;
  batchNumber?: string;
  internalNumber?: string;
  referenceNumber?: string;
  protocolNumber?: string;
  accessKey?: string;
  user?: string;
  plate?: string;
  driver?: string;
  series?: string;
  branch?: string;
  companyGroup?: string;
  payerGroup?: string;
  statuses?: SefazStatus[];
  correctionLetter?: 'yes' | 'no' | 'all';
  processedStart?: string;
  processedEnd?: string;
  issuedStart?: string;
  issuedEnd?: string;
}

function nz(v?: string | null) {
  if (!v) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export function useCteMonitor(filters: CteMonitorFilters) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['cte_monitor', currentTenant?.id, filters],
    enabled: !!currentTenant,
    placeholderData: (prev) => prev,
    staleTime: 15_000,
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('cte_documents')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('sefaz_status_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(2000);

      const docNumber = nz(filters.docNumber);
      if (docNumber) q = q.ilike('cte_number', `%${docNumber}%`);
      const payer = nz(filters.payer);
      if (payer) q = q.ilike('payer_name', `%${payer}%`);
      const internal = nz(filters.internalNumber);
      if (internal) q = q.ilike('internal_number', `%${internal}%`);
      const ref = nz(filters.referenceNumber);
      if (ref) q = q.ilike('reference_number', `%${ref}%`);
      const protocol = nz(filters.protocolNumber);
      if (protocol) q = q.ilike('protocol_number', `%${protocol}%`);
      const key = nz(filters.accessKey);
      if (key) q = q.ilike('access_key', `%${key}%`);
      const plate = nz(filters.plate);
      if (plate) q = q.ilike('vehicle_plate', `%${plate.replace(/\W/g, '')}%`);
      const driver = nz(filters.driver);
      if (driver) q = q.ilike('driver_name', `%${driver}%`);
      const series = nz(filters.series);
      if (series) q = q.eq('cte_series', series);
      const branch = nz(filters.branch);
      if (branch) q = q.ilike('company_branch', `%${branch}%`);
      const cg = nz(filters.companyGroup);
      if (cg) q = q.ilike('company_group', `%${cg}%`);
      const pg = nz(filters.payerGroup);
      if (pg) q = q.ilike('payer_group', `%${pg}%`);

      if (filters.statuses && filters.statuses.length > 0) {
        q = q.in('sefaz_status', filters.statuses);
      }
      if (filters.correctionLetter === 'yes') q = q.eq('correction_letter', true);
      if (filters.correctionLetter === 'no') q = q.eq('correction_letter', false);

      if (filters.processedStart) q = q.gte('processed_at', filters.processedStart);
      if (filters.processedEnd) q = q.lte('processed_at', filters.processedEnd + 'T23:59:59');
      if (filters.issuedStart) q = q.gte('issued_at', filters.issuedStart);
      if (filters.issuedEnd) q = q.lte('issued_at', filters.issuedEnd + 'T23:59:59');

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as CteMonitorRow[];
    },
  });
}

export interface CteSefazEvent {
  id: string;
  cte_document_id: string;
  event_type: string;
  status: string | null;
  status_code: string | null;
  reason: string | null;
  protocol_number: string | null;
  payload: any;
  source: string | null;
  occurred_at: string;
  created_at: string;
}

export function useCteSefazEvents(cteDocumentId: string | null) {
  return useQuery({
    queryKey: ['cte_sefaz_events', cteDocumentId],
    enabled: !!cteDocumentId,
    queryFn: async () => {
      if (!cteDocumentId) return [];
      const { data, error } = await supabase
        .from('cte_sefaz_events')
        .select('*')
        .eq('cte_document_id', cteDocumentId)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as CteSefazEvent[];
    },
  });
}

/** Marca CT-e para reenvio (status volta a 'pending') — integração fiscal real consome essa fila. */
export function useResendCte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('cte_documents')
        .update({
          sefaz_status: 'pending',
          sefaz_status_reason: null,
          sefaz_status_at: new Date().toISOString(),
        } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
    },
  });
}