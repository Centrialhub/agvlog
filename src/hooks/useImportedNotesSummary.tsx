import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export type NoteOperationalStatus =
  | 'not_processed' | 'not_processed_redispatch' | 'processed'
  | 'in_transit' | 'delivered' | 'not_delivered'
  | 'transferred' | 'not_transferred';

export const NOTE_STATUS_LABELS: Record<NoteOperationalStatus, string> = {
  not_processed: 'Não processado',
  not_processed_redispatch: 'Não Processado Redespacho',
  processed: 'Processado',
  in_transit: 'Em trânsito',
  delivered: 'Entregue',
  not_delivered: 'Não entregue',
  transferred: 'Transferido',
  not_transferred: 'Não transferido',
};

export interface ImportedNoteFilters {
  branch?: string | null;
  controlLot?: string | null;
  dynamicLot?: string | null;
  issueFrom?: string | null;
  issueTo?: string | null;
  importFrom?: string | null;
  importTo?: string | null;
  remitter?: string | null;
  clientId?: string | null;
  supplierId?: string | null;
  originCity?: string | null;
  destinationCity?: string | null;
  status?: NoteOperationalStatus | 'all' | null;
  invoiceNumber?: string | null;
  grouped?: boolean;
}

export interface ImportedNoteRow {
  id: string;
  invoice_number: string | null;
  access_key: string | null;
  import_batch_id: string | null;
  control_lot: string | null;
  dynamic_lot: string | null;
  imported_at: string | null;
  issue_date: string | null;
  remitter: string | null;
  recipient: string | null;
  origin_city: string | null;
  origin_state: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  value: number | null;
  weight_kg: number | null;
  volume_count: number | null;
  pallet_count: number | null;
  freight_value: number | null;
  freight_cif_value: number | null;
  freight_fob_value: number | null;
  imported_note_status: NoteOperationalStatus | null;
  status: string | null;
  delivery_meta: any;
  load_id: string | null;
  client_id: string | null;
  document_type: string | null;
  clients?: { company_name: string | null; tax_id: string | null } | null;
  suppliers?: { company_name: string | null; tax_id: string | null } | null;
  loads?: { id: string; load_number: string | null; status: string | null; origin: any; destination: any; vehicle_id: string | null; driver_id: string | null } | null;
  cte_number?: string | null;
  cte_id?: string | null;
  cte_freight_value?: number | null;
  cte_status?: string | null;
  cte_access_key?: string | null;
  nfse_number?: string | null;
  nfse_id?: string | null;
  operational_status: NoteOperationalStatus;
}

/**
 * Extrai o número do CT-e (nCT) da chave de acesso de 44 dígitos.
 * Layout: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nCT(9) tpEmis(1) cCT(8) cDV(1)
 */
export function cteNumberFromAccessKey(key?: string | null): string | null {
  const k = (key || '').replace(/\D/g, '');
  if (k.length !== 44) return null;
  const n = k.slice(25, 34).replace(/^0+/, '');
  return n || null;
}

export function resolveNoteStatus(row: Partial<ImportedNoteRow> & { cte_id?: string | null; loads?: any }): NoteOperationalStatus {
  if (row.imported_note_status) return row.imported_note_status;
  const dm = row.delivery_meta || {};
  if (dm?.delivered === true || row.status === 'delivered') return 'delivered';
  if (dm?.ne === true || row.status === 'not_delivered') return 'not_delivered';
  const loadStatus = row.loads?.status;
  if (loadStatus === 'in_transit') return 'in_transit';
  if (loadStatus === 'delivered') return 'delivered';
  if (loadStatus && ['planned', 'assembling', 'ready', 'loading', 'loaded'].includes(loadStatus)) return 'processed';
  if (row.cte_id || row.load_id) return 'processed';
  return 'not_processed';
}

