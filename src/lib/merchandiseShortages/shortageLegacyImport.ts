import * as XLSX from 'xlsx';
import { parseQuantity, detectShortageType, inferResponsibleParty, computeItemTotal, round2 } from './shortageCalculator';
import type { ShortageItemInput, ShortageType, ResponsibleParty } from './shortageCalculator';

export interface ParsedShortageRow {
  sheet: string;
  month: number | null;
  year: number | null;
  occurrence_date: string | null;
  company: string | null;
  driver: string | null;
  invoice: string | null;
  city: string | null;
  customer: string | null;
  product_description: string;
  quantity_text: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number;
  total_amount: number;
  observation: string | null;
  shortage_type: ShortageType | null;
  responsible_party_type: ResponsibleParty | null;
  raw_row_index: number;
}

export interface ParsedShortageCase {
  key: string;
  occurrence_date: string | null;
  company: string | null;
  driver: string | null;
  invoice: string | null;
  city: string | null;
  customer: string | null;
  observation: string | null;
  shortage_type: ShortageType | null;
  responsible_party_type: ResponsibleParty | null;
  items: ShortageItemInput[];
  total_amount: number;
  month: number | null;
  year: number | null;
  sheet: string;
}

export interface ImportPreview {
  fileName: string;
  totalRows: number;
  validRows: number;
  skippedSubtotals: number;
  errors: { row: number; sheet: string; message: string }[];
  cases: ParsedShortageCase[];
  detectedMonths: string[];
  totalAmountCalculated: number;
}

const MONTHS: Record<string, number> = {
  JANEIRO:1, FEVEREIRO:2, MARÇO:3, MARCO:3, ABRIL:4, MAIO:5, JUNHO:6,
  JULHO:7, AGOSTO:8, SETEMBRO:9, OUTUBRO:10, NOVEMBRO:11, DEZEMBRO:12,
};

