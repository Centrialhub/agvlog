import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { readCtePayloadPayer, readCtePayloadRecipient, readCtePayloadInvoiceNumbers } from '@/lib/fiscal/ctePayload';
import { matchesCteSearchFilters } from '@/lib/fiscal/cteListFilters';
import { APP_TIME_ZONE, dateOnlyUtcRange } from '@/lib/utils/formatDate';
import { containsIlikePattern, flexibleIdentifierIlikePattern } from '@/lib/supabase/ilike';
import { useTenant } from './useTenant';

export type TriState = 'all' | 'yes' | 'no';
export type CteType = 'normal' | 'complementary' | 'voiding' | 'substitute';

export const CTE_TYPE_LABELS: Record<CteType, string> = {
  normal: 'Normal',
  complementary: 'Complementar',
  voiding: 'Anulação',
  substitute: 'Substituto',
};

export interface CteSearchFilters {
  /** Busca livre: nº, chave, remetente, destinatário, pagador, placa, motorista, NF. */
  text?: string;
  docNumber?: string;
  internalNumber?: string;
  batchNumber?: string;
  referenceNumber?: string;
  accessKey?: string;
  series?: string;
  issueDateStart?: string;
  issueDateEnd?: string;
  remitter?: string;
  recipient?: string;
  recipientCity?: string;
  consignee?: string;
  payer?: string;
  payerGroup?: string;
  driverName?: string;
  vehiclePlate?: string;
  trailerPlate?: string;
  insuranceCompany?: string;
  contractNumber?: string;
  tripNumber?: string;
  invoiceNumber?: string;
  romexpNumber?: string;
  clientLoadNumber?: string;
  cteTypes?: CteType[];
  statuses?: string[];
  /** 'yes' = só documentos com arquivo disponível (transmitidos ao Hub). */
  downloadable?: TriState;
  voided?: TriState;
  closed?: TriState;
  compensated?: TriState;
  autonomousFreight?: TriState;
  complementaryDoc?: TriState;
}

export interface CteSearchRow {
  internal_number?: string | null;
  reference_number?: string | null;
  consignee?: string | null;
  payer_group?: string | null;
  trailer_plate?: string | null;
  insurance_company?: string | null;
  contract_number?: string | null;
  trip_number?: string | null;
  romexp_number?: string | null;
  is_voided?: boolean | null;
  is_closed?: boolean | null;
  is_compensated?: boolean | null;
  autonomous_freight?: boolean | null;
  complementary_doc?: boolean | null;
  id: string;
  source: 'draft' | 'hub';
  cte_number: string | null;
  cte_series: string | null;
  cte_type: string;
  access_key: string | null;
  sefaz_status: string;
  sefaz_status_reason: string | null;
  issued_at: string | null;
  created_at: string;
  payer_name: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  invoice_numbers: string | null;
  freight_value: number;
  cargo_value: number;
  hub_document_id: string | null;
  emission_id: string | null;
  pdf_url: string | null;
  xml_url: string | null;
}

