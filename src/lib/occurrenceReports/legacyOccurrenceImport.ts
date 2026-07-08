import * as XLSX from 'xlsx';
import { parseBrCurrency, splitInvoiceNumbers, toIsoDate } from './occurrenceReportBuilder';

export type LegacyModel = 'returned_notes' | 'unserved_notes_week' | 'raw_occurrence_export' | 'unknown';

export interface LegacyReturnedRow {
  section: 'returns' | 'collection' | 'shortages' | 'surplus';
  customer_name?: string | null;
  city?: string | null;
  occurrence_number?: string | null;
  invoice_number?: string | null;
  return_type?: string | null;
  invoice_value?: number | null;
  reason?: string | null;
  quantity_text?: string | null;
  product_description?: string | null;
  password_or_authorization?: string | null;
  raw: Record<string, unknown>;
}

export interface LegacyUnservedRow {
  invoice_numbers: string[];
  customer_name?: string | null;
  city?: string | null;
  invoice_issue_date?: string | null;
  invoice_value?: number | null;
  supplier_name?: string | null;
  notes?: string | null;
  raw: Record<string, unknown>;
}

export interface ParsedLegacy {
  model: LegacyModel;
  file_name?: string;
  title?: string | null;
  reference_date?: string | null;
  supplier_name?: string | null;
  returned_rows?: LegacyReturnedRow[];
  unserved_rows?: LegacyUnservedRow[];
  errors: string[];
}

function toStr(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function findHeader(rows: unknown[][]): { headerIdx: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    const norm = row.map((c) => toStr(c).toUpperCase());
    const has = (needle: string) => norm.some((c) => c.includes(needle));
    if (has('NOTA FISCAL') && has('TIPO') && has('MOTIVO')) {
      const map: Record<string, number> = {};
      norm.forEach((c, idx) => {
        if (c.includes('CLIENTE')) map.customer = idx;
        else if (c.includes('CIDADE')) map.city = idx;
        else if (c.includes('OCORR')) map.occurrence = idx;
        else if (c.includes('NOTA FISCAL')) map.invoice = idx;
        else if (c.includes('TIPO')) map.type = idx;
        else if (c.includes('MOTIVO')) map.reason = idx;
        else if (c === 'QTD' || c.includes('QUANT')) map.qty = idx;
        else if (c.includes('DESCRI')) map.desc = idx;
        else if (c.includes('SENHA') || c.includes('AUTORIZ')) map.password = idx;
        else if (c.includes('VLR') || c.includes('VALOR')) map.value = idx;
      });
      if (map.invoice != null && map.type != null) return { headerIdx: i, map };
    }
    if ((norm.includes('NF') || norm.some((c) => c === 'NF')) && has('CLIENTE') && has('CIDADE') && has('VALOR')) {
      const map: Record<string, number> = {};
      norm.forEach((c, idx) => {
        if (c === 'NF' || c.startsWith('NF ')) map.invoice = idx;
        else if (c.includes('CLIENTE')) map.customer = idx;
        else if (c.includes('CIDADE')) map.city = idx;
        else if (c.includes('DATA')) map.date = idx;
        else if (c.includes('VALOR')) map.value = idx;
        else if (c.includes('FORNECEDOR')) map.supplier = idx;
        else if (c === 'OBS' || c.includes('OBSERV')) map.notes = idx;
      });
      if (map.invoice != null) return { headerIdx: i, map };
    }
  }
  return null;
}

function parseSheetReturned(rows: unknown[][], titleText: string): LegacyReturnedRow[] {
  const hdr = findHeader(rows);
  if (!hdr) return [];
  const out: LegacyReturnedRow[] = [];
  let section: LegacyReturnedRow['section'] = 'returns';
  for (let i = hdr.headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const nonEmpty = row.some((c) => toStr(c));
    if (!nonEmpty) continue;
    const firstCol = toStr(row[0]).toUpperCase();
    if (/^(COLETA|COLETAS)$/.test(firstCol)) { section = 'collection'; continue; }
    if (firstCol.startsWith('FALTAS')) { section = 'shortages'; continue; }
    if (firstCol.startsWith('SOBRA')) { section = 'surplus'; continue; }
    if (firstCol.startsWith('ASS') || firstCol.startsWith('DATA ')) continue;

    const invoice = toStr(row[hdr.map.invoice]);
    const desc = toStr(row[hdr.map.desc]);
    // Skip blank rows without meaningful data.
    if (!invoice && !desc && section !== 'collection' && section !== 'surplus') continue;

    out.push({
      section,
      customer_name: hdr.map.customer != null ? toStr(row[hdr.map.customer]) || null : null,
      city: hdr.map.city != null ? toStr(row[hdr.map.city]) || null : null,
      occurrence_number: hdr.map.occurrence != null ? toStr(row[hdr.map.occurrence]) || null : null,
      invoice_number: invoice || null,
      return_type: hdr.map.type != null ? toStr(row[hdr.map.type]) || null : null,
      invoice_value: hdr.map.value != null ? parseBrCurrency(row[hdr.map.value]) : null,
      reason: hdr.map.reason != null ? toStr(row[hdr.map.reason]) || null : null,
      quantity_text: hdr.map.qty != null ? toStr(row[hdr.map.qty]) || null : null,
      product_description: desc || null,
      password_or_authorization: hdr.map.password != null ? toStr(row[hdr.map.password]) || null : null,
      raw: { title: titleText, sectionOriginal: firstCol },
    });
  }
  return out;
}

