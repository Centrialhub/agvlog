import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
function has(haystack: unknown, needle: string) {
  return String(haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

/** Traduz status de `fiscal_documents` (saída) para o vocabulário SEFAZ do monitor. */
function mapOutboundStatus(status?: string | null, sefaz?: string | null): string {
  const s = (sefaz || '').toLowerCase();
  if (s.includes('autoriz')) return 'processed';
  // Uma rejeição do evento de cancelamento não cancela o CT-e: ele continua
  // autorizado e deve permanecer disponível para uma nova tentativa.
  if (s === 'cancel_rejected' || s === 'cancel_error' || s.includes('cancel_rejeit')) return 'processed';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('rejeit') || s.includes('erro')) return 'sefaz_error';
  const st = (status || '').toLowerCase();
  if (st === 'authorized') return 'processed';
  if (st === 'cancelled') return 'cancelled';
  if (st === 'rejected' || st === 'error') return 'sefaz_error';
  return 'pending';
}

export function useCteSearch(filters: CteSearchFilters, opts?: { enabled?: boolean }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['cte_search', currentTenant?.id, filters],
    enabled: !!currentTenant && (opts?.enabled ?? true),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    queryFn: async (): Promise<CteSearchRow[]> => {
      if (!currentTenant) return [];
      let q = supabase
        .from('cte_documents')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('issued_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(3000);

      const f = filters;
      const text = nz(f.text);
      const docNumber = nz(f.docNumber); if (docNumber) q = q.ilike('cte_number', `%${docNumber}%`);
      const internal = nz(f.internalNumber); if (internal) q = q.ilike('internal_number', `%${internal}%`);
      const ref = nz(f.referenceNumber); if (ref) q = q.ilike('reference_number', `%${ref}%`);
      const accessKey = nz(f.accessKey); if (accessKey) q = q.ilike('access_key', `%${accessKey.replace(/\D/g, '')}%`);
      const series = nz(f.series); if (series) q = q.eq('cte_series', series);
      const remitter = nz(f.remitter); if (remitter) q = q.ilike('remitter', `%${remitter}%`);
      const recipient = nz(f.recipient); if (recipient) q = q.ilike('recipient', `%${recipient}%`);
      const city = nz(f.recipientCity); if (city) q = q.ilike('recipient_city', `%${city}%`);
      const consignee = nz(f.consignee); if (consignee) q = q.ilike('consignee', `%${consignee}%`);
      const payer = nz(f.payer); if (payer) q = q.ilike('payer_name', `%${payer}%`);
      const payerGroup = nz(f.payerGroup); if (payerGroup) q = q.ilike('payer_group', `%${payerGroup}%`);
      const driver = nz(f.driverName); if (driver) q = q.ilike('driver_name', `%${driver}%`);
      const plate = nz(f.vehiclePlate); if (plate) q = q.ilike('vehicle_plate', `%${plate.replace(/\W/g, '')}%`);
      const trailer = nz(f.trailerPlate); if (trailer) q = q.ilike('trailer_plate', `%${trailer.replace(/\W/g, '')}%`);
      const ins = nz(f.insuranceCompany); if (ins) q = q.ilike('insurance_company', `%${ins}%`);
      const contract = nz(f.contractNumber); if (contract) q = q.ilike('contract_number', `%${contract}%`);
      const trip = nz(f.tripNumber); if (trip) q = q.ilike('trip_number', `%${trip}%`);
      const invoice = nz(f.invoiceNumber); if (invoice) q = q.ilike('invoice_numbers', `%${invoice}%`);
      const romexp = nz(f.romexpNumber); if (romexp) q = q.ilike('romexp_number', `%${romexp}%`);

      if (f.issueDateStart) q = q.gte('issued_at', f.issueDateStart);
      if (f.issueDateEnd) q = q.lte('issued_at', f.issueDateEnd + 'T23:59:59');

      if (f.cteTypes && f.cteTypes.length > 0) q = q.in('cte_type', f.cteTypes);
      if (f.statuses && f.statuses.length > 0) q = q.in('sefaz_status', f.statuses);

      const v = bool(f.voided); if (v !== null) q = q.eq('is_voided', v);
      const c = bool(f.closed); if (c !== null) q = q.eq('is_closed', c);
      const cp = bool(f.compensated); if (cp !== null) q = q.eq('is_compensated', cp);
      const af = bool(f.autonomousFreight); if (af !== null) q = q.eq('autonomous_freight', af);
      const cd = bool(f.complementaryDoc); if (cd !== null) q = q.eq('complementary_doc', cd);

      const { data, error } = await q;
      if (error) throw error;

      // As CT-e realmente transmitidas ficam em `fiscal_documents` (saída) e são
      // as únicas com id no Hub Fiscal — sem esse merge a consulta não permitia baixar arquivos.
      const { data: outbound, error: outErr } = await supabase
        .from('fiscal_documents')
        .select(
          'id, invoice_number, access_key, sefaz_status, sefaz_message, status, remitter, recipient, recipient_city, recipient_state, freight_value, value, issue_date, created_at, hub_document_id, emission_id',
        )
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null)
        .eq('document_type', 'outbound')
        .order('created_at', { ascending: false })
        .limit(3000);
      if (outErr) throw outErr;

      const hubByKey = new Map<string, any>();
      for (const d of outbound || []) {
        const key = (d as any).access_key;
        if (key && !hubByKey.has(key)) hubByKey.set(key, d);
      }

      const usedHubIds = new Set<string>();
      const draftRows: CteSearchRow[] = ((data || []) as any[]).map((r) => {
        const match = r.access_key ? hubByKey.get(r.access_key) : null;
        if (match) usedHubIds.add(match.id);
        return {
          id: match?.id ?? r.id,
          source: match ? 'hub' : 'draft',
          cte_number: r.cte_number ?? null,
          cte_series: r.cte_series ?? null,
          cte_type: r.cte_type ?? 'normal',
          access_key: r.access_key ?? null,
          sefaz_status: match ? mapOutboundStatus(match.status, match.sefaz_status) : r.sefaz_status ?? 'pending',
          sefaz_status_reason: r.sefaz_status_reason ?? match?.sefaz_message ?? null,
          issued_at: r.issued_at ?? null,
          created_at: r.created_at,
          payer_name: r.payer_name ?? null,
          remitter: r.remitter ?? null,
          recipient: r.recipient ?? null,
          recipient_city: r.recipient_city ?? null,
          recipient_state: r.recipient_state ?? null,
          vehicle_plate: r.vehicle_plate ?? null,
          driver_name: r.driver_name ?? null,
          invoice_numbers: r.invoice_numbers ?? null,
          freight_value: Number(r.freight_value ?? 0),
          cargo_value: Number(r.cargo_value ?? 0),
          hub_document_id: match?.hub_document_id ?? null,
          emission_id: match?.emission_id ?? null,
          pdf_url: r.pdf_url ?? null,
          xml_url: r.xml_url ?? null,
        };
      });

      const hubRows: CteSearchRow[] = (outbound || [])
        .filter((d: any) => !usedHubIds.has(d.id))
        .map((d: any) => ({
          id: d.id,
          source: 'hub' as const,
          cte_number: d.invoice_number ?? null,
          cte_series: null,
          cte_type: 'normal',
          access_key: d.access_key ?? null,
          sefaz_status: mapOutboundStatus(d.status, d.sefaz_status),
          sefaz_status_reason: d.sefaz_message ?? null,
          issued_at: d.issue_date ?? d.created_at ?? null,
          created_at: d.created_at,
          payer_name: d.remitter ?? null,
          remitter: d.remitter ?? null,
          recipient: d.recipient ?? null,
          recipient_city: d.recipient_city ?? null,
          recipient_state: d.recipient_state ?? null,
          vehicle_plate: null,
          driver_name: null,
          invoice_numbers: null,
          freight_value: Number(d.freight_value ?? d.value ?? 0),
          cargo_value: Number(d.value ?? 0),
          hub_document_id: d.hub_document_id ?? null,
          emission_id: d.emission_id ?? null,
          pdf_url: null,
          xml_url: null,
        }))
        // Filtros equivalentes aplicados em memória (a fonte é outra tabela).
        .filter((r) => {
          if (docNumber && !has(r.cte_number, docNumber)) return false;
          if (accessKey && !has(r.access_key, accessKey.replace(/\D/g, ''))) return false;
          if (remitter && !has(r.remitter, remitter)) return false;
          if (recipient && !has(r.recipient, recipient)) return false;
          if (city && !has(r.recipient_city, city)) return false;
          if (payer && !has(r.payer_name, payer)) return false;
          if (series || internal || ref || consignee || payerGroup || driver || plate || trailer) return false;
          if (ins || contract || trip || invoice || romexp) return false;
          if (f.statuses?.length && !f.statuses.includes(r.sefaz_status)) return false;
          if (f.cteTypes?.length && !f.cteTypes.includes('normal')) return false;
          if (f.issueDateStart && (r.issued_at ?? '') < f.issueDateStart) return false;
          if (f.issueDateEnd && (r.issued_at ?? '') > f.issueDateEnd + 'T23:59:59') return false;
          return true;
        });

      const all = [...draftRows, ...hubRows];
      const filtered = all.filter((r) => {
        if (text) {
          const hit =
            has(r.cte_number, text) || has(r.access_key, text) || has(r.remitter, text) ||
            has(r.recipient, text) || has(r.payer_name, text) || has(r.vehicle_plate, text) ||
            has(r.driver_name, text) || has(r.invoice_numbers, text) || has(r.recipient_city, text);
          if (!hit) return false;
        }
        if (f.downloadable === 'yes' && !(r.hub_document_id || r.pdf_url || r.xml_url)) return false;
        if (f.downloadable === 'no' && (r.hub_document_id || r.pdf_url || r.xml_url)) return false;
        return true;
      });

      return filtered.sort((a, b) => {
        const da = new Date(a.issued_at ?? a.created_at).getTime();
        const db = new Date(b.issued_at ?? b.created_at).getTime();
        return db - da;
      });
    },
  });
}
