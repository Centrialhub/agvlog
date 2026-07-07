import * as XLSX from 'xlsx';
import {
  splitMultiValue, excelSerialToIso, extractLegacyExpectedPayment,
  extractLegacyClosedDate, toNumber, toPercentFraction,
  type NormalizedSummaryRow, type NormalizedDetailRow, type NormalizedUnloadingRow,
} from './loadImportNormalizer';

export type SpreadsheetKind = 'summary' | 'detail' | 'unloading' | 'unknown';

export interface ParsedSpreadsheet {
  kind: SpreadsheetKind;
  sheetName: string;
  summary: NormalizedSummaryRow[];
  detail: NormalizedDetailRow[];
  unloading: NormalizedUnloadingRow[];
  errors: Array<{ row: number; message: string }>;
}

/** Locate the header row inside a sheet by looking for expected column names. */
function locateHeader(rows: any[][], keywords: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const line = (rows[i] || []).map(c => String(c ?? '').toUpperCase().trim());
    const hit = keywords.every(k => line.some(cell => cell.includes(k)));
    if (hit) return i;
  }
  return -1;
}

function indexOfHeader(header: string[], keywords: string[]): number {
  const up = header.map(h => String(h ?? '').toUpperCase().trim());
  for (let i = 0; i < up.length; i++) {
    if (keywords.some(k => up[i].includes(k))) return i;
  }
  return -1;
}

/**
 * Parse "RESUMO CARGAS RECEBIDAS" spreadsheet.
 * Header contains: DATA DA CARGA / DATA CHEGADA / CARGA / VALOR FATURADO / VALOR FRETE / CTE / STATUS.
 */
export function parseSummarySheet(rows: any[][]): { rows: NormalizedSummaryRow[]; errors: Array<{ row: number; message: string }> } {
  const errors: Array<{ row: number; message: string }> = [];
  const out: NormalizedSummaryRow[] = [];
  const headerIdx = locateHeader(rows, ['CARGA', 'VALOR FATURADO', 'VALOR FRETE']);
  if (headerIdx < 0) return { rows: out, errors: [{ row: 0, message: 'Cabeçalho não encontrado' }] };
  const header = rows[headerIdx].map(c => String(c ?? ''));
  const idxDate     = indexOfHeader(header, ['DATA DA CARGA']);
  const idxArrival  = indexOfHeader(header, ['DATA CHEGADA']);
  const idxLoad     = indexOfHeader(header, ['CARGA']);
  const idxBilled   = indexOfHeader(header, ['VALOR FATURADO']);
  const idxFreight  = indexOfHeader(header, ['VALOR FRETE']);
  const idxCte      = indexOfHeader(header, ['CTE', 'CT-E', 'CT E']);
  const idxStatus   = indexOfHeader(header, ['STATUS']);

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const loadRaw = r[idxLoad];
    // Skip total rows / blank rows / repeated headers
    const firstCell = String(r[1] ?? r[0] ?? '').toUpperCase();
    if (firstCell.startsWith('TOTAL') || firstCell.includes('CARGA') && !loadRaw) continue;
    if (!loadRaw) continue;
    const num = String(loadRaw).trim();
    if (!num || num.toUpperCase() === 'CARGA') continue;
    const status = idxStatus >= 0 ? String(r[idxStatus] ?? '').trim() || null : null;
    out.push({
      external_load_number: num,
      load_date: excelSerialToIso(r[idxDate]),
      arrival_date: excelSerialToIso(r[idxArrival]),
      gross_cargo_value: toNumber(r[idxBilled]),
      freight_amount: toNumber(r[idxFreight]),
      cte_numbers: splitMultiValue(r[idxCte]),
      legacy_status_text: status,
      expected_payment_date: extractLegacyExpectedPayment(status),
      closed_at: extractLegacyClosedDate(status),
    });
  }
  return { rows: out, errors };
}

/**
 * Parse "PLANILHA DA CARGAS" (detail per NF).
 * Header: NFiscal / CARGA / Fornecedor / Data de Emissão / Destinatário / Destino / % frete / Peso / Valor NF / Valor frete / Frete total.
 */