function parseSheetUnserved(rows: unknown[][]): { supplier?: string; rows: LegacyUnservedRow[] } {
  const hdr = findHeader(rows);
  if (!hdr) return { rows: [] };
  let supplier: string | undefined;
  for (let i = 0; i < hdr.headerIdx; i++) {
    const cells = (rows[i] ?? []).map(toStr).filter(Boolean);
    const supplierCell = cells.find((c) => /LTDA|COMERCIAL|ATACADISTA|LTDA\.?$/.test(c));
    if (supplierCell) { supplier = supplierCell; break; }
  }
  const out: LegacyUnservedRow[] = [];
  for (let i = hdr.headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const invoiceRaw = hdr.map.invoice != null ? row[hdr.map.invoice] : null;
    const invoices = splitInvoiceNumbers(invoiceRaw as string | number | null);
    if (!invoices.length) continue;
    out.push({
      invoice_numbers: invoices,
      customer_name: hdr.map.customer != null ? toStr(row[hdr.map.customer]) || null : null,
      city: hdr.map.city != null ? toStr(row[hdr.map.city]) || null : null,
      invoice_issue_date: hdr.map.date != null ? toIsoDate(row[hdr.map.date]) : null,
      invoice_value: hdr.map.value != null ? parseBrCurrency(row[hdr.map.value]) : null,
      supplier_name: hdr.map.supplier != null ? toStr(row[hdr.map.supplier]) || null : supplier || null,
      notes: hdr.map.notes != null ? toStr(row[hdr.map.notes]) || null : null,
      raw: {},
    });
  }
  return { supplier, rows: out };
}

export function detectModelFromRows(rows: unknown[][]): LegacyModel {
  const flat = rows
    .slice(0, 10)
    .flatMap((r) => (r ?? []).map((c) => toStr(c).toUpperCase()));
  const joined = flat.join(' ');
  if (joined.includes('PROTOCOLO DE DEVOLU')) return 'returned_notes';
  if (joined.includes('TIPO DE DEVOLU') && joined.includes('MOTIVO')) return 'returned_notes';
  if (joined.includes('SITUA') && joined.includes('OCO ') && joined.includes('ROM EXP')) return 'raw_occurrence_export';
  if (flat.some((c) => c === 'NF') && joined.includes('CLIENTE') && joined.includes('VALOR')) return 'unserved_notes_week';
  return 'unknown';
}

/** Main entrypoint that reads an .xlsx buffer and detects the model. */
export function parseLegacyOccurrenceSpreadsheet(
  data: ArrayBuffer | Uint8Array,
  fileName?: string,
): ParsedLegacy {
  const errors: string[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array', cellDates: true });
  } catch (e) {
    return { model: 'unknown', errors: ['Falha ao ler planilha: ' + (e as Error).message] };
  }
  const results: ParsedLegacy = { model: 'unknown', file_name: fileName, errors, returned_rows: [], unserved_rows: [] };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
    const model = detectModelFromRows(rows);
    if (model === 'returned_notes') {
      results.model = 'returned_notes';
      const titleRow = (rows[0] ?? []).find((c) => toStr(c));
      results.title = toStr(titleRow) || null;
      const returned = parseSheetReturned(rows, results.title ?? '');
      results.returned_rows!.push(...returned);
    } else if (model === 'unserved_notes_week') {
      results.model = results.model === 'unknown' ? 'unserved_notes_week' : results.model;
      const { supplier, rows: unserved } = parseSheetUnserved(rows);
      if (supplier && !results.supplier_name) results.supplier_name = supplier;
      results.unserved_rows!.push(...unserved);
    }
  }
  if (results.model === 'unknown') {
    errors.push('Modelo de planilha não reconhecido. Cabeçalhos esperados: Nota Fiscal/Tipo/Motivo ou NF/Cliente/Cidade/Valor.');
  }
  return results;
}
