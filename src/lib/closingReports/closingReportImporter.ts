import * as XLSX from 'xlsx';
import { excelSerialToIso, type BuiltItem } from './closingReportBuilder';

export type LegacyModel = 'summary' | 'detailed' | 'unknown';

export interface LegacySummaryRow {
  arrival_date: string | null;
  billing_period: string | null;
  weight_kg: number;
  invoice_value: number;
}

export interface LegacyDetailedRow {
  origin: string | null;
  remitter: string | null;
  recipient: string | null;
  destination: string | null;
  issue_date: string | null;
  invoice_number: string | null;
  cte_number: string | null;
  invoice_value: number;
  weight_kg: number;
  freight_value: number;
  delivery_date: string | null;
  observation: string | null;
}

export interface LegacyImport {
  model: LegacyModel;
  title: string;
  period_start?: string | null;
  period_end?: string | null;
  summaryRows: LegacySummaryRow[];
  detailedRows: LegacyDetailedRow[];
  totals: {
    total_invoice_value: number;
    total_weight_kg: number;
    total_freight_value: number;
  };
}

function numeric(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialToIso(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yy = m[3];
    if (yy.length === 2) yy = '20' + yy;
    return `${yy}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

export function detectModel(sheet: XLSX.WorkSheet): LegacyModel {
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  const text = JSON.stringify(rows).toUpperCase();
  if (text.includes('CARGAS RECEBIDAS') || text.includes('PESO MANIDESTO') || text.includes('PESO MANIFESTO')) return 'summary';
  if (text.includes('RELATÓRIO DA') || text.includes('RELATORIO DA') || text.includes('DEZENA') || text.includes('QUINZENA')) return 'detailed';
  return 'unknown';
}

export function parseLegacyWorkbook(buffer: ArrayBuffer): LegacyImport {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const model = detectModel(sheet);
  const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });

  let title = '';
  for (const row of raw.slice(0, 6)) {
    const line = row.map((c: any) => String(c ?? '')).join(' ').trim();
    if (line.length > 5 && !/^R\$|^DATA|^ORIGEM|^N.\s*NOTA/i.test(line)) { title = line; break; }
  }

  const summaryRows: LegacySummaryRow[] = [];
  const detailedRows: LegacyDetailedRow[] = [];
  const totals = { total_invoice_value: 0, total_weight_kg: 0, total_freight_value: 0 };

  if (model === 'summary' || model === 'unknown') {
    // Detecta cabeçalho: DATA CHEGADA | FATURAMENTO | PESO MANIFESTO/MANIDESTO | R$ VALOR FATURADO
    let headerIdx = -1;
    for (let i = 0; i < raw.length; i++) {
      const cells = raw[i].map((c: any) => String(c ?? '').toUpperCase());
      if (cells.some(c => c.includes('DATA') && c.includes('CHEGADA')) &&
          cells.some(c => c.includes('PESO'))) { headerIdx = i; break; }
    }
    if (headerIdx >= 0) {
      for (let i = headerIdx + 1; i < raw.length; i++) {
        const r = raw[i];
        if (!r || r.every((c: any) => c === '' || c == null)) continue;
        const arrival = toIsoDate(r[0]);
        const period = r[1] ? String(r[1]) : null;
        const weight = numeric(r[2]);
        const value = numeric(r[3]);
        if (!arrival && !period) continue;
        summaryRows.push({ arrival_date: arrival, billing_period: period, weight_kg: weight, invoice_value: value });
        totals.total_weight_kg += weight;
        totals.total_invoice_value += value;
      }
    }
  }

  if (model === 'detailed' || model === 'unknown') {
    let headerIdx = -1;
    for (let i = 0; i < raw.length; i++) {
      const cells = raw[i].map((c: any) => String(c ?? '').toUpperCase());
      if (cells.some(c => c.includes('ORIGEM')) && cells.some(c => c.includes('NOTA'))) { headerIdx = i; break; }
    }
    if (headerIdx >= 0) {
      const header = raw[headerIdx].map((c: any) => String(c ?? '').toUpperCase());
      const col = (needle: string) => header.findIndex((h: string) => h.includes(needle));
      const iOrigin = col('ORIGEM');
      const iRem = col('REMETENTE');
      const iDest = col('DESTINAT');
      const iDestino = header.findIndex((h: string) => /DESTINO$|DESTINO\s/.test(h));
      const iEmis = col('EMISS');
      const iNota = col('NOTA');
      const iCte = header.findIndex((h: string) => h.includes('CONHECIMENTO') || h.includes('CT-E') || h.includes('CTE'));
      const iVal = col('VALOR NOTA') >= 0 ? col('VALOR NOTA') : col('VALOR');
      const iPeso = col('PESO');
      const iFrete = col('FRETE');
      const iEntrega = col('ENTREGA');
      const iObs = col('OBSERV');

      for (let i = headerIdx + 1; i < raw.length; i++) {
        const r = raw[i];
        if (!r || r.every((c: any) => c === '' || c == null)) continue;
        const row: LegacyDetailedRow = {
          origin: iOrigin >= 0 ? String(r[iOrigin] ?? '') || null : null,
          remitter: iRem >= 0 ? String(r[iRem] ?? '') || null : null,
          recipient: iDest >= 0 ? String(r[iDest] ?? '') || null : null,
          destination: iDestino >= 0 ? String(r[iDestino] ?? '') || null : null,
          issue_date: iEmis >= 0 ? toIsoDate(r[iEmis]) : null,
          invoice_number: iNota >= 0 ? String(r[iNota] ?? '') || null : null,
          cte_number: iCte >= 0 ? String(r[iCte] ?? '') || null : null,
          invoice_value: iVal >= 0 ? numeric(r[iVal]) : 0,
          weight_kg: iPeso >= 0 ? numeric(r[iPeso]) : 0,
          freight_value: iFrete >= 0 ? numeric(r[iFrete]) : 0,
          delivery_date: iEntrega >= 0 ? toIsoDate(r[iEntrega]) : null,
          observation: iObs >= 0 ? String(r[iObs] ?? '') || null : null,
        };
        // Skip total rows
        if (!row.invoice_number && !row.remitter && !row.recipient) continue;
        detailedRows.push(row);
        totals.total_invoice_value += row.invoice_value;
        totals.total_weight_kg += row.weight_kg;
        totals.total_freight_value += row.freight_value;
      }
    }
  }

  return { model, title, summaryRows, detailedRows, totals };
}

export function legacyDetailedToItems(rows: LegacyDetailedRow[]): BuiltItem[] {
  return rows.map((r, idx) => ({
    fiscal_document_id: null,
    cte_document_id: null,
    load_id: null,
    origin_city: r.origin,
    origin_state: null,
    remitter_name: r.remitter,
    remitter_cnpj: null,
    recipient_name: r.recipient,
    recipient_cnpj: null,
    destination_city: r.destination,
    destination_state: null,
    issue_date: r.issue_date,
    arrival_date: null,
    delivery_date: r.delivery_date,
    invoice_number: r.invoice_number,
    invoice_key: null,
    cte_number: r.cte_number,
    cte_key: null,
    load_number: null,
    invoice_value: r.invoice_value,
    weight_kg: r.weight_kg,
    volume_count: 0,
    freight_value: r.freight_value,
    freight_cif_value: 0,
    freight_fob_value: 0,
    delivery_status: null,
    observation: r.observation,
    source_type: 'spreadsheet_import',
    sort_order: idx,
  }));
}
