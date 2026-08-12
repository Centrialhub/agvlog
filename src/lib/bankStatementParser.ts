import * as XLSX from 'xlsx';

export type ParsedRow = {
  posted_at: string;
  description: string;
  amount: number;
  document_number?: string | null;
  counterparty_name?: string | null;
  balance_after?: number | null;
  normalized_key: string;
  raw: Record<string, any>;
  cost_center?: string | null;
};

export type ColumnMapping = {
  date: string;
  description: string;
  amount?: string;
  inflow?: string;
  outflow?: string;
  document?: string;
  balance?: string;
  costCenter?: string;
};

export function normalizeBrNumber(input: any): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return input;
  let s = String(input).trim();
  if (!s) return null;
  // Strip currency, spaces
  s = s.replace(/R\$\s?/gi, '').replace(/\s/g, '');
  const negative = /^\(.*\)$/.test(s) || /-\s*$/.test(s);
  s = s.replace(/^\(|\)$/g, '').replace(/-$/, '');
  // Detect BR (1.234,56) vs US (1,234.56 or 1234.56)
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // last separator is decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function normalizeDate(input: any): string | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    // XLSX serial date
    const d = XLSX.SSF.parse_date_code(input);
    if (!d) return null;
    const iso = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0));
    return iso.toISOString();
  }
  const s = String(input).trim();
  const br = s.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{2,4})/);
  if (br) {
    const dd = br[1]; const mm = br[2]; let yy = br[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return new Date(`${yy}-${mm}-${dd}T12:00:00Z`).toISOString();
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

export async function computeFileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeText(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

const HEADER_KEYWORDS = [
  'data', 'dt', 'date',
  'descri', 'histor', 'memo', 'lançamento', 'lancamento',
  'valor', 'amount',
  'crédito', 'credito', 'entrada', 'credit',
  'débito', 'debito', 'saída', 'saida', 'debit',
  'saldo', 'balance',
  'documento', 'doc', 'referen',
];

function normHeader(v: any): string {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Given a matrix of rows (array of arrays), find the row that most likely contains
 * the real column headers. Scans up to 20 rows and picks the one with the highest
 * score = (non-empty cell count) + 2 * (number of keyword matches). Requires at
 * least one keyword match, otherwise returns 0.
 */
export function detectHeaderRowIndex(matrix: any[][]): number {
  const limit = Math.min(matrix.length, 20);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] || [];
    const nonEmpty = row.filter(c => String(c ?? '').trim() !== '').length;
    if (nonEmpty < 2) continue;
    let hits = 0;
    for (const c of row) {
      const n = normHeader(c);
      if (!n) continue;
      if (HEADER_KEYWORDS.some(k => n.includes(k))) hits++;
    }
    if (hits === 0) continue;
    const score = nonEmpty + hits * 2;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestScore < 0 ? 0 : bestIdx;
}

function matrixToRows(matrix: any[][], headerRowIndex: number): { headers: string[]; rows: Record<string, any>[] } {
  const rawHeaders = (matrix[headerRowIndex] || []).map((h, i) => {
    const s = String(h ?? '').trim();
    return s || `Coluna ${i + 1}`;
  });
  // Deduplicate column names
  const seen = new Map<string, number>();
  const headers = rawHeaders.map(h => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h} (${n + 1})`;
  });
  const rows: Record<string, any>[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const arr = matrix[i] || [];
    if (arr.every(c => String(c ?? '').trim() === '')) continue;
    const obj: Record<string, any> = {};
    headers.forEach((h, j) => { obj[h] = arr[j] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

export function parseCsv(text: string, headerRowIndex?: number): { headers: string[]; rows: Record<string, any>[]; headerRowIndex: number; matrix: any[][] } {
  const sep = (text.split('\n')[0] || '').includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [], headerRowIndex: 0, matrix: [] };
  const matrix = lines.map(l => splitCsvLine(l, sep));
  const idx = headerRowIndex ?? detectHeaderRowIndex(matrix);
  const { headers, rows } = matrixToRows(matrix, idx);
  return { headers, rows, headerRowIndex: idx, matrix };
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === sep && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

export async function parseWorkbook(
  file: File,
  headerRowIndex?: number,
): Promise<{ headers: string[]; rows: Record<string, any>[]; headerRowIndex: number; matrix: any[][] }> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    return parseCsv(text, headerRowIndex);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false }) as any[][];
  const idx = headerRowIndex ?? detectHeaderRowIndex(matrix);
  const { headers, rows } = matrixToRows(matrix, idx);
  return { headers, rows, headerRowIndex: idx, matrix };
}

export function buildParsedRows(rows: Record<string, any>[], map: ColumnMapping, bankAccountId: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const r of rows) {
    const iso = normalizeDate(r[map.date]);
    if (!iso) continue;
    let amount: number | null = null;
    if (map.amount) {
      amount = normalizeBrNumber(r[map.amount]);
    } else if (map.inflow || map.outflow) {
      const inflow = map.inflow ? normalizeBrNumber(r[map.inflow]) : null;
      const outflow = map.outflow ? normalizeBrNumber(r[map.outflow]) : null;
      amount = (inflow || 0) - Math.abs(outflow || 0);
    }
    if (amount == null || amount === 0) continue;
    const description = String(r[map.description] ?? '');
    const document_number = map.document ? String(r[map.document] ?? '') || null : null;
    const balance_after = map.balance ? normalizeBrNumber(r[map.balance]) : null;
    const cost_center = map.costCenter ? String(r[map.costCenter] ?? '') || null : null;
    const normalized_key = [
      bankAccountId,
      iso.slice(0, 10),
      amount.toFixed(2),
      normalizeText(description).slice(0, 60),
      document_number ?? '',
    ].join('|');
    out.push({
      posted_at: iso,
      description,
      amount,
      document_number,
      balance_after,
      cost_center,
      normalized_key,
      raw: r,
    });
  }
  return out;
}
