import * as XLSX from 'xlsx';
import type { Json } from '@/integrations/supabase/types';

export type ParsedRow = Record<string, Json> & {
  posted_at: string;
  description: string;
  amount: number;
  document_number: string | null;
  counterparty_name: string | null;
  balance_after: number | null;
  normalized_key: string;
  raw: Record<string, Json>;
  cost_center: string | null;
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

export function normalizeBrNumber(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && /^-?\d+(?:\.\d{1,2})?$/.test(String(input)) && Math.abs(input) <= 999999999999.99 ? input : null;
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
      if(!/^[+-]?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s))return null;
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      if(!/^[+-]?\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(s))return null;
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n)>999999999999.99) return null;
  return negative ? -Math.abs(n) : n;
}

export function normalizeDate(input: unknown): string | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    if(!Number.isFinite(input)||input<1)return null;
    // XLSX serial date
    const d = XLSX.SSF.parse_date_code(input);
    if (!d) return null;
    return validatedDay(d.y,d.m,d.d);
  }
  const s = String(input).trim();
  const br = s.match(/^(\d{2})([/\-.])(\d{2})\2(\d{4})$/);
  if (br) {
    return validatedDay(Number(br[4]),Number(br[3]),Number(br[1]));
  }
  const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(iso)return validatedDay(Number(iso[1]),Number(iso[2]),Number(iso[3]));
  return null;
}
function validatedDay(year:number,month:number,day:number):string|null {
  if(year<1900||year>9999)return null;
  const date=new Date(Date.UTC(year,month-1,day,12));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day ? date.toISOString() : null;
}

export async function computeFileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeText(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function toJsonRecord(row: Record<string, unknown>): Record<string, Json> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      return [key, value as Json];
    }
    return [key, String(value ?? '')];
  }));
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

function normHeader(v: unknown): string {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Given a matrix of rows (array of arrays), find the row that most likely contains
 * the real column headers. Scans up to 20 rows and picks the one with the highest
 * score = (non-empty cell count) + 2 * (number of keyword matches). Requires at
 * least one keyword match, otherwise returns 0.
 */
export function detectHeaderRowIndex(matrix: unknown[][]): number {
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

function matrixToRows(matrix: unknown[][], headerRowIndex: number): { headers: string[]; rows: Record<string, unknown>[] } {
  const rawHeaders = (matrix[headerRowIndex] || []).map((h, i) => {
    const s = String(h ?? '').trim();
    return s || `Coluna ${i + 1}`;
  });
  // Deduplicate column names
  const seen = new Set<string>();
  const headers = rawHeaders.map(h => {
    let value=h,number=2;
    while(seen.has(value))value=`${h} (${number++})`;
    seen.add(value);return value;
  });
  const rows: Record<string, unknown>[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const arr = matrix[i] || [];
    if (arr.every(c => String(c ?? '').trim() === '')) continue;
    if(arr.slice(headers.length).some(c=>String(c??'').trim()!==''))throw new Error(`Registro ${i+1} tem colunas sem cabeçalho. Revise o arquivo e o cabeçalho antes de importar.`);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, j) => { obj[h] = arr[j] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

export function parseCsv(text: string, headerRowIndex?: number): { headers: string[]; rows: Record<string, unknown>[]; headerRowIndex: number; matrix: unknown[][] } {
  const clean=text.replace(/^\uFEFF/,'');
  const candidates=[';',',','\t'].map(separator=>({separator,matrix:readCsvMatrix(clean,separator)}));
  const score=(matrix:string[][])=>{
    const row=matrix[headerRowIndex??detectHeaderRowIndex(matrix)]||[];
    return row.length;
  };
  const selected=candidates.sort((a,b)=>score(b.matrix)-score(a.matrix))[0];
  const matrix=readCsvMatrix(clean,selected.separator,true);
  if (!matrix.length) return { headers: [], rows: [], headerRowIndex: 0, matrix: [] };
  const idx = headerRowIndex ?? detectHeaderRowIndex(matrix);
  const { headers, rows } = matrixToRows(matrix, idx);
  return { headers, rows, headerRowIndex: idx, matrix };
}

function readCsvMatrix(text:string,separator:string,strict=false):string[][] {
  const matrix:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}
      else if(quoted){quoted=false;closed=true;}
      else{if(strict&&(closed||cell.trim()!==''))throw new Error('CSV inválido: aspas dentro de um campo não delimitado.');quoted=true;}
    }else if(c===separator&&!quoted){row.push(cell);cell='';closed=false;}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))matrix.push(row);row=[];cell='';closed=false;}
    else if(closed&&!quoted&&strict){if(c.trim()!=='')throw new Error('CSV inválido: conteúdo após o fechamento das aspas.');}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV incompleto: aspas não foram fechadas. Nenhuma linha foi importada.');
  row.push(cell);if(row.some(v=>v.trim()))matrix.push(row);
  return matrix;
}