async function readSearchPages<T>(read: (start: number, end: number) => PromiseLike<{data: T[] | null; error: unknown}>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const {data, error} = await read(start, start + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

function nz(v?: string) {
  if (!v) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function bool(v?: TriState) {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}
/** Traduz status de `fiscal_documents` (saída) para o vocabulário SEFAZ do monitor. */
export function mapSearchOutboundStatus(status?: string | null, sefaz?: string | null, _hubId?: string | null): string {
  const s = (sefaz || '').toLowerCase();
  const st = (status || '').toLowerCase();
  if (st === 'cancelled' || s === 'cancelled') return 'cancelled';
  if (st === 'cancel_pending' || s === 'cancel_pending') return 'cancel_pending';
  if (st === 'cancelling' || s === 'cancelling') return 'cancelling';
  if (s.includes('autoriz')) return 'processed';
  // Uma rejeição do evento de cancelamento não cancela o CT-e: ele continua
  // autorizado e deve permanecer disponível para uma nova tentativa.
  if (s === 'cancel_rejected' || s === 'cancel_error' || s.includes('cancel_rejeit')) return 'processed';
  if (s.includes('cancel')) return 'cancelled';
  if (s === 'status_timeout') return 'sefaz_error';
  if (s.includes('rejeit') || s.includes('erro')) return 'sefaz_error';
  if (st === 'authorized') return 'processed';
  if (st === 'rejected' || st === 'error') return 'sefaz_error';
  if (st === 'transmitting' || s === 'processing') return 'processing';
  return 'pending';
}

export function useCteSearch(filters: CteSearchFilters, opts?: { enabled?: boolean }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['cte_search', currentTenant?.id, filters],
    enabled: !!currentTenant && (opts?.enabled ?? true),
    staleTime: 30_000,
    queryFn: async (): Promise<CteSearchRow[]> => {
      if (!currentTenant) return [];
      const tenantTimezone = currentTenant.timezone || APP_TIME_ZONE;
      const dayBoundary = (day: string, nextDay = false) => {
        const range = dateOnlyUtcRange(day, tenantTimezone);
        return nextDay ? range.toExclusive : range.from;
      };
      let q = supabase
        .from('cte_documents')
        .select('*')
        .eq('tenant_id', currentTenant.id);


      const f = filters;

      // Number filters run after enriching catalog rows with their original NF payload.
      const internal = nz(f.internalNumber); if (internal) q = q.ilike('internal_number', containsIlikePattern(internal));
      const ref = nz(f.referenceNumber); if (ref) q = q.ilike('reference_number', containsIlikePattern(ref));
      const accessKey = nz(f.accessKey); if (accessKey) q = q.ilike('access_key', containsIlikePattern(accessKey.replace(/\D/g, '') || accessKey));
      const series = nz(f.series); if (series) q = q.eq('cte_series', series);
      const remitter = nz(f.remitter); if (remitter) q = q.ilike('remitter', containsIlikePattern(remitter));
      const recipient = nz(f.recipient); if (recipient) q = q.ilike('recipient', containsIlikePattern(recipient));
      const city = nz(f.recipientCity); if (city) q = q.ilike('recipient_city', containsIlikePattern(city));
      const consignee = nz(f.consignee); if (consignee) q = q.ilike('consignee', containsIlikePattern(consignee));
      const payer = nz(f.payer); if (payer) q = q.ilike('payer_name', containsIlikePattern(payer));
      const payerGroup = nz(f.payerGroup); if (payerGroup) q = q.ilike('payer_group', containsIlikePattern(payerGroup));
      const driver = nz(f.driverName); if (driver) q = q.ilike('driver_name', containsIlikePattern(driver));
      const plate = nz(f.vehiclePlate); if (plate) q = q.ilike('vehicle_plate', flexibleIdentifierIlikePattern(plate));
      const trailer = nz(f.trailerPlate); if (trailer) q = q.ilike('trailer_plate', flexibleIdentifierIlikePattern(trailer));
      const ins = nz(f.insuranceCompany); if (ins) q = q.ilike('insurance_company', containsIlikePattern(ins));
      const contract = nz(f.contractNumber); if (contract) q = q.ilike('contract_number', containsIlikePattern(contract));
      const trip = nz(f.tripNumber); if (trip) q = q.ilike('trip_number', containsIlikePattern(trip));

      const romexp = nz(f.romexpNumber); if (romexp) q = q.ilike('romexp_number', containsIlikePattern(romexp));

      if (f.issueDateStart) q = q.or(`issued_at.gte.${dayBoundary(f.issueDateStart)},and(issued_at.is.null,created_at.gte.${dayBoundary(f.issueDateStart)})`);
      if (f.issueDateEnd) q = q.or(`issued_at.lt.${dayBoundary(f.issueDateEnd, true)},and(issued_at.is.null,created_at.lt.${dayBoundary(f.issueDateEnd, true)})`);

      if (f.cteTypes && f.cteTypes.length > 0) q = q.in('cte_type', f.cteTypes);
      if (f.statuses && f.statuses.length > 0) q = q.or(`sefaz_status.in.(${f.statuses.join(',')}),access_key.not.is.null`);

      const v = bool(f.voided); if (v !== null) q = q.eq('is_voided', v);
      const c = bool(f.closed); if (c !== null) q = q.eq('is_closed', c);
      const cp = bool(f.compensated); if (cp !== null) q = q.eq('is_compensated', cp);
      const af = bool(f.autonomousFreight); if (af !== null) q = q.eq('autonomous_freight', af);
      const cd = bool(f.complementaryDoc); if (cd !== null) q = q.eq('complementary_doc', cd);

      const data = await readSearchPages((start, end) => q.order('id').range(start, end));

      // As CT-e realmente transmitidas ficam em `fiscal_documents` (saída) e são
      // as únicas com id no Hub Fiscal — sem esse merge a consulta não permitia baixar arquivos.
      const outbound = await readSearchPages((start, end) => supabase
        .from('fiscal_documents')
        .select(
          'id, invoice_number, access_key, sefaz_status, sefaz_message, status, remitter, recipient, recipient_city, recipient_state, freight_value, value, issue_date, created_at, hub_document_id, emission_id, cte_payload',
        )
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null)
        .eq('is_duplicate', false)
        .eq('document_type', 'outbound').order('id').range(start, end));
      const receipts = await readSearchPages((start, end) => supabase.from('hub_fiscal_emissions')
        .select('id,fiscal_document_id,number,series,created_at').eq('tenant_id', currentTenant.id)
        .eq('doc_type', 'cte').order('created_at', {ascending: false}).order('id').range(start, end));
      const receiptById = new Map<string, (typeof receipts)[number]>();
      for (const receipt of receipts) {
        if (receipt.fiscal_document_id && !receiptById.has(receipt.fiscal_document_id)) receiptById.set(receipt.fiscal_document_id, receipt);
      }
      const outboundById = new Map(outbound.map(row => [row.id, row]));

      const hubByKey = new Map<string, (typeof outbound)[number]>();
      for (const d of outbound) {
        const key = d.access_key;
        if (key && !hubByKey.has(key)) hubByKey.set(key, d);
      }

      const usedHubIds = new Set<string>();
      const draftRows: CteSearchRow[] = (data || []).map((r) => {
        const match = outboundById.get(r.id) ?? (r.access_key ? hubByKey.get(r.access_key) : null);
        if (match) usedHubIds.add(match.id);
        const payloadRecipient = readCtePayloadRecipient(match?.cte_payload);
        
        // Prioriza dados do rascunho (cte_documents) que tem mais colunas, 
        // mas usa o status e ids reais do Hub quando houver vínculo.
        return {
          ...r,
          id: match?.id ?? r.id,
          source: match ? 'hub' : 'draft',
          cte_number: (match ? receiptById.get(match.id)?.number : null) ?? r.cte_number ?? null,
          cte_series: (match ? receiptById.get(match.id)?.series : null) ?? r.cte_series ?? null,
          cte_type: r.cte_type ?? 'normal',
          access_key: r.access_key ?? match?.access_key ?? null,
          sefaz_status: match ? mapSearchOutboundStatus(match.status, match.sefaz_status, match.hub_document_id) : r.sefaz_status ?? 'pending',
          sefaz_status_reason: r.sefaz_status_reason ?? match?.sefaz_message ?? null,
          issued_at: r.issued_at || r.created_at,
          created_at: r.created_at,
          payer_name: r.payer_name ?? null,
          remitter: r.remitter ?? null,
          recipient: payloadRecipient.name ?? r.recipient ?? null,
          recipient_city: payloadRecipient.city ?? r.recipient_city ?? null,
          recipient_state: payloadRecipient.state ?? r.recipient_state ?? null,
          vehicle_plate: r.vehicle_plate ?? null,
          driver_name: r.driver_name ?? null,
          invoice_numbers: [r.invoice_numbers, readCtePayloadInvoiceNumbers(match?.cte_payload)].filter(Boolean).join(', ') || null,
          freight_value: Number(r.freight_value ?? 0),
          cargo_value: Number(r.cargo_value ?? 0),
          hub_document_id: match?.hub_document_id ?? null,
          emission_id: match?.emission_id ?? null,
          pdf_url: r.pdf_url ?? null,
          xml_url: r.xml_url ?? null,
        };
      });

      const hubRows: CteSearchRow[] = outbound
        .filter((d) => !usedHubIds.has(d.id))
        .map((d): CteSearchRow => {
          const payloadRecipient = readCtePayloadRecipient(d.cte_payload);
          const payloadPayer = readCtePayloadPayer(d.cte_payload);
          return {
          id: d.id,
          source: 'hub',
          cte_number: receiptById.get(d.id)?.number ?? d.invoice_number ?? null,
          cte_series: receiptById.get(d.id)?.series ?? null,
          cte_type: 'normal',
          access_key: d.access_key ?? null,
          sefaz_status: mapSearchOutboundStatus(d.status, d.sefaz_status, d.hub_document_id),
          sefaz_status_reason: d.sefaz_message ?? null,
          issued_at: d.issue_date ?? d.created_at ?? null,
          created_at: d.created_at,
          payer_name: payloadPayer.name,
          remitter: d.remitter ?? null,
          recipient: payloadRecipient.name ?? d.recipient ?? null,
          recipient_city: payloadRecipient.city ?? d.recipient_city ?? null,
          recipient_state: payloadRecipient.state ?? d.recipient_state ?? null,
          vehicle_plate: null,
          driver_name: null,
          invoice_numbers: readCtePayloadInvoiceNumbers(d.cte_payload),
          freight_value: Number(d.freight_value ?? 0),
          cargo_value: Number(d.value ?? 0),
          hub_document_id: d.hub_document_id ?? null,
          emission_id: d.emission_id ?? null,
          pdf_url: null,
          xml_url: null,
          };
        });

      const filtered = [...draftRows, ...hubRows].filter(row => matchesCteSearchFilters(row, filters, tenantTimezone));

      return filtered.sort((a, b) => {
        const da = new Date(a.issued_at ?? a.created_at).getTime();
        const db = new Date(b.issued_at ?? b.created_at).getTime();
        return db - da;
      });
    },
  });
}