export function useImportedNotes(filters: ImportedNoteFilters) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['imported_notes_summary', currentTenant?.id, filters],
    enabled: !!currentTenant,
    queryFn: async () => {
      let q = supabase
        .from('fiscal_documents')
        .select(`
          id, invoice_number, access_key, import_batch_id, control_lot, dynamic_lot,
          imported_at, issue_date, remitter, recipient, origin_city, origin_state,
          recipient_city, recipient_state, value, weight_kg, volume_count, pallet_count,
          freight_value, freight_cif_value, freight_fob_value, imported_note_status,
          status, delivery_meta, load_id, client_id, document_type,
          cte_emitted_at, cte_emitted_outbound_id, nfse_emitted_at, nfse_emitted_document_id,
          clients:client_id(company_name, tax_id),
          suppliers:supplier_id(company_name, tax_id),
          loads:load_id(id, load_number, status, origin, destination, vehicle_id, driver_id)
        `)
        .eq('tenant_id', currentTenant!.id)
        .eq('document_type', 'inbound')
        .is('deleted_at', null)
        .order('imported_at', { ascending: false, nullsFirst: false })
        .limit(2000);

      if (filters.controlLot) q = q.ilike('control_lot', `%${filters.controlLot}%`);
      if (filters.dynamicLot) q = q.ilike('dynamic_lot', `%${filters.dynamicLot}%`);
      if (filters.issueFrom) q = q.gte('issue_date', filters.issueFrom);
      if (filters.issueTo) q = q.lte('issue_date', filters.issueTo);
      if (filters.importFrom) q = q.gte('imported_at', filters.importFrom);
      if (filters.importTo) q = q.lte('imported_at', filters.importTo + 'T23:59:59');
      if (filters.remitter) q = q.ilike('remitter', `%${filters.remitter}%`);
      if (filters.invoiceNumber) q = q.ilike('invoice_number', `%${filters.invoiceNumber}%`);
      if (filters.clientId) q = q.eq('client_id', filters.clientId);
      if (filters.supplierId) q = q.eq('supplier_id', filters.supplierId);
      if (filters.originCity) q = q.ilike('origin_city', `%${filters.originCity}%`);
      if (filters.destinationCity) q = q.ilike('recipient_city', `%${filters.destinationCity}%`);
      if (filters.status && filters.status !== 'all' && ['not_processed_redispatch','transferred','not_transferred'].includes(filters.status)) {
        q = q.eq('imported_note_status', filters.status);
      }

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as any[];

      // Cross com CT-e via cte_documents.fiscal_document_ids
      const ids = rows.map(r => r.id);
      const cteMap = new Map<string, any>();
      if (ids.length > 0) {
        const { data: allCtes } = await supabase
          .from('cte_documents')
          .select('id, cte_number, freight_value, issued_at, status, fiscal_document_ids, cancelled_at')
          .eq('tenant_id', currentTenant!.id)
          .overlaps('fiscal_document_ids', ids as any)
          .order('issued_at', { ascending: false })
          .limit(2000);
        for (const c of allCtes || []) {
          const fids = Array.isArray(c.fiscal_document_ids) ? c.fiscal_document_ids : [];
          for (const fid of fids) {
            if (!cteMap.has(fid)) cteMap.set(fid, c); // primeiro é o mais recente
          }
        }
      }

      // CT-e realmente emitidos ficam em `fiscal_documents` (outbound), referenciados
      // por `cte_emitted_outbound_id` na própria NF. O número fiscal é derivado da chave.
      const outboundIds = Array.from(
        new Set(rows.map(r => r.cte_emitted_outbound_id).filter(Boolean)),
      ) as string[];
      const outboundMap = new Map<string, any>();
      if (outboundIds.length > 0) {
        const { data: outbound } = await supabase
          .from('fiscal_documents')
          .select('id, access_key, invoice_number, freight_value, status, sefaz_status')
          .in('id', outboundIds);
        for (const o of outbound || []) outboundMap.set(o.id, o);
      }

      // NFS-e (Montes Claros) — número real vem de `nfse_documents`
      const nfseMap = new Map<string, any>();
      if (ids.length > 0) {
        const { data: nfses } = await supabase
          .from('nfse_documents')
          .select('id, nfse_number, rps_number, status, fiscal_document_ids, created_at')
          .eq('tenant_id', currentTenant!.id)
          .overlaps('fiscal_document_ids', ids as any)
          .order('created_at', { ascending: false })
          .limit(2000);
        for (const n of (nfses || []) as any[]) {
          if (n.status === 'cancelled') continue;
          const fids = Array.isArray(n.fiscal_document_ids) ? n.fiscal_document_ids : [];
          for (const fid of fids) if (!nfseMap.has(fid)) nfseMap.set(fid, n);
        }
      }

      const enriched: ImportedNoteRow[] = rows.map(r => {
        const cte = cteMap.get(r.id);
        const out = r.cte_emitted_outbound_id ? outboundMap.get(r.cte_emitted_outbound_id) : null;
        const nfse = nfseMap.get(r.id) || null;
        const base: any = {
          ...r,
          cte_id: cte?.id ?? out?.id ?? null,
          cte_number: cte?.cte_number ?? cteNumberFromAccessKey(out?.access_key) ?? null,
          cte_access_key: out?.access_key ?? null,
          cte_freight_value: cte?.freight_value ?? out?.freight_value ?? null,
          cte_status: cte?.status ?? out?.status ?? null,
          nfse_id: nfse?.id ?? null,
          nfse_number: nfse ? String(nfse.nfse_number ?? nfse.rps_number ?? '') || null : null,
        };
        base.operational_status = resolveNoteStatus(base);
        return base as ImportedNoteRow;
      });

      // Filtro derivado por status operacional (client-side)
      if (filters.status && filters.status !== 'all') {
        return enriched.filter(r => r.operational_status === filters.status);
      }
      return enriched;
    },
  });
}