export async function parseWorkbook(
  file: File,
  headerRowIndex?: number,
): Promise<{ headers: string[]; rows: Record<string, unknown>[]; headerRowIndex: number; matrix: unknown[][] }> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    return parseCsv(text, headerRowIndex);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if(!ws)throw new Error('Arquivo sem planilha legível.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: false });
  const idx = headerRowIndex ?? detectHeaderRowIndex(matrix);
  const { headers, rows } = matrixToRows(matrix, idx);
  return { headers, rows, headerRowIndex: idx, matrix };
}

export function buildParsedRows(rows: Record<string, unknown>[], map: ColumnMapping, bankAccountId: string): ParsedRow[] {
  const result=inspectParsedRows(rows,map,bankAccountId);
  if(result.rejected.length)throw new Error(`${result.rejected.length} registro(s) inválido(s). Revise antes de importar: ${result.rejected.slice(0,5).map(r=>`${r.row}: ${r.reason}`).join('; ')}`);
  return result.rows;
}
export function inspectParsedRows(rows: Record<string, unknown>[], map: ColumnMapping, bankAccountId: string): {rows:ParsedRow[];rejected:Array<{row:number;reason:string}>} {
  const out: ParsedRow[] = [];
  const rejected:Array<{row:number;reason:string}>=[];
  for (const [index,r] of rows.entries()) {
    const reject=(reason:string)=>rejected.push({row:index+1,reason});
    const iso = normalizeDate(r[map.date]);
    if (!iso) {reject('data inválida ou ambígua');continue;}
    let amount: number | null = null;
    if (map.amount) {
      amount = normalizeBrNumber(r[map.amount]);
    } else if (map.inflow || map.outflow) {
      const inflow = map.inflow ? normalizeBrNumber(r[map.inflow]) : null;
      const outflow = map.outflow ? normalizeBrNumber(r[map.outflow]) : null;
      const hasValue=(value:unknown)=>value!==null&&value!==undefined&&String(value).trim()!=='';
      if ((map.inflow&&hasValue(r[map.inflow])&&inflow===null)||(map.outflow&&hasValue(r[map.outflow])&&outflow===null)
        ||(inflow!==null&&inflow<0)||(inflow&&outflow)) {reject('crédito/débito inválido ou ambos preenchidos');continue;}
      amount = (inflow || 0) - Math.abs(outflow || 0);
    }
    if (amount == null || amount === 0) {reject('valor inválido, zero ou com precisão incompatível');continue;}
    const description = String(r[map.description] ?? '');
    const document_number = map.document ? String(r[map.document] ?? '') || null : null;
    const balance_after = map.balance ? normalizeBrNumber(r[map.balance]) : null;
    if(map.balance&&r[map.balance]!=null&&String(r[map.balance]).trim()!==''&&balance_after===null){reject('saldo inválido');continue;}
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
      counterparty_name: null,
      balance_after,
      cost_center,
      normalized_key,
      raw: toJsonRecord(r),
    });
  }
  return {rows:out,rejected};
}