export function parseDetailSheet(rows: any[][]): { rows: NormalizedDetailRow[]; errors: Array<{ row: number; message: string }> } {
  const errors: Array<{ row: number; message: string }> = [];
  const out: NormalizedDetailRow[] = [];
  const headerIdx = locateHeader(rows, ['NFISCAL', 'CARGA', 'VALOR NF']);
  if (headerIdx < 0) return { rows: out, errors: [{ row: 0, message: 'Cabeçalho detalhado não encontrado' }] };
  const header = rows[headerIdx].map(c => String(c ?? ''));
  const idxNf       = indexOfHeader(header, ['NFISCAL', 'NF FISCAL', 'NOTA FISCAL', 'N NOTA']);
  const idxLoad     = indexOfHeader(header, ['CARGA']);
  const idxSupp     = indexOfHeader(header, ['FORNECEDOR', 'REMETENTE']);
  const idxIssue    = indexOfHeader(header, ['DATA DE EMIS', 'EMISSÃO', 'EMISSAO']);
  const idxDest     = indexOfHeader(header, ['DESTINATÁRIO', 'DESTINATARIO']);
  const idxCity     = indexOfHeader(header, ['DESTINO', 'CIDADE']);
  const idxPct      = indexOfHeader(header, ['% FRETE', 'PERC FRETE', 'PORCENTAGEM']);
  const idxWeight   = indexOfHeader(header, ['PESO']);
  const idxValNf    = indexOfHeader(header, ['VALOR NF', 'VALOR NOTA']);
  const idxValFret  = indexOfHeader(header, ['VALOR FRETE']);

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nfRaw = r[idxNf];
    const loadRaw = r[idxLoad];
    if (!nfRaw || !loadRaw) continue;
    const invoices = splitMultiValue(nfRaw);
    if (!invoices.length) continue;
    out.push({
      external_load_number: String(loadRaw).trim(),
      invoice_numbers: invoices,
      issuer_name: idxSupp >= 0 ? (String(r[idxSupp] ?? '').trim() || null) : null,
      issue_date: excelSerialToIso(r[idxIssue]),
      recipient_name: idxDest >= 0 ? (String(r[idxDest] ?? '').trim() || null) : null,
      destination_city: idxCity >= 0 ? (String(r[idxCity] ?? '').trim() || null) : null,
      freight_percent: toPercentFraction(r[idxPct]),
      weight_kg: toNumber(r[idxWeight]),
      cargo_value: toNumber(r[idxValNf]),
      freight_value: toNumber(r[idxValFret]),
    });
  }
  return { rows: out, errors };
}

/**
 * Parse "PLANILHA DE DESCARGA" (per-NF unloading charges).
 * Header: NOTA FISCAL / CLIENTE / FORNECEDOR / CIDADE / DATA / VALOR.
 */
export function parseUnloadingSheet(rows: any[][]): { rows: NormalizedUnloadingRow[]; errors: Array<{ row: number; message: string }> } {
  const errors: Array<{ row: number; message: string }> = [];
  const out: NormalizedUnloadingRow[] = [];
  const headerIdx = locateHeader(rows, ['NOTA FISCAL', 'CLIENTE']);
  if (headerIdx < 0) return { rows: out, errors: [{ row: 0, message: 'Cabeçalho de descarga não encontrado' }] };
  const header = rows[headerIdx].map(c => String(c ?? ''));
  const idxNf   = indexOfHeader(header, ['NOTA FISCAL']);
  const idxCli  = indexOfHeader(header, ['CLIENTE']);
  const idxSup  = indexOfHeader(header, ['FORNECEDOR']);
  const idxCity = indexOfHeader(header, ['CIDADE']);
  const idxDate = indexOfHeader(header, ['DATA']);
  const idxVal  = indexOfHeader(header, ['VALOR']);

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nfRaw = r[idxNf];
    if (!nfRaw) continue;
    const invoices = splitMultiValue(nfRaw);
    const suppliers = splitMultiValue(r[idxSup]);
    out.push({
      invoice_numbers: invoices,
      client_name: idxCli >= 0 ? (String(r[idxCli] ?? '').trim() || null) : null,
      supplier_names: suppliers,
      city: idxCity >= 0 ? (String(r[idxCity] ?? '').trim() || null) : null,
      service_date: excelSerialToIso(r[idxDate]),
      amount: toNumber(r[idxVal]),
    });
  }
  return { rows: out, errors };
}

/** Detect the spreadsheet flavour based on the sheet header signature. */
export function detectSpreadsheetKind(rows: any[][]): SpreadsheetKind {
  if (locateHeader(rows, ['NFISCAL', 'CARGA', 'VALOR NF']) >= 0) return 'detail';
  if (locateHeader(rows, ['NOTA FISCAL', 'CLIENTE', 'CIDADE', 'VALOR']) >= 0) return 'unloading';
  if (locateHeader(rows, ['CARGA', 'VALOR FATURADO', 'VALOR FRETE']) >= 0) return 'summary';
  return 'unknown';
}

/** Parse an ArrayBuffer of an XLSX file, returning ParsedSpreadsheet for the first meaningful sheet. */
export function parseLoadSpreadsheet(buf: ArrayBuffer): ParsedSpreadsheet[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const out: ParsedSpreadsheet[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: null, raw: true });
    const kind = detectSpreadsheetKind(rows);
    if (kind === 'unknown') continue;
    if (kind === 'detail') {
      const p = parseDetailSheet(rows);
      out.push({ kind, sheetName: name, summary: [], detail: p.rows, unloading: [], errors: p.errors });
    } else if (kind === 'unloading') {
      const p = parseUnloadingSheet(rows);
      out.push({ kind, sheetName: name, summary: [], detail: [], unloading: p.rows, errors: p.errors });
    } else {
      const p = parseSummarySheet(rows);
      out.push({ kind, sheetName: name, summary: p.rows, detail: [], unloading: [], errors: p.errors });
    }
  }
  return out;
}