export function getImportedNoteSummaryTotals(rows: ImportedNoteRow[]) {
  let value = 0, weight = 0, volume = 0, cif = 0, fob = 0;
  for (const r of rows) {
    value += Number(r.value || 0);
    weight += Number(r.weight_kg || 0);
    volume += Number(r.volume_count ?? r.pallet_count ?? 0);
    cif += Number(r.freight_cif_value ?? r.freight_value ?? 0);
    fob += Number(r.freight_fob_value || 0);
  }
  return {
    rowCount: rows.length,
    totalValue: Math.round(value * 100) / 100,
    totalWeight: Math.round(weight * 1000) / 1000,
    totalVolume: Math.round(volume * 1000) / 1000,
    totalCif: Math.round(cif * 100) / 100,
    totalFob: Math.round(fob * 100) / 100,
  };
}

export function groupNotesBy(rows: ImportedNoteRow[], mode: 'destination' | 'origin') {
  const groups = new Map<string, ImportedNoteRow[]>();
  for (const r of rows) {
    const city = mode === 'destination'
      ? (r.recipient_city?.trim() || 'SEM DESTINO')
      : (r.origin_city?.trim() || 'SEM ORIGEM');
    const state = mode === 'destination' ? r.recipient_state : r.origin_state;
    const key = state ? `${city} / ${state}` : city;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([key, items]) => ({ key, items, totals: getImportedNoteSummaryTotals(items) }));
}

export function exportImportedNotesCsv(rows: ImportedNoteRow[]): string {
  const header = [
    'Empresa','Filial','Nº Nota','Lote Importação','Remetente','Destinatário','Nº CT-e','Nº NFS-e','Chave CT-e','Tipo Documento',
    'Valor Frete CIF','Valor Frete FOB','Data Emissão','Município Origem','UF Origem',
    'Município Destino','UF Destino','Valor Nota','Volume','Peso','Situação','Carga/Romaneio',
  ];
  const fmt = (v: any) => v == null ? '' : String(v).replace(/"/g, '""');
  const dt = (s: any) => s ? new Date(String(s).length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '';
  const num = (n: any) => n == null ? '' : String(Number(n).toFixed(2)).replace('.', ',');
  const numW = (n: any) => n == null ? '' : String(Number(n).toFixed(3)).replace('.', ',');
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      '', '',
      fmt(r.invoice_number),
      fmt(r.import_batch_id || r.control_lot),
      fmt(r.remitter),
      fmt(r.recipient),
      fmt(r.cte_number),
      fmt(r.nfse_number),
      fmt(r.cte_access_key),
      fmt(r.document_type),
      num(r.freight_cif_value ?? r.freight_value),
      num(r.freight_fob_value),
      dt(r.issue_date),
      fmt(r.origin_city),
      fmt(r.origin_state),
      fmt(r.recipient_city),
      fmt(r.recipient_state),
      num(r.value),
      numW(r.volume_count ?? r.pallet_count),
      numW(r.weight_kg),
      fmt(NOTE_STATUS_LABELS[r.operational_status] ?? r.operational_status),
      fmt(r.loads?.load_number),
    ].map(v => `"${v}"`).join(';'));
  }
  // BOM UTF-8
  return '\ufeff' + lines.join('\r\n');
}

export async function createSummaryReportSnapshot(
  tenantId: string,
  reportType: 'destination_summary' | 'origin_summary' | 'raw_list',
  grouped: boolean,
  filters: ImportedNoteFilters,
  rows: ImportedNoteRow[],
) {
  const totals = getImportedNoteSummaryTotals(rows);
  const { data, error } = await supabase.from('imported_note_summary_reports' as any).insert({
    tenant_id: tenantId,
    report_type: reportType,
    grouped,
    filters: filters as any,
    row_count: totals.rowCount,
    total_invoice_value: totals.totalValue,
    total_weight_kg: totals.totalWeight,
    total_volume: totals.totalVolume,
  } as any).select().maybeSingle();
  if (error) throw error;
  return data;
}