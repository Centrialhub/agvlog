import * as XLSX from 'xlsx';
import { inferRuralAttributes, normalizeText } from './ruralDeliveryMatcher';
import { excelSerialToIso, toNumber } from '@/lib/loadImports/loadImportNormalizer';

// Cabeçalhos que reconhecemos (nomes canonicalizados)
const HEADER_MAP: Record<string, string> = {
  cte: 'cte',
  'nº cte': 'cte',
  remetente: 'sender',
  fornecedor: 'sender',
  destinatario: 'recipient',
  cliente: 'recipient',
  cidade: 'city',
  municipio: 'city',
  bairro: 'neighborhood',
  localidade: 'neighborhood',
  'nº nota': 'invoice',
  'n nota': 'invoice',
  nf: 'invoice',
  emissao: 'issue_date',
  'vlr. nota': 'invoice_value',
  vlrnota: 'invoice_value',
  valor: 'invoice_value',
  peso: 'weight',
  volumes: 'volumes',
  origem: 'origin',
  'km ida e volta': 'round_trip_km',
  km: 'round_trip_km',
  resolucao: 'resolution',
  taxi: 'taxi',
};

function canonicalHeader(h: unknown): string | null {
  const k = normalizeText(h).replace(/\s+/g, ' ').trim();
  if (!k) return null;
  return HEADER_MAP[k] || HEADER_MAP[k.replace(/\s+/g, '')] || null;
}

export interface ParsedRuralRow {
  sheet: string;
  supplier_name_snapshot: string | null;
  recipient_name_snapshot: string | null;
  city: string | null;
  neighborhood: string | null;
  invoice_number: string | null;
  cte_number: string | null;
  issue_date: string | null;
  invoice_value: number | null;
  weight_kg: number | null;
  volumes: number | null;
  origin_city: string | null;
  round_trip_km: number | null;
  resolution_text: string | null;
  taxi_text: string | null;
  inferred: ReturnType<typeof inferRuralAttributes>;
  raw: Record<string, unknown>;
}

export interface ParsedRuralSpreadsheet {
  fileName: string;
  totalRows: number;
  rows: ParsedRuralRow[];
  sheetsProcessed: string[];
}

/** Detecta a linha de cabeçalho olhando as 15 primeiras linhas de cada aba. */
function detectHeaderRow(matrix: unknown[][]): { headerIndex: number; headers: (string | null)[] } | null {
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const row = matrix[i] || [];
    const canonicals = row.map(canonicalHeader);
    const hits = canonicals.filter(Boolean).length;
    if (hits >= 4) return { headerIndex: i, headers: canonicals };
  }
  return null;
}

export function parseRuralSpreadsheet(buffer: ArrayBuffer, fileName = 'planilha.xlsx'): ParsedRuralSpreadsheet {
  const wb = XLSX.read(buffer, { type: 'array' });
  const rows: ParsedRuralRow[] = [];
  const sheetsProcessed: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][];
    const detected = detectHeaderRow(matrix);
    if (!detected) continue;
    sheetsProcessed.push(sheetName);
    const supplierFromSheet = sheetName.trim();

    for (let r = detected.headerIndex + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row) continue;
      const record: Record<string, unknown> = {};
      detected.headers.forEach((h, idx) => {
        if (h) record[h] = row[idx];
      });
      if (!record.recipient && !record.city && !record.invoice) continue;
      const recipient = record.recipient ? String(record.recipient).trim() : null;
      const city = record.city ? String(record.city).trim() : null;
      if (!recipient || !city) continue;

      const resolution = record.resolution != null ? String(record.resolution).trim() : null;
      const taxi = record.taxi != null ? String(record.taxi).trim() : null;
      const inferred = inferRuralAttributes(resolution, taxi);

      rows.push({
        sheet: sheetName,
        supplier_name_snapshot: record.sender ? String(record.sender).trim() : supplierFromSheet,
        recipient_name_snapshot: recipient,
        city,
        neighborhood: record.neighborhood ? String(record.neighborhood).trim() : null,
        invoice_number: record.invoice != null ? String(record.invoice).trim() : null,
        cte_number: record.cte != null ? String(record.cte).trim() : null,
        issue_date: excelSerialToIso(record.issue_date),
        invoice_value: record.invoice_value != null ? toNumber(record.invoice_value) : null,
        weight_kg: record.weight != null ? toNumber(record.weight) : null,
        volumes: record.volumes != null ? toNumber(record.volumes) : null,
        origin_city: record.origin ? String(record.origin).trim() : null,
        round_trip_km: record.round_trip_km != null ? toNumber(record.round_trip_km) : null,
        resolution_text: resolution,
        taxi_text: taxi,
        inferred,
        raw: record,
      });
    }
  }

  return {
    fileName,
    totalRows: rows.length,
    rows,
    sheetsProcessed,
  };
}

/** Deduplica linhas mantendo a mais completa por (destinatário+cidade+bairro+fornecedor). */
export function dedupeRuralRows(rows: ParsedRuralRow[]): ParsedRuralRow[] {
  const map = new Map<string, ParsedRuralRow>();
  for (const r of rows) {
    const key = [
      normalizeText(r.recipient_name_snapshot),
      normalizeText(r.city),
      normalizeText(r.neighborhood),
      normalizeText(r.supplier_name_snapshot),
    ].join('|');
    const prev = map.get(key);
    if (!prev) { map.set(key, r); continue; }
    // Preferir a que tem mais texto de resolução/táxi
    const scoreA = (prev.resolution_text?.length || 0) + (prev.taxi_text?.length || 0);
    const scoreB = (r.resolution_text?.length || 0) + (r.taxi_text?.length || 0);
    if (scoreB > scoreA) map.set(key, r);
  }
  return Array.from(map.values());
}