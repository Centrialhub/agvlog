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
  'sefaz_error',     // Erro SEFAZ genérico
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
  sefaz_error: 'Erro SEFAZ',
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
  sefaz_error: 'danger',
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
  /** Origem da linha: rascunho local (`cte_documents`) ou emissão real no Hub (`fiscal_documents`). */
  source?: 'draft' | 'hub';
  hub_document_id?: string | null;
  emission_id?: string | null;
  invoice_numbers?: string | null;
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
        .eq('tenant_id', currentTenant.id);


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

      // CT-es realmente transmitidos ao Hub Fiscal ficam em `fiscal_documents`
      // (document_type = 'outbound'). Sem esse merge o monitor não mostrava as
      // emissões reais — e por isso não havia como baixar PDF/XML de retorno.
      const { data: outboundData, error: outErr } = await supabase
        .from('fiscal_documents')
        .select(
          'id, invoice_number, access_key, sefaz_protocol, sefaz_status, sefaz_status_code, sefaz_message, status, remitter, recipient, recipient_city, recipient_state, freight_value, value, issue_date, created_at, hub_document_id, emission_id, cte_payload',
        )
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null)
        .eq('is_duplicate', false)
        .eq('document_type', 'outbound');
      
      if (outErr) throw outErr;
      const outbound = (outboundData || []) as any[];


      const usedHubIds = new Set<string>();
      const draftRows = (data || []).map((r: any) => {
        // Tenta encontrar o vínculo real em fiscal_documents via access_key
        const match = r.access_key ? outbound.find((o: any) => o.access_key === r.access_key) : null;
        if (match) usedHubIds.add(match.id);
        
        return {
          ...r,
          id: match?.id ?? r.id,
          issued_at: r.issued_at || r.created_at,
          source: (match ? 'hub' : 'draft') as any,
          hub_document_id: match?.hub_document_id ?? r.hub_document_id,
          emission_id: match?.emission_id ?? r.emission_id,
          invoice_numbers: match?.invoice_numbers ?? r.invoice_numbers,
          sefaz_status: match ? mapOutboundStatus(match.status, match.sefaz_status, match.hub_document_id) : r.sefaz_status,
          sefaz_status_reason: match?.sefaz_message ?? r.sefaz_status_reason,
        } as CteMonitorRow;
      });



      const hubRows: CteMonitorRow[] = (outbound || [])
        .filter((d: any) => !usedHubIds.has(d.id))
        .map((d: any) => ({
          id: d.id,
          tenant_id: currentTenant.id,
          cte_number: d.invoice_number ?? null,
          cte_series: null,
          access_key: d.access_key ?? null,
          protocol_number: d.sefaz_protocol ?? null,
          sefaz_status: mapOutboundStatus(d.status, d.sefaz_status, d.hub_document_id as string),
          sefaz_status_reason: d.sefaz_message ?? null,
          sefaz_status_code: d.sefaz_status_code ?? null,
          sefaz_status_at: d.created_at ?? null,
          sefaz_environment: null,
          sent_at: d.created_at ?? null,
          processed_at: d.status === 'authorized' ? d.created_at ?? null : null,
          cancelled_at: d.status === 'cancelled' ? d.created_at ?? null : null,
          cancellation_reason: null,
          correction_letter: false,
          pdf_url: null,
          xml_url: null,
          reference_number: null,
          internal_number: d.invoice_number ?? null,
          payer_name: d.remitter ?? null,
          payer_cnpj: null,
          company_branch: null,
          company_group: null,
          payer_group: null,
          driver_name: null,
          vehicle_plate: null,
          recipient: (d.cte_payload?.payload?.destinatario?.nome || d.recipient) ?? null,
          recipient_city: (d.cte_payload?.payload?.fim?.municipio || d.cte_payload?.payload?.destinatario?.endereco?.municipio || d.recipient_city) ?? null,
          recipient_state: (d.cte_payload?.payload?.fim?.uf || d.cte_payload?.payload?.destinatario?.endereco?.uf || d.recipient_state) ?? null,
          remitter: d.remitter ?? null,
          freight_value: Number(d.freight_value ?? d.value ?? 0),
          cargo_value: Number(d.value ?? 0),
          issued_at: d.issue_date || d.created_at || null,
          created_at: d.created_at,
          batch_id: '',
          source: 'hub',
          hub_document_id: d.hub_document_id ?? null,
          emission_id: d.emission_id ?? null,
          invoice_numbers: d.invoice_numbers ?? null,
        }));



      const filteredHub = hubRows.filter((r) => {
        if (filters.statuses?.length && !filters.statuses.includes(r.sefaz_status)) return false;
        if (docNumber) {
          const hit = (r.cte_number || '').toLowerCase().includes(docNumber.toLowerCase()) || 
                      (r.invoice_numbers || '').toLowerCase().includes(docNumber.toLowerCase());
          if (!hit) return false;
        }



        if (key && !(r.access_key || '').includes(key)) return false;
        if (payer && !(r.payer_name || '').toLowerCase().includes(payer.toLowerCase())) return false;
        if (filters.plate && !(r.vehicle_plate || '').toLowerCase().includes(filters.plate.replace(/\W/g, '').toLowerCase())) return false;
        if (filters.series && r.cte_series !== filters.series) return false;
        if (filters.correctionLetter === 'yes') return false;
        return true;
      });

      return [...filteredHub, ...draftRows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
  });
}

/** Traduz status de `fiscal_documents` para o vocabulário do monitor SEFAZ. */
function mapOutboundStatus(status?: string | null, sefaz?: string | null, hubId?: string | null): SefazStatus {
  const s = (sefaz || '').toLowerCase();
  const st = (status || '').toLowerCase();
  if (st === 'cancelled' || s === 'cancelled') return 'cancelled';
  if (st === 'cancelling' || s === 'cancelling') return 'cancelling';
  // Cancelamento rejeitado mantém o documento fiscal autorizado e manejável.
  if (s === 'cancel_rejected' || s === 'cancel_error' || s.includes('cancel_rejeit')) return 'processed';
  if (st === 'authorized' || s === 'authorized') return 'processed';
  if (st === 'rejected' || s === 'error' || s === 'rejected') {
    // Se for rejeitado mas já tiver ID no hub, tratamos como 'processed' (autorizado) 
    // para que a UI ofereça opções de manejo (como baixar arquivos ou cancelar novamente)
    return hubId ? 'processed' : 'processed_error';
  }
  if (st === 'transmitting' || s === 'processing') return 'processing';
  return 'pending';
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