function parseMonthHeader(v: unknown): { month: number | null; year: number | null } {
  if (!v) return { month: null, year: null };
  const s = String(v).toUpperCase().replace('.', '');
  const m = s.match(/(JANEIRO|FEVEREIRO|MARÇO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*\/?\s*(\d{4})/);
  if (!m) return { month: null, year: null };
  return { month: MONTHS[m[1]] ?? null, year: Number(m[2]) };
}

function excelDateToISO(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseCurrency(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return round2(v);
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? round2(n) : 0;
}

function isHeaderRow(row: unknown[]): boolean {
  const joined = row.map(c => String(c ?? '').toUpperCase().trim()).join('|');
  return joined.includes('DATA') && joined.includes('EMPRESA') && joined.includes('MOTORISTA');
}

function isSubtotalRow(row: unknown[]): boolean {
  const first = String(row[0] ?? '').toUpperCase().trim();
  const second = String(row[1] ?? '').toUpperCase().trim();
  return first.includes('TOTAIS') || second.includes('TOTAIS') || first.includes('TOTAL') && !second;
}

export function parseShortageWorkbook(buffer: ArrayBuffer, fileName = 'legacy.xlsx'): ImportPreview {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const preview: ImportPreview = {
    fileName,
    totalRows: 0,
    validRows: 0,
    skippedSubtotals: 0,
    errors: [],
    cases: [],
    detectedMonths: [],
    totalAmountCalculated: 0,
  };

  const caseMap = new Map<string, ParsedShortageCase>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    let sheetMonth: number | null = null;
    let sheetYear: number | null = null;
    let inTable = false;
    // Column indexes discovered from header row
    const idx = { data: 1, empresa: 2, motorista: 3, nf: 4, cidade: 5, cliente: 6, produto: 7, qtd: 8, custo: 9, total: 10, obs: 11 };

    // Detect month header (first 6 rows)
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const cell = rows[i]?.find(c => typeof c === 'string' && /\/\d{4}/.test(c as string));
      const detected = parseMonthHeader(cell);
      if (detected.month) { sheetMonth = detected.month; sheetYear = detected.year; break; }
    }
    if (sheetMonth && sheetYear) {
      const label = `${sheetName}: ${sheetMonth}/${sheetYear}`;
      if (!preview.detectedMonths.includes(label)) preview.detectedMonths.push(label);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (row.every(c => c == null || c === '')) continue;
      if (isHeaderRow(row)) {
        inTable = true;
        // rediscover indexes
        row.forEach((c, j) => {
          const s = String(c ?? '').toUpperCase().trim();
          if (s.startsWith('DATA')) idx.data = j;
          else if (s.startsWith('EMPRESA')) idx.empresa = j;
          else if (s.startsWith('MOTORISTA')) idx.motorista = j;
          else if (s.startsWith('NF')) idx.nf = j;
          else if (s.startsWith('CIDADE')) idx.cidade = j;
          else if (s.startsWith('CLIENTE')) idx.cliente = j;
          else if (s.startsWith('DESCRIÇÃO') || s.startsWith('DESCRICAO') || s.startsWith('PRODUTO')) idx.produto = j;
          else if (s.startsWith('QUANTIDADE')) idx.qtd = j;
          else if (s.startsWith('CUSTO')) idx.custo = j;
          else if (s.startsWith('TOTAL')) idx.total = j;
          else if (s.startsWith('OBSERVAÇÃO') || s.startsWith('OBSERVACAO')) idx.obs = j;
        });
        continue;
      }
      if (!inTable) continue;
      if (isSubtotalRow(row)) { preview.skippedSubtotals++; continue; }

      preview.totalRows++;
      const rawDate = row[idx.data];
      const dateISO = excelDateToISO(rawDate) ?? (sheetMonth && sheetYear ? `${sheetYear}-${String(sheetMonth).padStart(2, '0')}-01` : null);
      const produto = row[idx.produto];
      if (!produto || !String(produto).trim()) continue;

      const qtdRaw = row[idx.qtd];
      const parsedQ = parseQuantity(qtdRaw as string | number | null);
      const custo = parseCurrency(row[idx.custo]);
      const totalCell = parseCurrency(row[idx.total]);
      const totalCalc = parsedQ.quantity != null ? round2(parsedQ.quantity * custo) : 0;
      const total = totalCell || totalCalc;

      const observation = row[idx.obs] ? String(row[idx.obs]).trim() : null;
      const shortageType = detectShortageType(observation);
      const responsibleParty = inferResponsibleParty(shortageType);

      const company = row[idx.empresa] ? String(row[idx.empresa]).trim() : null;
      const driver = row[idx.motorista] ? String(row[idx.motorista]).trim() : null;
      const invoice = row[idx.nf] != null && row[idx.nf] !== '' ? String(row[idx.nf]).replace(/\.0+$/, '').trim() : null;
      const city = row[idx.cidade] ? String(row[idx.cidade]).trim() : null;
      const customer = row[idx.cliente] ? String(row[idx.cliente]).trim() : null;

      const groupKey = [dateISO, company, driver, invoice, customer, city, sheetName].join('||');
      let c = caseMap.get(groupKey);
      if (!c) {
        c = {
          key: groupKey,
          occurrence_date: dateISO,
          company, driver, invoice, city, customer,
          observation, shortage_type: shortageType,
          responsible_party_type: responsibleParty,
          items: [],
          total_amount: 0,
          month: sheetMonth, year: sheetYear, sheet: sheetName,
        };
        caseMap.set(groupKey, c);
      }

      const item: ShortageItemInput = {
        product_description: String(produto).trim(),
        quantity_text: parsedQ.raw || (qtdRaw != null ? String(qtdRaw) : null),
        quantity: parsedQ.quantity,
        unit: parsedQ.unit,
        unit_cost: custo,
        total_amount: total,
        item_observation: observation,
      };
      c.items.push(item);
      c.total_amount = round2(c.total_amount + (item.total_amount ?? computeItemTotal(item)));
      preview.validRows++;
      preview.totalAmountCalculated = round2(preview.totalAmountCalculated + (item.total_amount ?? 0));
    }
  }

  preview.cases = Array.from(caseMap.values());
  return preview;
}
